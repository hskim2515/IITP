import {useEffect, useRef} from "react";
import { propertyFormSchema, PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import { AxiosError } from "axios";
import { useLogStore } from "@stores/useLogStore";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";
import {useNetworkStore} from "@stores/useNetworkStore";
import {useScenarioStore} from "@stores/useScenarioStore";
import * as Cesium from "cesium";
import { transformExtent } from "ol/proj";
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
import { NETWORK_TILING } from "@utils/lodConstants";
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
import { useOnboardingStore } from "@stores/useOnboardingStore";

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

export function flyToNetworkExtent(cesiumViewer: any, olMap: any): void {
    const network = useNetworkStore.getState().currentJsonData as any;
    if (!network?.links?.length) return;

    let minLat =  Infinity, maxLat = -Infinity;
    let minLng =  Infinity, maxLng = -Infinity;

    for (const link of network.links) {
        if (!Array.isArray(link.coordinates)) continue;
        for (const c of link.coordinates) {
            if (c.lat < minLat) minLat = c.lat;
            if (c.lat > maxLat) maxLat = c.lat;
            if (c.lng < minLng) minLng = c.lng;
            if (c.lng > maxLng) maxLng = c.lng;
        }
    }

    if (!isFinite(minLat)) return;

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    // 네트워크 가로/세로 범위 중 큰 쪽을 기준으로 카메라 높이 결정
    const latExtentM  = (maxLat - minLat) * 111000;
    const lngExtentM  = (maxLng - minLng) * 88000;
    const extentM     = Math.max(latExtentM, lngExtentM, 500); // 최소 500m
    const cameraHeight = extentM * 2.0;

    // Cesium 카메라 이동
    if (cesiumViewer) {
        cesiumViewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, cameraHeight),
            duration: 1.5,
        });
    }

    // OpenLayers 뷰 이동
    if (olMap) {
        const padding = 0.0005; // 약 50m 여백
        const extent3857 = transformExtent(
            [minLng - padding, minLat - padding, maxLng + padding, maxLat + padding],
            'EPSG:4326', 'EPSG:3857'
        );
        olMap.getView().fit(extent3857, { duration: 1000, padding: [40, 40, 40, 40] });
    }
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
        if (cesiumViewer && layerGroups?.length > 0 && !isInitializedRef.current && !isInitializingRef.current) {
            init();
        }
    }, [layerGroups, olMap, cesiumViewer]);

    const init = async () => {
        if (!cesiumViewer) return;
        if (isInitializedRef.current || isInitializingRef.current) return;
        isInitializingRef.current = true;
        useLayerStore.getState().setInitialized(false);

        try {
            // 1단계: 모든 데이터를 fetch하여 originData 세팅
            for (const menuCode of menuCodes) {
                const store = menuCodeToStoreMap[menuCode];
                if (!store) continue;

                try {
                    // 타일 모드: 네트워크는 전체(수십 MB)를 받지 않고 빈 채로 시작 → 타일 매니저가
                    // viewport 분만 동기화. 시나리오 열 때 87MB 다운로드+파싱+빌드로 화면 멈추던 문제 회피.
                    if (NETWORK_TILING.ENABLED && menuCode === 'NETWORK') {
                        store.getState().setOriginData({ id: 0, name: null, links: [], nodes: [] } as any);
                        useLogStore.getState().addLog('info', `${LAYER_LABELS[menuCode] ?? menuCode} 타일 모드 (viewport 로드)`);
                        continue;
                    }

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

            // 2단계: 레이어 매니저 생성 (olMap이 없으면 OL 관련 매니저는 null)
            const vectorLayerManager = olMap ? new VectorLayerManager(olMap, useLayerStore) : null;
            const tileLayerManager = olMap ? new TileLayerManager(olMap) : null;
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
                olMap ?? null,
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

            // 네트워크 범위로 지도 이동
            flyToNetworkExtent(cesiumViewer, olMap);

            // 네트워크 데이터가 없으면 가져오기 유도
            const networkData = useNetworkStore.getState().originData;
            if (!networkData) {
                useOnboardingStore.getState().setStep('need-network');
                return;
            }

            // 네트워크는 있으나 시뮬레이션/신호 데이터가 없으면 없는 항목만 안내
            const signalOrigin = useSignalStore.getState().originData as any;
            const hasSignal = Array.isArray(signalOrigin?.signals) && signalOrigin.signals.length > 0;
            try {
                const base = import.meta.env.VITE_API_URL;
                const res = await fetch(`${base}/vehicle/vehicle-route/${selectedScenario.key}/exists`);
                if (res.ok) {
                    const { exists: hasVehicleRoute } = await res.json();
                    if (!hasVehicleRoute || !hasSignal) {
                        useOnboardingStore.getState().setNeedSimulation(!hasSignal, !hasVehicleRoute);
                    }
                }
            } catch {
                // vehicle route 체크 실패 → 무시
            }
        } finally {
            isInitializingRef.current = false;
        }
    };
};

export default useLayerInit;