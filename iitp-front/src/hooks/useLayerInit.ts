import {useEffect, useRef} from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import { AxiosError } from "axios";
import { useLogStore } from "@stores/useLogStore";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";
import {useNetworkStore} from "@stores/useNetworkStore";
import {useScenarioStore} from "@stores/useScenarioStore";
import VectorLayerManager from "@managers/VectorLayerManager";
import {useLayerStore} from "@stores/useLayerStore";
import TileLayerManager from "@managers/TileLayerManager";
import PrimitiveLayerManager from "@managers/PrimitiveLayerManager";
import DataSourceLayerManager from "@managers/DataSourceLayerManager";
import BaseMapLayerManager from "@managers/BaseMapLayerManager";
import {useSimulationStore} from "@stores/useSimulationStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import LayerManager from "@managers/LayerManager";
import {useLayerSchemaStore} from "@stores/useLayerSchemaStore";
import {assignPropertyToResponseData} from "@utils/guid";
import {usePavementMarkingStore} from "@stores/usePavementMarkingStore";
import { useBusStationStore } from "@stores/useBusStationStore";
import { useRailStationStore } from "@stores/useRailStationStore";
import {useSignalTimelineStore} from "@stores/useSignalTimelineStore";
import {useSignalStore} from "@stores/useSignalStore";
import {FEATURE_TYPE} from "@type/Signal";
import { useSignalTodStore } from "@stores/useSignalTodStore";
import { useSimulationScenarioStore } from "@stores/useSimulationScenarioStore";
import { useBusPtLineStore, useBusPtLineWeekdayStore, useBusPtLineWeekendStore } from "@stores/useBusPtLineStore";
import { useRailPtLineStore } from "@stores/useRailPtLineStore";

const LAYER_LABELS: Record<string, string> = {
    NETWORK:               '도로',
    SIGNAL:                '신호등',
    BUS_STATION:           '버스 정류장',
    RAIL_STATION:          '철도 정류장',
    PAVEMENT_MARKING:      '노면표시',
    BUS_PT_LINE:           '버스 노선',
    BUS_PT_LINE_WEEKDAY:   '버스 노선(평일)',
    BUS_PT_LINE_WEEKEND:   '버스 노선(주말)',
    RAIL_PT_LINE:          '철도 노선',
    SIGNAL_TOD:            '신호 TOD',
    SIMULATION_SCENARIO:   '시뮬레이션 시나리오',
};

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToStoreMap: Record<string, FeatureStoreFactoryType<any>> = {
    // menuCode: store
    NETWORK: useNetworkStore,
    BUS_STATION: useBusStationStore,
    RAIL_STATION: useRailStationStore,
    PAVEMENT_MARKING: usePavementMarkingStore,
    SIGNAL: useSignalStore,
    SIGNAL_TOD: useSignalTodStore,
    SIMULATION_SCENARIO: useSimulationScenarioStore,
    BUS_PT_LINE: useBusPtLineStore,
    BUS_PT_LINE_WEEKDAY: useBusPtLineWeekdayStore,
    BUS_PT_LINE_WEEKEND: useBusPtLineWeekendStore,
    RAIL_PT_LINE: useRailPtLineStore,
}

export const layerNameToStoreMap: Record<string, FeatureStoreFactoryType<any>> = {
    // layerName: store
    network: useNetworkStore,
    busStation: useBusStationStore,
    railStation: useRailStationStore,
    pavementMarking: usePavementMarkingStore,
    signal: useSignalStore,
    signalTod: useSignalTodStore,
    busRoute: useBusPtLineStore,
    busRouteWeekday: useBusPtLineWeekdayStore,
    busRouteWeekend: useBusPtLineWeekendStore,
    railRoute: useRailPtLineStore,
    simulationScenario: useSimulationScenarioStore,
}

const useLayerInit = (): void => {

    const olMap = useOpenLayersStore.state.map();
    const cesiumViewer = useCesiumStore.state.viewer();
    const setLayerManager = useLayerStore.getState().setLayerManager;

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
    const layerGroups = useLayerSchemaStore.state.groups();

    // 중복 실행 방지: init이 이미 실행 중이거나 완료된 경우 재실행하지 않음
    const isInitializedRef = useRef(false);
    const isInitializingRef = useRef(false);

    useEffect(() => {
        if (olMap && cesiumViewer && layerGroups?.length > 0 && !isInitializedRef.current && !isInitializingRef.current) {
            init();
        }
    }, [layerGroups, olMap, cesiumViewer]);

    const init = async () => {
        if (!olMap || !cesiumViewer) return;
        if (isInitializedRef.current || isInitializingRef.current) return;
        isInitializingRef.current = true;
        useLayerStore.getState().setInitialized(false);

        try {
            // 1단계: 모든 데이터를 fetch하여 originData 세팅
            for (const menuCode of menuCodes) {
                const store = menuCodeToStoreMap[menuCode];
                if (!store) continue;

                try {
                    const api = apiConfig[menuCode as ApiMenuKey].list;
                    const response = await axiosInstance({
                        method: api.method,
                        url: api.url + '/' + selectedScenario.key,
                    });

                    store.getState().setOriginData(response.data);
                    assignPropertyToResponseData(response.data);
                    const label = LAYER_LABELS[menuCode] ?? menuCode;
                    useLogStore.getState().addLog('info', `${label} 데이터 로드 완료`);
                } catch (err) {
                    if (err instanceof AxiosError && err.response?.status === 404) {
                        const label = LAYER_LABELS[menuCode] ?? menuCode;
                        useLogStore.getState().addLog('warn', `${label} 데이터 없음`);
                        continue;
                    }
                    console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
                }
            }

            // 2단계: 레이어 매니저 생성 (한 번만)
            const vectorLayerManager = new VectorLayerManager(olMap, useLayerStore);
            const tileLayerManager = new TileLayerManager(olMap);
            const primitiveLayerManager = new PrimitiveLayerManager(cesiumViewer, useLayerStore);
            const dataSourceLayerManager = new DataSourceLayerManager(cesiumViewer, useLayerStore);
            const basemapLayerManager = new BaseMapLayerManager(cesiumViewer);

            const layerManager = new LayerManager(
                primitiveLayerManager,
                basemapLayerManager,
                cesiumViewer,
                vectorLayerManager,
                dataSourceLayerManager,
                tileLayerManager,
                olMap,
                useSimulationStore
            );

            setLayerManager(layerManager);
            layerManager.addBaseMapLayer(layerGroups);
            try {
                await layerManager.addFacilityLayers(layerGroups);
            } catch (err) {
                console.error("[useLayerInit] addFacilityLayers 실패, 초기화 계속 진행:", err);
            }

            // 3단계: initCurrentData — originData를 currentJsonData에 복사 (초기 1회만)
            for (const menuCode of menuCodes) {
                const store = menuCodeToStoreMap[menuCode];
                if (!store) continue;
                try {
                    store.getState().initCurrentData();
                } catch (err) {
                    console.error(`[${menuCode}] initCurrentData 실패`, err);
                }
            }

            isInitializedRef.current = true;
            useLayerStore.getState().setInitialized(true);
        } finally {
            isInitializingRef.current = false;
        }
    };
};

export default useLayerInit;