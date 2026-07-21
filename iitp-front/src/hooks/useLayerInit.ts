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
import { getActiveVersionId } from "@utils/versionId";
import { useNetworkExtentStore } from "@stores/useNetworkExtentStore";
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
import { useNetworkTileStore } from "@stores/useNetworkTileStore";

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

export async function flyToNetworkExtent(cesiumViewer: any, olMap: any): Promise<void> {
    const network = useNetworkStore.getState().currentJsonData as any;

    let minLat =  Infinity, maxLat = -Infinity;
    let minLng =  Infinity, maxLng = -Infinity;

    if (network?.links?.length) {
        for (const link of network.links) {
            if (!Array.isArray(link.coordinates)) continue;
            for (const c of link.coordinates) {
                if (c.lat < minLat) minLat = c.lat;
                if (c.lat > maxLat) maxLat = c.lat;
                if (c.lng < minLng) minLng = c.lng;
                if (c.lng > maxLng) maxLng = c.lng;
            }
        }
    } else {
        // 타일 모드: 클라이언트에 링크 데이터가 없음 → 서버 extent API (SQLite RTree bbox).
        // 시나리오 origin 좌표는 네트워크 위치와 다를 수 있어(부천 origin + 대전 네트워크) 신뢰 불가.
        const versionId = getActiveVersionId();
        if (!versionId) return;
        try {
            const res = await axiosInstance.get(`/network/${versionId}/extent`);
            const e = res.data;
            if (e && isFinite(e.west)) {
                minLng = e.west; maxLng = e.east; minLat = e.south; maxLat = e.north;
            }
        } catch {
            return; // 네트워크 없음 — 이동 생략
        }
    }

    if (!isFinite(minLat)) return;

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    // 네트워크 가로/세로 범위 중 큰 쪽을 기준으로 카메라 높이 결정 (OL 없을 때 폴백)
    const latExtentM  = (maxLat - minLat) * 111000;
    const lngExtentM  = (maxLng - minLng) * 88000;
    const extentM     = Math.max(latExtentM, lngExtentM, 500); // 최소 500m
    let cameraHeight = extentM * 2.0;

    // 차량 줌 티어(개별/flow/히트맵/OD) 임계값 보정용 — 부천 규모(수 km)든 광역(수십km)든
    // 네트워크 크기에 비례해 같은 상대적 줌 단계에서 전환되도록 viewportMetrics.normalizePixelSizeM이 참조.
    useNetworkExtentStore.getState().setExtentM(extentM);

    // OpenLayers 뷰 이동 (Cesium보다 먼저 — fit 결과 해상도로 카메라 높이를 정합시키기 위함)
    const padding = 0.0005; // 약 50m 여백
    const extent3857 = transformExtent(
        [minLng - padding, minLat - padding, maxLng + padding, maxLat + padding],
        'EPSG:4326', 'EPSG:3857'
    );
    if (olMap) {
        const view = olMap.getView();
        view.fit(extent3857, { duration: 1000, padding: [40, 40, 40, 40] });

        // 2D/3D 축척 정합: fit 이 만들 해상도(3857 units/px)를 지면 m/px 로 보정한 뒤
        // useMapSync 와 동일한 변환(height = res × canvasH / (2·tan(fovy/2)))으로 카메라 높이 결정.
        // 기존 extentM×2.0 은 OL fit 과 무관한 자체 계산이라 진입 직후 두 지도의 축척이 달랐다.
        const size = olMap.getSize();
        const canvas = cesiumViewer?.scene.canvas;
        if (size && size[0] > 80 && size[1] > 80 && canvas) {
            const fitRes3857 = view.getResolutionForExtent(extent3857, [size[0] - 80, size[1] - 80]);
            const groundRes = fitRes3857 * Math.cos(centerLat * Math.PI / 180);
            const frustum: any = cesiumViewer.camera.frustum;
            const fovy = frustum?.fovy ?? Math.PI / 3;
            const canvasH = canvas.clientHeight || 900;
            const h = groundRes * canvasH / (2 * Math.tan(fovy / 2));
            if (isFinite(h) && h > 0) cameraHeight = h;
        }
    }

    // Cesium 카메라 이동
    if (cesiumViewer) {
        cesiumViewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, cameraHeight),
            duration: 1.5,
        });
    }
}

const useLayerInit = (): void => {

    const olMap = useOpenLayersStore.state.map();
    const cesiumViewer = useCesiumStore.state.viewer();
    const setLayerManager = useLayerStore.getState().setLayerManager;

    // 버전 선택 전 init 금지 — Maps는 시나리오 선택 직후 이미 마운트되므로,
    // 여기서 기다리지 않으면 getActiveVersionId()가 scenario.key로 폴백해
    // 이전(원본) 네트워크를 먼저 로드했다가 버전 선택 후 현재 버전으로 갈아치우는 깜빡임 발생.
    const selectedVersion = useScenarioStore((state) => state.selectedScenarioVersion);
    const activeVersionId = getActiveVersionId();
    const menuCodes = Object.keys(propertyFormSchema as Record<string, PropertyFormSchemaProps>);
    const layerGroups = useLayerSchemaStore.state.groups();

    // 중복 실행 방지: init이 이미 실행 중이거나 완료된 경우 재실행하지 않음
    const isInitializedRef = useRef(false);
    const isInitializingRef = useRef(false);

    useEffect(() => {
        if (cesiumViewer && layerGroups?.length > 0 && selectedVersion && !isInitializedRef.current && !isInitializingRef.current) {
            init();
        }
    }, [layerGroups, olMap, cesiumViewer, selectedVersion]);

    const init = async () => {
        if (!cesiumViewer) return;
        if (isInitializedRef.current || isInitializingRef.current) return;
        isInitializingRef.current = true;
        useLayerStore.getState().setInitialized(false);

        try {
            // 시나리오별 tileMode 복원 — 대형(KTDB) 시나리오만 타일 모드, 소형은 전체 로드(편집 가능)
            if (activeVersionId) {
                useNetworkTileStore.getState().hydrateForVersion(activeVersionId);
            }

            // 1단계: 모든 데이터를 fetch하여 originData 세팅
            for (const menuCode of menuCodes) {
                const store = menuCodeToStoreMap[menuCode];
                if (!store) continue;

                try {
                    // 타일 모드: 네트워크는 전체(수십 MB)를 받지 않고 빈 채로 시작 → 타일 매니저가
                    // viewport 분만 동기화. ENABLED=true 정적 플래그 또는 이전 세션에서 tileMode가
                    // localStorage에 영속되어 있으면 전체 다운로드 없이 시작한다.
                    if ((NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode) && menuCode === 'NETWORK') {
                        store.getState().setOriginData({ id: 0, name: null, links: [], nodes: [] } as any);
                        useLogStore.getState().addLog('info', `${LAYER_LABELS[menuCode] ?? menuCode} 타일 모드 (viewport 로드)`);
                        continue;
                    }

                    const api = apiConfig[menuCode as ApiMenuKey].list;
                    const response = await axiosInstance({
                        method: api.method,
                        url: api.url + '/' + activeVersionId,
                    });

                    store.getState().setOriginData(response.data);
                    assignPropertyToResponseData(response.data);
                    const label = LAYER_LABELS[menuCode] ?? menuCode;
                    useLogStore.getState().addLog('info', `${label} 데이터 로드 완료`);

                    // 대용량 네트워크(KTDB 등: 노드 10,000개 초과) → 타일 모드 자동 전환.
                    // 새로고침 후에도 tileMode가 복원되어 fullBuild 트리거를 차단한다.
                    if (menuCode === 'NETWORK' && (response.data?.nodes?.length ?? 0) > 10000) {
                        useNetworkTileStore.getState().setTileMode(true, activeVersionId);
                        useLogStore.getState().addLog('info', `네트워크 타일 모드 자동 전환 (${response.data.nodes.length}개 노드)`);
                    }
                } catch (err) {
                    if (err instanceof AxiosError && err.response?.status === 404) {
                        const label = LAYER_LABELS[menuCode] ?? menuCode;
                        useLogStore.getState().addLog('warn', `${label} 데이터 없음`);
                        continue;
                    }
                    // 네트워크 전체 fetch 실패(대용량 타임아웃 등) → 타일 모드 fallback.
                    // 타일 API는 서버가 SQLite에서 viewport 분만 응답하므로 대용량이어도 동작한다.
                    if (menuCode === 'NETWORK') {
                        useNetworkTileStore.getState().setTileMode(true, activeVersionId);
                        store.getState().setOriginData({ id: 0, name: null, links: [], nodes: [] } as any);
                        useLogStore.getState().addLog('warn', '네트워크 전체 로드 실패 → 타일 모드로 전환 (viewport 로드)');
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
                // 타일 모드 네트워크: 67K 노드를 currentJsonData에 올리면 fullBuild 트리거 → 엔티티 폭증.
                // 빈 마커만 설정 → Facility.tsx visibleFields 필터 통과(레이어 목록 유지) + fullBuild 차단.
                if (menuCode === 'NETWORK' && useNetworkTileStore.getState().tileMode) {
                    store.getState().setCurrentJsonData({ id: 0, name: null, nodes: [], links: [] } as any);
                    continue;
                }
                try {
                    store.getState().initCurrentData();
                } catch (err) {
                    console.error(`[${menuCode}] initCurrentData 실패`, err);
                }
            }

            isInitializedRef.current = true;
            useLayerStore.getState().setInitialized(true);

            // 네트워크 범위로 지도 이동 (타일 모드는 서버 extent API 사용)
            flyToNetworkExtent(cesiumViewer, olMap);

            // 네트워크 데이터가 없으면 가져오기 유도.
            // 타일 모드에서는 originData가 항상 빈 마커(truthy)라 로컬 검사 불가 → 서버 extent로 판단.
            let hasNetwork = false;
            if (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode) {
                try {
                    const res = await axiosInstance.get(`/network/${getActiveVersionId()}/extent`);
                    hasNetwork = !!res.data && isFinite(res.data.west);
                } catch {
                    hasNetwork = false;
                }
            } else {
                hasNetwork = !!useNetworkStore.getState().originData;
            }
            if (!hasNetwork) {
                useOnboardingStore.getState().setStep('need-network');
                return;
            }

            // 네트워크는 있으나 시뮬레이션/신호 데이터가 없으면 없는 항목만 안내
            const signalOrigin = useSignalStore.getState().originData as any;
            const hasSignal = Array.isArray(signalOrigin?.signals) && signalOrigin.signals.length > 0;
            try {
                const base = import.meta.env.VITE_API_URL;
                const res = await fetch(`${base}/vehicle/vehicle-route/${getActiveVersionId()}/exists`);
                if (res.ok) {
                    // exists(CZML 캐시)만 보면 원본(vehicle_sim.db)이 있어도 "데이터 없음"으로 안내됨
                    // → useSimulation 로드 판단과 동일하게 원본 기준으로 통일
                    const info = await res.json();
                    const hasVehicleRoute = !!(info.exists || info.generating || info.simDbExists);
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