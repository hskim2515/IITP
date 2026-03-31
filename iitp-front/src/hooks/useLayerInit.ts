import {useEffect} from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
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

// 각 도메인 별로 store를 생성하기 위함
export const menuCodeToStoreMap: Record<string, FeatureStoreFactoryType> = {
    // menuCode: store
    NETWORK: useNetworkStore,
    BUS_STATION: useBusStationStore,
    RAIL_STATION: useRailStationStore,
    PAVEMENT_MARKING: usePavementMarkingStore,
    SIGNAL: useSignalStore,
}

export const layerNameToStoreMap: Record<string, FeatureStoreFactoryType> = {
    // layerName: store
    network: useNetworkStore,
    busStation: useBusStationStore,
    railStation: useRailStationStore,
    pavementMarking: usePavementMarkingStore,
    signal: useSignalStore,
}

const useLayerInit = (): void => {

    const olMap = useOpenLayersStore.state.map();
    const cesiumViewer = useCesiumStore.getState().viewer;
    const setLayerManager = useLayerStore.getState().setLayerManager;
    const lodLevels = [1.0, 0.5, 0.2];

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
    const layerGroups = useLayerSchemaStore.state.groups();

    useEffect(() => {
        if (olMap) {
            init()
        }

    }, [layerGroups, olMap, cesiumViewer]);

    const init = async () => {

        if(!olMap || !cesiumViewer) return;

        // 1단계: 모든 데이터를 fetch하여 originData 세팅만 (initCurrentData는 아직 호출 안 함)
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
                console.log(`${menuCode} 데이터 fetch 완료`);
            } catch (err) {
                console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
            }
        }

        // 2단계: 레이어 생성 (network OL 레이어가 먼저 map에 추가됨)
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
        await layerManager.addFacilityLayers(layerGroups);

        // 3단계: 레이어가 모두 준비된 후 initCurrentData 호출
        // → PavementMarking 등 network 레이어에 의존하는 레이어가 안전하게 interpolate 가능
        for (const menuCode of menuCodes) {
            const store = menuCodeToStoreMap[menuCode];
            if (!store) continue;
            try {
                store.getState().initCurrentData();
                console.log(`${menuCode} 데이터 초기화 완료`);
            } catch (err) {
                console.error(`[${menuCode}] initCurrentData 실패`, err);
            }
        }
    };
};

export default useLayerInit;