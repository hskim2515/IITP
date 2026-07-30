import { useEffect, useRef } from "react";
import { getActiveVersionId } from "@utils/versionId";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useLayerStore } from "@stores/useLayerStore";
import * as Cesium from "cesium";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { Heatmap } from "ol/layer";
import VectorSource from "ol/source/Vector";
import { parseRawODInputFromFlatArray } from "@utils/transform";
import LayerManager from "../managers/LayerManager";
import HeatBarLayer from "@primitives/HeatBarLayer";
import {JulianDate} from "cesium";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useSignalTimelineStore} from "@stores/useSignalTimelineStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useLogStore } from "@stores/useLogStore";
import {getFeaturesByProperties} from "@utils/feature";
import {Fill, Stroke, Style} from "ol/style";
import {Feature} from "ol";
import {applyCesiumSignalStyle, applyOlSignalStyle, updateSignalStyles} from "@utils/signal";
import { useVehicleModelStore, resolveGlbUrl, resolveModelByVehicleType, DEFAULT_Z_OFFSET } from "@stores/useVehicleModelStore";
import { useSimulationScenarioStore } from "@stores/useSimulationScenarioStore";
import { useSignalTodStore } from "@stores/useSignalTodStore";
import { computeTodPeriods, mergeSignalTimelines } from "@utils/tod";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { VEHICLE_STREAMING, NETWORK_TILING, VEHICLE_AGG_FEED } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import VehicleAggregationFeeder from "@managers/VehicleAggregationFeeder";

/**
 * layerManager.getLayer()는 없으면 빈 배열 []을, 1개면 단일 객체를, 2개 이상이면 배열을 반환한다.
 * ⚠️ `![]`은 JS에서 false(빈 배열도 truthy)라서 `if (!getLayer(...))`로 존재 확인을 하면 "없음"을
 * 절대 감지하지 못해 addXxxLayer()가 영원히 호출되지 않는다(레이어가 아예 안 생기는 버그였음).
 * 반드시 이 헬퍼로 배열 길이까지 확인할 것.
 */
function layerExists(layerManager: any, groupName: string, layerName: string): boolean {
    const found = layerManager?.getLayer(groupName, layerName);
    return Array.isArray(found) ? found.length > 0 : !!found;
}

/**
 * vehicleRoute 내 모든 ECEF 웨이포인트에 지형 고도를 적용합니다.
 * 지형 없음(EllipsoidTerrainProvider)이면 원본 그대로 반환합니다.
 *
 * 흐름:
 *   ECEF → Cartographic → sampleTerrainMostDetailed → 고도 주입 → ECEF 재변환
 *
 * 중복 최소화: lat/lng를 ~10m 격자로 반올림해 동일 격자 내 위치는 한 번만 샘플링합니다.
 */
async function applyTerrainHeightsToRoute(
    vehicleRoute: any[],
    terrainProvider: Cesium.TerrainProvider,
    networkLayer?: { getNearestTerrainHeight(lng: number, lat: number, maxDistM?: number): number | null } | null
): Promise<any[]> {
    if (terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
        return vehicleRoute;
    }

    // 1. 모든 웨이포인트 수집 (flat array: [t, x, y, z, ...])
    const GRID = 4; // 소수점 자릿수 (~11m 격자)
    const uniqueCartoMap = new Map<string, Cesium.Cartographic>();

    vehicleRoute.forEach((track: any) => {
        const path: number[] = Array.isArray(track) ? track : track.path;
        for (let i = 0; i + 3 < path.length; i += 4) {
            const x = path[i + 1], y = path[i + 2], z = path[i + 3];
            const carto = Cesium.Cartographic.fromCartesian(
                new Cesium.Cartesian3(x, y, z)
            );
            const key = `${carto.longitude.toFixed(GRID)},${carto.latitude.toFixed(GRID)}`;
            if (!uniqueCartoMap.has(key)) {
                uniqueCartoMap.set(key, Cesium.Cartographic.clone(carto));
            }
        }
    });

    const uniqueKeys   = Array.from(uniqueCartoMap.keys());
    const uniqueCartos = uniqueKeys.map(k => uniqueCartoMap.get(k)!);

    // 2. 지형 고도 일괄 샘플링 (원격 지형 타일 다운로드 — unique 격자 수에 비례)
    try {
        await Cesium.sampleTerrainMostDetailed(terrainProvider, uniqueCartos);
    } catch (e) {
        console.warn('[applyTerrainHeightsToRoute] 지형 샘플링 실패, 원본 사용:', e);
        return vehicleRoute;
    }

    // key → 샘플된 고도 맵
    const heightMap = new Map<string, number>();
    uniqueKeys.forEach((k, i) => heightMap.set(k, uniqueCartos[i]!.height ?? 0));

    // 3. 새 배열 생성 (원본 불변)
    const adjusted = vehicleRoute.map((track: any) =>
        Array.isArray(track) ? [...track] : { ...track, path: [...track.path] }
    );

    // 4. 트랙(차량)별로 경로 순서대로 지형 고도를 조회해 이동평균으로 스무딩한 뒤 적용한다.
    // ⚠️ 차량이 지형을 독립적으로 재조회(위 1~2단계)하는 것 자체가 근본 문제였다 — 도로는
    // NetworkDataSourceLayer.terrainHeightMap(링크 정점, ~1m 격자)으로 그려지는데, 차량은
    // 전혀 다른 점(차선 오프셋 경로)을 전혀 다른 격자(~11m)로 독립 조회하니 스무딩을 아무리
    // 해도 "도로가 실제로 서 있는 높이"와 근본적으로 다른 값이 나와 차량이 도로 위/아래로
    // 떴다 파묻혔다 했다(실사용자 관찰 — "잘못된 방식"). 이제 도로와 같은 소스
    // (networkLayer.getNearestTerrainHeight, 가장 가까운 링크 정점 캐시값)를 우선 쓰고,
    // 네트워크 레이어가 아직 없거나 그 지점이 커버 범위(기본 30m) 밖이면(예: 차량이 아직
    // 지형 미샘플링된 네트워크 위에 있을 때) 위 1~2단계에서 독립 샘플링한 값으로 폴백한다.
    // 폴백 구간에도 여전히 이동평균 스무딩을 적용해 격자 경계/표면 잡음으로 인한 튐을 흡수한다
    // (TerrainSlopeService 경사 계산 때와 동일한 근본 원인·동일한 해법).
    const HEIGHT_SMOOTH_WINDOW = 5;
    const half = Math.floor(HEIGHT_SMOOTH_WINDOW / 2);
    const scratch = new Cesium.Cartesian3();
    adjusted.forEach((track: any) => {
        const path: number[] = Array.isArray(track) ? track : track.path;

        const cartos: Cesium.Cartographic[] = [];
        const rawHeights: number[] = [];
        for (let i = 0; i + 3 < path.length; i += 4) {
            scratch.x = path[i + 1]; scratch.y = path[i + 2]; scratch.z = path[i + 3];
            const carto = Cesium.Cartographic.fromCartesian(scratch);
            const lngDeg = Cesium.Math.toDegrees(carto.longitude);
            const latDeg = Cesium.Math.toDegrees(carto.latitude);
            const roadH = networkLayer?.getNearestTerrainHeight(lngDeg, latDeg) ?? null;
            const key = `${carto.longitude.toFixed(GRID)},${carto.latitude.toFixed(GRID)}`;
            cartos.push(carto);
            rawHeights.push(roadH ?? (heightMap.get(key) ?? 0));
        }

        for (let idx = 0; idx < cartos.length; idx++) {
            const lo = Math.max(0, idx - half);
            const hi = Math.min(rawHeights.length - 1, idx + half);
            let sum = 0;
            for (let k = lo; k <= hi; k++) sum += rawHeights[k]!;
            const smoothedH = sum / (hi - lo + 1);

            const carto = cartos[idx]!;
            // 지형 위로 띄우는 버퍼(과거 +5m) 제거 — 차량이 지형보다 10m 가까이 떠 보이는
            // 원인이었다("줌인 시 차량 사라짐"을 막으려 도입했던 값인데, 그 부작용이 더 컸음).
            // "사라짐" 문제가 재발하면 위치를 띄우는 대신 다른 방식(깊이테스트 조정 등)으로 다시 다룰 것.
            const newPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, smoothedH);
            path[idx * 4 + 1] = newPos.x;
            path[idx * 4 + 2] = newPos.y;
            path[idx * 4 + 3] = newPos.z;
        }
    });

    return adjusted;
}

const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((state) => state.selectedScenarioVersion);

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);
    const refetchTrigger = useVehicleStore((state) => state.refetchTrigger);
    const selectedVehicleModel = useVehicleModelStore((s) => s.selectedModel);

    const heatmapSetting = {
        exaggeration: useHeatmapSettingStore.state.exaggeration(),
        colors: useHeatmapSettingStore.state.colors(),
        blur: useHeatmapSettingStore.state.blur(),
    };

    const setCzml = useVehicleStore((state) => state.setCzml);
    const setVehicleRoute = useVehicleStore((state) => state.setVehicleRoute);

    const setFeatures = useVehicleStore((state) => state.setFeatures);
    const vehicleRoute = useVehicleStore((state) => state.vehicleRoute);
    //신호
    const setSignalTimeline = useSignalTimelineStore((state) => state.setSignalTimeline);

    const viewerClockMultiplier = useRef(null);

    const viewer = useCesiumStore((state) => state.viewer);
    const layerManager: LayerManager | null = useLayerStore((state) => state.layerManager);
    const czml = useVehicleStore((state) => state.czml);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);
    // 뷰포트 스트리밍(팬/줌마다 재요청)이 setSimulation()을 겹쳐 호출할 수 있다 — 이전 호출이
    // 비동기 대기(CZML 로드, 지형 샘플링) 중 새 호출이 시작되면, 늦게 재개된 구 호출이
    // layerManager/dataSources/worker를 새 호출 것 위에 덮어써 차량이 사라지거나 undefined 참조
    // 오류가 난다. 매 setSimulation() 진입 시 세대를 증가시키고, 각 await 재개 지점에서 자신의
    // 세대가 여전히 최신인지 확인해 구버전이면 조용히 중단한다.
    const simGenRef = useRef(0);
    const vehicleRouteStartEndRef = useRef<any[] | null>(null);
    const needsReinitRef = useRef(false);

    // 최신 speed와 speedFactor를 참조하기 위한 ref
    const speedRef = useRef(speed);
    const speedFactorRef = useRef(speedFactor);
    const isRunningRef = useRef(isRunning);

    const lastUpdateTime = useRef(0);
    const lastOdUpdateTime = useRef(0);
    const lastSignalUpdateTime = useRef(0);
    const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());
    const lastPositionsRef = useRef([])
    const connectionFeatureMapRef = useRef<Map<string, Feature>>(new Map());

    // const changeModelWorkerRef = useRef<Worker | null>(null);
    const czmlPositionWorkerRef = useRef<Worker | null>(null);
    const updateFrameFuncRef = useRef<(() => void) | null>(null);
    const makeOdDataWorkerRef = useRef<Worker | null>(null);
    // 뷰포트 스트리밍 창의 simMin(전체 시뮬 시작 기준 오프셋, 초) — czmlPositionWorker에 넘길
    // "절대 경과초"를 계산하는 데 필요. 전체-로드 모드에서는 0으로 유지(= 그대로 정확).
    //
    // ⚠️ 버그였던 것: 이 값을 안 쓰고 worker가 매 init() 호출 시점을 0초로 재설정해 경과를
    // 셌다. 그런데 vehiclePathList의 각 포인트 t값은 vehicle_sim.db의 timestep 그대로(=
    // 시뮬레이션 전체 기준 절대 초)라서, viewport 스트리밍처럼 fromTime>0인 시간창을 불러오면
    // worker의 elapsed(0부터 시작)가 차량 경로의 절대 timestep(수백~초)과 전혀 안 맞아 거의
    // 모든 차량이 "이 순간엔 위치 없음(null)"으로 계산됐다 — 줌/팬 후 차량이 안 보이거나
    // 멈추는 것처럼 보인 근본 원인. viewer.clock.startTime(=baseEpoch+simMin, 문서 clock)
    // 기준 경과초 + simMin = 절대 timestep이 되도록 맞춰야 한다.
    const simMinRef = useRef(0);
    // 뷰포트 창 전환 중(새 응답 도착 ~ worker init 완료) tick 전송 차단 플래그.
    // 이 구간엔 simMinRef(새 창)와 clock.startTime/worker 경로(옛 창)가 서로 다른 창을 가리켜
    // computeElapsedSec가 창 오프셋 차이만큼 틀린 값을 내고, 그 값으로 옛 경로를 보간하면 모든
    // 차량이 수백 m~수 km를 일제히 점프해 trail이 그물 무늬를 그린다. tick을 잠깐(수백 ms~수 초)
    // 멈추면 trail은 마지막 위치에 정지해 있다가 새 창 init의 정합 위치부터 다시 이어진다.
    const streamTransitionRef = useRef(false);
    const computeElapsedSec = (v: Cesium.Viewer, clockTime: Cesium.JulianDate): number => {
        try { return simMinRef.current + JulianDate.secondsDifference(clockTime, v.clock.startTime); }
        catch { return 0; }
    };

    useEffect(() => {
        if (!czmlPositionWorkerRef.current) {
            czmlPositionWorkerRef.current = new Worker(new URL('/src/workers/czmlPositionWorker.ts', import.meta.url), { type: 'module' });
        }
        if (!makeOdDataWorkerRef.current) {
            makeOdDataWorkerRef.current = new Worker(new URL('/src/workers/makeOdDataWorker.ts', import.meta.url), { type: 'module' });
        }

        return () => {
            czmlPositionWorkerRef.current?.terminate();
            makeOdDataWorkerRef.current?.terminate();
            czmlPositionWorkerRef.current = null;
            makeOdDataWorkerRef.current = null;
        };
    }, []);

    // 원거리 줌에서 heatmap/trip 분석 레이어에 합성 차량 데이터를 공급 — viewer/layerManager가
    // 갖춰지면 한 번만 생성되어 setSimulation() 재호출과 무관하게 계속 산다(자체 카메라/재생시각 구독).
    const vehicleAggFeederRef = useRef<VehicleAggregationFeeder | null>(null);
    useEffect(() => {
        if (!viewer || !layerManager) return;
        if (!vehicleAggFeederRef.current) {
            vehicleAggFeederRef.current = new VehicleAggregationFeeder(viewer, layerManager);
        }
        return () => {
            vehicleAggFeederRef.current?.destroy();
            vehicleAggFeederRef.current = null;
        };
    }, [viewer, layerManager]);

    useEffect(() => {
        speedRef.current = speed;
    }, [ speed ]);

    useEffect(() => {
        speedFactorRef.current = speedFactor;
    }, [ speedFactor ]);

    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [ isRunning ]);

    // Cesium 시뮬레이션 업데이트 (재생/일시정지/초기화 적용)
    useEffect(() => {
        if (viewer) {
            try {
                layerManager.getLayerGroup("analyze").forEach((layer) => {
                    if ((layer as any).destroyed) return;
                    layer.setSpeed(speed * speedFactor);
                    layer.setStatus(isRunning);
                });
            } catch (e) {
                console.warn('[useSimulation] layer setSpeed/setStatus 오류(무시):', e);
            }

            viewerClockMultiplier.current = speed;

            viewer.clock.shouldAnimate = isRunning;
            viewer.clock.multiplier = viewerClockMultiplier.current;

            // 안전망: preRender 자기유지 루프 리스너가 어떤 경로로든(예외, isStop 리셋 후 재개
            // 시 loadCzmlDataSource가 재실행되지 않는 경우 등) 누락돼 있으면 재생 시작 시점에
            // 무조건 다시 보장한다 — remove 후 add는 이미 등록돼 있어도 안전한 멱등 동작이라
            // 중복 등록 걱정 없이 매번 호출해도 된다.
            if (isRunning) {
                viewer.scene.preRender.removeEventListener(updateFrameFunc);
                viewer.scene.preRender.addEventListener(updateFrameFunc);
            }

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
                viewer.clock.shouldAnimate = false;
                useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.startTime));
                useVehicleStore.getState().setActiveVehicleCount(0);

                // worker 리셋 — currentTime은 이제 절대 경과초(vehicle_sim.db timestep 기준)
                czmlPositionWorkerRef.current?.postMessage({ type: 'reset', currentTime: computeElapsedSec(viewer, viewer.clock.startTime) });

                // 신호 스타일 초기화 (updateSignalStyles는 epoch-ms 기준 — computeElapsedSec와는 다른 단위)
                const startSimTime = Cesium.JulianDate.toDate(viewer.clock.startTime).getTime();
                try {
                    const signalTimeline = useSignalTimelineStore.getState().signalTimeline;
                    if (signalTimeline?.length) {
                        updateSignalStyles(layerManager as any, viewer, connectionFeatureMapRef.current, signalTimeline, startSimTime);
                    }
                } catch (e) {
                    console.warn('[useSimulation] 신호 스타일 초기화 실패:', e);
                }

                // preRender 이벤트 먼저 제거 (destroyed 레이어 접근 방지)
                viewer.scene.preRender.removeEventListener(updateFrameFunc);
                // worker onmessage 해제 (destroyed 레이어에 setLatestPositions 방지)
                if (czmlPositionWorkerRef.current) czmlPositionWorkerRef.current.onmessage = null;
                if (makeOdDataWorkerRef.current) makeOdDataWorkerRef.current.onmessage = null;
                // OL 시뮬레이션 레이어 전체 제거 (trail/heatmap 등 초기화)
                layerManager?.removeSimulationLayers();

                // Cesium CZML 엔티티 숨기기
                if (czmlDataSourceRef.current) {
                    czmlDataSourceRef.current.show = false;
                }

                needsReinitRef.current = true;
            }

            // 정지 후 재생 시 레이어 재초기화
            if (isRunning && needsReinitRef.current) {
                needsReinitRef.current = false;
                setSimulation();
            }
        }
    }, [ isRunning, isStop, speed, speedFactor ]);

    // cesium heatmap
    useEffect(() => {
        if (!viewer) return;
        const layers = layerManager?.getLayer("analyze", "heatmap");
        (Array.isArray(layers) ? layers : [ layers ]).forEach((heatMap) => {
            if (heatMap instanceof HeatBarLayer) {
                heatMap.setColors(heatmapSetting.colors);
                heatMap.setExaggeration(heatmapSetting.exaggeration);
            }
        });
    }, [ heatmapSetting.colors, heatmapSetting.exaggeration ]);

    // ol heatmap
    useEffect(() => {
        if (!viewer) return;
        const layers = layerManager?.getLayer("analyze", "heatmap");
        (Array.isArray(layers) ? layers : [ layers ]).forEach((heatMap) => {
            if (heatMap instanceof Heatmap) {
                heatMap.setRadius(heatmapSetting.blur);
                heatMap.setBlur(heatmapSetting.blur);
                heatMap.setGradient(heatmapSetting.colors);
            }
        });
    }, [ heatmapSetting.colors, heatmapSetting.blur, heatmapSetting.exaggeration ]);

    useEffect(() => {
        // 버전 선택 전 로드 금지 — scenario.key로 폴백하면 이전(원본) 시뮬 데이터를
        // 로드해서 현재 버전에 데이터가 없어도 타임트랙이 떠버림. deps에 버전 키가
        // 있어야 버전 선택 시점에 올바른 키로 (재)실행된다.
        if (!selectedScenario || !selectedScenarioVersion) return;

        const scenarioKey = getActiveVersionId() ?? selectedScenario.key;
        const baseUrl = import.meta.env.VITE_API_URL;
        const requestBody = JSON.stringify({ numVehicle, speedFactor, czml });

        /**
         * signalTOD 스토어 데이터를 기반으로 시뮬레이션 시간대에 맞는
         * 신호 타임라인을 백엔드에서 가져와 스토어에 적용합니다.
         * TOD 구간이 여러 개인 경우 각 구간별로 백엔드를 호출한 뒤 병합합니다.
         */
        const applyTodSignalTimeline = async (czmlData: any, key: string) => {
            const simScenarioData = useSimulationScenarioStore.getState().currentJsonData as any;
            const todData = useSignalTodStore.getState().currentJsonData as any;

            if (!simScenarioData?.scenarios?.length || !todData?.nodes?.length) {
                console.log('[useSimulation] TOD 또는 시나리오 데이터 없음 - signalTOD 연동 건너뜀');
                return;
            }

            const simScenario = simScenarioData.scenarios[0];
            const simWallClockStart: string = simScenario?.startTime;
            if (!simWallClockStart) {
                console.log('[useSimulation] 시나리오 startTime 없음 - signalTOD 연동 건너뜀');
                return;
            }

            const czmlStartISO: string = czmlData[0].clock.currentTime;
            const czmlEndISO: string = czmlData[0].clock.interval.split('/')[1];
            const baseEpoch = Math.floor(new Date(czmlStartISO).getTime() / 1000);
            const simDurationSeconds = Math.floor(new Date(czmlEndISO).getTime() / 1000) - baseEpoch;

            const periods = computeTodPeriods(todData, simWallClockStart, simDurationSeconds, baseEpoch);
            if (periods.length === 0) {
                console.log('[useSimulation] 시뮬레이션 구간과 겹치는 TOD 계획 없음');
                return;
            }

            console.log(`[useSimulation] TOD 구간 ${periods.length}개로 신호 타임라인 생성 시작`, periods);

            const results = await Promise.all(
                periods.map(period =>
                    fetch(`${baseUrl}/vehicle/signal-timeline/${key}?baseEpoch=${period.baseEpochSeconds}&planId=${period.planId}&duration=${period.durationSeconds}`)
                        .then(r => r.ok ? r.json() : [])
                        .catch(() => [])
                )
            );

            const merged = mergeSignalTimelines(results);
            if (merged.length > 0) {
                console.log(`[useSimulation] TOD 신호 타임라인 병합 완료: ${merged.length}개 노드`);
                setSignalTimeline(merged);
            }
        };

        const applyRouteData = (data: any, opts?: { preserveClock?: boolean }) => {
            if (!data || !data.czml) return;
            const { czml: czmlData, positions, features, signalTimeline } = data;
            const vehicleCount = Array.isArray(positions) ? positions.length : 0;
            useLogStore.getState().addLog('info', `[차량 경로] 로드 완료 — 차량 ${vehicleCount}대`);
            // czml을 먼저 세팅해야 useEffect([vehicleRoute]) 실행 시 czml 클로저가 최신값을 가짐
            setCzml(czmlData);
            setFeatures(features);
            // viewport 스트리밍 응답에는 signalTimeline 이 없음 → 기존 타임라인 유지
            if (signalTimeline) setSignalTimeline(signalTimeline);
            // 스트리밍 재로드 시(preserveClock) 재생 위치/clock 을 건드리지 않음 → 끊김 없는 이어재생
            if (!opts?.preserveClock) {
                const clock = czmlData[0].clock;
                const [startTime, endTime] = czmlData[0].clock.interval.split('/');
                const start = JulianDate.fromIso8601(startTime);
                const end = JulianDate.fromIso8601(endTime);
                const current = JulianDate.fromIso8601(clock.currentTime);
                useSimulationStore.getState().setClock(start, end, current);
                // signalTOD 연동: TOD 기반 신호 타임라인으로 교체
                applyTodSignalTimeline(czmlData, scenarioKey);
            }
            // vehicleRoute를 마지막에 세팅 → useEffect([vehicleRoute]) 트리거 시 czml이 이미 준비됨
            setVehicleRoute(positions);
        };

        const setVehicleTask = (label: string | null) =>
            useBackgroundTaskStore.getState().setTask('vehicle-route', label);

        const fetchWithRetry = (retryCount = 0) => {
            fetch(`${baseUrl}/vehicle/vehicle-route/${scenarioKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody,
            }).then((r) => {
                if (r.status === 202) {
                    // 최대 120회 = 10분 (초반 5s, 이후 3s 간격)
                    if (retryCount < 120) {
                        return r.json().then((body: any) => {
                            const stage = body?.stage ?? '처리 중...';
                            const elapsed = body?.elapsed ?? 0;
                            const msg = `[차량 경로 생성 중] ${stage} (${elapsed}초 경과)`;
                            useLogStore.getState().addLog('info', msg);
                            setVehicleTask(`차량 경로 생성 중 — ${stage} (${elapsed}초)`);
                            console.log(`[useSimulation] ${msg}`);
                            // 초반 10회는 3s, 이후 5s 간격으로 폴링
                            const delay = retryCount < 10 ? 3000 : 5000;
                            setTimeout(() => fetchWithRetry(retryCount + 1), delay);
                        });
                    } else {
                        const msg = '차량 경로 생성 대기 시간 초과 (10분). 다시 시뮬레이션을 실행해 주세요.';
                        useLogStore.getState().addLog('warn', msg);
                        useMessageStore.getState().setMessage({ type: 'warn', text: msg });
                        setVehicleTask(null);
                    }
                    return null;
                }
                if (r.status === 422) {
                    return r.json().then((body: any) => {
                        const msg = body?.message ?? '시뮬레이션 결과 데이터가 없습니다.';
                        console.warn(`[useSimulation] 경로 생성 실패: ${msg}`);
                        useMessageStore.getState().setMessage({ type: 'error', text: msg });
                        setVehicleTask(null);
                        return null;
                    });
                }
                if (!r.ok) {
                    console.warn(`[useSimulation] 차량 경로 로드 실패 (${r.status}):`, scenarioKey);
                    setVehicleTask(null);
                    return null;
                }
                setVehicleTask(null);
                return r.json();
            }).then((data) => {
                if (data) applyRouteData(data);
            }).catch(() => {
                setVehicleTask(null);
            });
        };
        // ─────────── viewport+시간창 스트리밍 (대용량 시나리오, 개별 차량 near LOD) ───────────
        // 전체 czml(수백MB~GB) 대신 카메라 viewport + 재생 시간창의 차량만 로드.
        // 카메라 정착/재생 창 경계 접근 시 재요청, clock 은 첫 로드에만 설정(이어재생).
        const startViewportStreaming = (): (() => void) => {
            useLogStore.getState().addLog('info', '[차량 경로] viewport 스트리밍 모드 (대용량)');
            let firstLoad = true;
            let lastBboxKey = '';
            let windowFrom = 0, windowTo = -1; // 로드된 시간창 (버퍼 제외, 시뮬 초)
            let simMin = 0;
            let fetching = false;
            let timer: ReturnType<typeof setTimeout> | null = null;
            let lastModeSwitchAt = 0; // 밀집↔개별 마지막 전환 시각 (연속 전환 방지)
            // 이 스트리밍 세션이 정리(effect 재실행/언마운트)된 뒤 늦게 도착한 fetch 응답이 새
            // 세션의 상태를 낡은 데이터로 덮어쓰지 않도록 하는 가드 (setSimulation의 simGenRef와
            // 동일 목적 — 이 클로저 전용). 아래 cleanup에서 true로 설정.
            let cancelled = false;
            // 직전 응답에 포함됐던 veh_id — 다음 요청에 stickyIds로 실어 보내 선별 우선순위를 준다
            // (readVehicleEventsFiltered 참고 — 창 슬라이드로 인한 순위 요동으로 방금 보이던
            // 차량이 다음 fetch에서 통째로 빠지는 "깜빡임" 방지).
            let lastVehicleIds: string[] = [];

            // 카메라 viewport bbox — computeViewportMetrics()(공용 유틸, TrafficHeatmapCesiumLayer/
            // TrafficTailCesiumLayer와 동일 계산)의 pixelSizeM으로 개별 차량 티어 여부를 판정하고,
            // MAX_BBOX_DEG는 그 안에서 실제 요청 bbox 크기만 절삭한다(VEHICLE_ZOOM_TIER_PX_M 참고 —
            // 세 줌 티어 임계값이 전부 이 pixelSizeM 단위 하나로 통일되어 서로 어긋날 수 없다).
            const computeBbox = (forInitialLoad = false): { w: number; s: number; e: number; n: number } | null => {
                const v = useCesiumStore.getState().viewer;
                if (!v) return null;
                const metrics = computeViewportMetrics(v);
                if (!metrics) return null; // 하늘을 보는 시점 등 — 다음 정착 때 재시도
                const { normalizedPixelSizeM } = metrics;

                let { w, s, e, n } = metrics.bbox;
                // 카메라 flight 애니메이션 중간 프레임 등에서 groundDist≈0 → bbox가 한 점으로
                // 붕괴하는 이상치 프레임 방지 (그대로 fetch하면 서버가 0대 응답 → 차량 전체 소실).
                if (e - w < VEHICLE_STREAMING.MIN_BBOX_DEG || n - s < VEHICLE_STREAMING.MIN_BBOX_DEG) return null;
                // normalizedPixelSizeM 사용 — 네트워크 실제 크기 대비 상대적 줌 단계로 판정해야
                // 소형(부천 규모)/광역 시나리오 모두에서 개별→flow 전환이 올바른 지점에서 일어난다.
                // ⚠️ 단, 최초 로드(forInitialLoad)는 이 판정으로 걸러내지 않는다 — clock/타임라인
                // 초기화가 이 fetch의 성공 1회에 물려있는데(위 startViewportStreaming 주석 참고),
                // 시나리오를 막 열었을 때 카메라가 이미 이 임계값보다 넓게 보고 있으면(광역 시나리오
                // 흔함) 여기서 계속 null이 나가 fetch 자체가 한 번도 안 일어나 clock이 영원히
                // 설정되지 않았다("줌인해야만 로드됨" 원인, 실사용자 확인) — 최초 요청은 무조건
                // 내보내고, 밀집(dense) 판정은 응답의 truncated 여부로 이미 처리되고 있으므로
                // 그쪽에 맡긴다.
                if (!forInitialLoad && normalizedPixelSizeM >= VEHICLE_STREAMING.MAX_PIXEL_SIZE_M) return null; // 줌아웃 → flow/히트맵 담당
                // 소폭 초과는 중앙 기준으로 절삭 (요청 크기 안전판)
                const MAX = VEHICLE_STREAMING.MAX_BBOX_DEG;
                if (e - w > MAX) { const c = (w + e) / 2; w = c - MAX / 2; e = c + MAX / 2; }
                if (n - s > MAX) { const c = (s + n) / 2; s = c - MAX / 2; n = c + MAX / 2; }
                return { w, s, e, n };
            };

            // 현재 재생 경과 초 (clock 시작 기준)
            const currentElapsed = (): number => {
                const sim = useSimulationStore.getState() as any;
                const cur = sim.currentTime;
                const start = sim.startTime ?? sim.simStartTime;
                if (!cur || !start) return 0;
                try { return Math.max(0, JulianDate.secondsDifference(cur, start)); } catch { return 0; }
            };

            let lastFetchWall = 0;
            let simMax = Infinity;
            let pendingRetryTimer: ReturnType<typeof setTimeout> | null = null;
            let retryAfterFetch = false;

            const doFetch = (force = false) => {
                if (fetching) { retryAfterFetch = true; return; } // 진행 중 fetch 끝나면 최신 상태로 재시도
                const bbox = computeBbox(firstLoad);
                if (!bbox) return;
                // toFixed(3)(≈111m) — 카메라 관성 감쇠(inertia) 동안 화면 중앙 지면점이 매
                // camera.changed마다 미세하게(수~수십m) 흔들리는데, 4자리(≈11m)로는 "사실상
                // 같은 위치"도 매번 다른 키로 판정돼 감쇠가 끝날 때까지 반복 재요청됐다(실사용 보고
                // "요청이 너무 잦음"). 실제 요청 bbox 좌표(아래 fetch body)는 원본 정밀도 그대로.
                const bboxKey = `${bbox.w.toFixed(3)},${bbox.s.toFixed(3)},${bbox.e.toFixed(3)},${bbox.n.toFixed(3)}`;
                const cur = simMin + currentElapsed();
                const windowOk = windowTo > 0 && cur >= windowFrom && cur < windowTo - VEHICLE_STREAMING.REFETCH_REMAIN_SEC;
                if (!force && bboxKey === lastBboxKey && windowOk) return; // 같은 bbox + 창 여유 → 스킵
                // 벽시계 최소 간격 — 재로드는 32MB fetch + 전체 시뮬 레이어 재구성이라, 재생 배속으로
                // 시간창이 빨리 소진되어도 수 초마다 반복되면 시뮬/타일 렌더가 전부 굶는다.
                const sinceLastFetch = performance.now() - lastFetchWall;
                if (!force && sinceLastFetch < 8000) {
                    // 쿨다운 내 요청을 그냥 버리면(기존 버그) — 재생이 정지된 상태거나 카메라가
                    // 짧은 간격으로 두 번 움직인 경우 이후 트리거가 없어 마지막 뷰포트의 차량이
                    // 영영 로드되지 않는다. 버리는 대신 쿨다운 종료 시점으로 재시도를 예약한다.
                    if (pendingRetryTimer) clearTimeout(pendingRetryTimer);
                    pendingRetryTimer = setTimeout(() => { pendingRetryTimer = null; doFetch(); }, 8000 - sinceLastFetch + 50);
                    return;
                }

                // 시간창을 재생 배속(Cesium clock multiplier)에 비례해 확장하되 **상한 300s** — 배속
                // 30x에 무제한 확장하면 창=시뮬 전체(3,600s)가 되어 차량 수천 대 전체 궤적 로드 →
                // czml 엔티티 폭증으로 FPS 한 자리 추락 (실사용 회귀). 창이 크면 선별 차량 수·heap
                // 이 함께 커진다. speedFactor(차량 실주행 속도 km/h)가 아닌 실제 배속을 참조할 것.
                const mult = Math.min(2.5, Math.max(1, ((useSimulationStore.getState() as any).speed || 1) / 12));
                const windowSec = Math.min(300, VEHICLE_STREAMING.TIME_WINDOW_SEC * mult);
                const from = Math.max(0, Math.floor(cur));
                const to = from + windowSec;
                fetching = true;
                lastFetchWall = performance.now();
                fetch(`${baseUrl}/vehicle/vehicle-route/${scenarioKey}/viewport`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bbox: `${bbox.w},${bbox.s},${bbox.e},${bbox.n}`,
                        fromTime: from, toTime: to,
                        bufferSec: VEHICLE_STREAMING.BUFFER_SEC,
                        numVehicle: VEHICLE_STREAMING.MAX_VEHICLES, // 상한 (초과 시 체류시간 우선 선별)
                        stickyIds: lastVehicleIds, // 직전 응답 차량 우선순위 (선별 연속성 — 깜빡임 방지)
                    }),
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        if (cancelled) return; // 세션이 이미 정리됨 — 새 세션 상태를 낡은 데이터로 덮어쓰지 않음
                        if (!data) return;
                        simMin = Array.isArray(data.simRange) ? (data.simRange[0] ?? 0) : 0;
                        simMax = Array.isArray(data.simRange) ? (data.simRange[1] ?? Infinity) : Infinity;
                        // ⚠️ simMinRef는 여기서 갱신하지 않는다! computeElapsedSec = simMinRef +
                        // (clock.currentTime - clock.startTime)인데, clock/worker 경로 데이터는 이
                        // 응답이 setSimulation을 완전히 통과한 뒤(czml 로드 등 수 초 뒤)에나 새 창으로
                        // 교체된다. 여기서 먼저 simMinRef만 새 창 값으로 바꾸면 그 사이 매 프레임
                        // tick이 "새 simMin + 옛 clock 경과"라는 불일치 값을 옛 경로에 적용해 — 창이
                        // 예컨대 500→590초로 바뀌는 순간 모든 차량이 90초치(속도×90s≈0.5~2km)를
                        // 일제히 점프한다. null도 아니고 세대도 같고 10km 미만이라 어떤 리셋 가드에도
                        // 안 걸려, trail이 점프 전후를 직선으로 이어 그리는 그물 무늬가 창 롤오버/
                        // 카메라 재로드마다 재발했다. simMinRef 갱신은 applyRouteData 직전(전환 tick
                        // 차단과 함께) — 아래 streamTransitionRef 참고.
                        windowFrom = from; windowTo = to;
                        lastBboxKey = bboxKey;
                        lastVehicleIds = Array.isArray(data.positions)
                            ? data.positions.map((p: any) => p.id).filter(Boolean)
                            : [];

                        // ── 밀집 전환: viewport 차량이 상한 초과 → 개별 차량 대신 집계 히트맵 ──
                        // 히스테리시스: 진입 = truncated(total > MAX), 해제 = total < MAX×EXIT_RATIO.
                        // 경계값 부근에서 팬마다 왕복 진동 방지 + 최소 전환 간격으로 깜빡임 억제.
                        const total = Number(data.totalVehicles ?? 0);
                        const shown = Array.isArray(data.positions) ? data.positions.length : 0;
                        const wasDense = (useVehicleStore.getState() as any).denseViewport === true;
                        const exitThreshold = VEHICLE_STREAMING.MAX_VEHICLES * VEHICLE_STREAMING.DENSE_EXIT_RATIO;
                        let dense = wasDense ? total >= exitThreshold : data.truncated === true;
                        if (dense !== wasDense) {
                            const nowMs = performance.now();
                            if (nowMs - lastModeSwitchAt < VEHICLE_STREAMING.MODE_SWITCH_MIN_MS) {
                                dense = wasDense; // 너무 잦은 전환 → 현 모드 유지 (다음 fetch에서 재평가)
                            } else {
                                lastModeSwitchAt = nowMs;
                            }
                        }
                        (useVehicleStore.getState() as any).setDenseViewport(dense);
                        (useVehicleStore.getState() as any).setViewportVehicleInfo(
                            { shown: dense ? 0 : shown, total, dense });

                        if (dense) {
                            if (!wasDense) {
                                useLogStore.getState().addLog('info',
                                    `[차량] viewport 차량 ${total.toLocaleString()}대 — 상한 초과, 개별 차량 대신 히트맵/trip 집계로 전환`);
                                layerManager?.hideLayer('analyze', 'vehicle');
                                // heatmap/trip 표시 전환은 VehicleAggregationFeeder가 denseViewport
                                // 구독으로 자체 처리 — 여기서 별도 show/hide 불필요.
                            }
                            if (firstLoad) {
                                // 재생 clock 초기화는 필요 (document packet만 적용, 차량은 비움)
                                streamTransitionRef.current = true;
                                simMinRef.current = simMin;
                                applyRouteData({ ...data, czml: [data.czml[0]], positions: [], features: [] });
                            }
                            // 개별 차량 데이터는 적용하지 않음 (worker 재빌드 비용 절약, 히트맵/trip이 대체)
                            firstLoad = false;
                            return;
                        }
                        if (wasDense) {
                            // 밀집 해제 (줌인 등) → 개별 차량 복귀
                            layerManager?.showLayer('analyze', 'vehicle');
                        }
                        // 전환 시작: 새 창 데이터가 worker/clock까지 완전히 교체될 때까지 tick 중단
                        // (simMinRef와 clock.startTime이 서로 다른 창을 가리키는 불일치 구간 차단 —
                        // 위 simRange 주석 참고). setSimulation의 worker init 직후 해제된다.
                        streamTransitionRef.current = true;
                        simMinRef.current = simMin;
                        applyRouteData(data, { preserveClock: !firstLoad });
                        firstLoad = false;
                    })
                    .catch((e) => console.warn('[useSimulation] viewport 스트리밍 실패:', e))
                    .finally(() => {
                        fetching = false;
                        if (retryAfterFetch) { retryAfterFetch = false; doFetch(); }
                    });
            };

            const schedule = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => { timer = null; doFetch(); }, VEHICLE_STREAMING.DEBOUNCE_MS);
            };

            // ── "지금 이 순간" 활성 차량 수 폴링 (지도 하단 배지 전용) ──
            // 위 doFetch()의 totalVehicles는 CZML 프리페치 창(최대 300초) 동안의 누적 통행량이라
            // 화면 표시로 그대로 쓰면 "차량이 안 보이는데 수백 대"로 보이는 오해를 준다(실측 보고).
            // 별도의 가벼운 COUNT 쿼리(/active-count, ±3초)를 재생 중 주기적으로 불러 activeNow로
            // 갱신한다 — doFetch()보다 훨씬 자주(재생 시각이 계속 바뀌므로) 돌아야 해서 분리했다.
            let activeCountInFlight = false;
            const fetchActiveCount = () => {
                if (activeCountInFlight) return;
                const prev = (useVehicleStore.getState() as any).viewportVehicleInfo;
                if (!prev) return; // 최초 doFetch 완료 전(shown/total/dense 미설정) — 스킵
                const bbox = computeBbox(true); // 개별 차량 티어 게이팅과 무관하게 항상 계산
                if (!bbox) return;
                const cur = simMin + currentElapsed();
                activeCountInFlight = true;
                fetch(`${baseUrl}/vehicle/vehicle-route/${scenarioKey}/active-count`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bbox: `${bbox.w},${bbox.s},${bbox.e},${bbox.n}`, fromTime: Math.round(cur) }),
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        if (!data) return;
                        const latest = (useVehicleStore.getState() as any).viewportVehicleInfo;
                        if (!latest) return; // 그 사이 스트리밍이 정리됨(시나리오 전환 등)
                        (useVehicleStore.getState() as any).setViewportVehicleInfo(
                            { ...latest, activeNow: data.count ?? 0 });
                    })
                    .catch(() => {})
                    .finally(() => { activeCountInFlight = false; });
            };
            const activeCountTimer = setInterval(fetchActiveCount, 3000);

            // 카메라 정착 → bbox 변경 감지.
            // ⚠️ 이 useEffect 는 Cesium viewer 생성 이전에 실행될 수 있다(시나리오 선택 직후 vs Maps 마운트).
            // viewer 없이 등록을 건너뛰면 스트리밍이 영영 시작 안 됨 → viewer 준비까지 폴링 후 초기화.
            const camHandler = () => schedule();
            let camViewer: any = null;
            let viewerWaitTimer: ReturnType<typeof setInterval> | null = null;
            const initWithViewer = () => {
                const v = useCesiumStore.getState().viewer;
                if (!v) return false;
                camViewer = v;
                v.camera.changed.addEventListener(camHandler);
                doFetch(true); // 초기 로드
                return true;
            };
            if (!initWithViewer()) {
                let waits = 0;
                viewerWaitTimer = setInterval(() => {
                    if (initWithViewer() || ++waits > 120) { // 최대 60s 대기
                        if (viewerWaitTimer) { clearInterval(viewerWaitTimer); viewerWaitTimer = null; }
                    }
                }, 500);
            }
            // 재생 시각 → 창 경계 접근 시 다음 창 prefetch
            const unsubTime = (useSimulationStore as any).subscribe(
                (s: any) => s.currentTime,
                () => {
                    if (windowTo < 0) return;
                    const cur = simMin + currentElapsed();
                    if (cur >= windowTo - VEHICLE_STREAMING.REFETCH_REMAIN_SEC || cur < windowFrom) schedule();
                },
            );

            return () => {
                cancelled = true; // in-flight fetch 응답이 이후 새 세션 상태를 덮어쓰지 않도록
                camViewer?.camera.changed.removeEventListener(camHandler);
                if (viewerWaitTimer) clearInterval(viewerWaitTimer);
                unsubTime();
                if (timer) clearTimeout(timer);
                if (pendingRetryTimer) clearTimeout(pendingRetryTimer);
                clearInterval(activeCountTimer);
                (useVehicleStore.getState() as any).setDenseViewport(false); // 시나리오 전환 시 밀집 모드 해제
                (useVehicleStore.getState() as any).setViewportVehicleInfo(null);
            };
        };

        // 시뮬 데이터(CZML 캐시 or vehicle_sim.db)가 있을 때만 로드.
        // 무조건 POST 하면 백엔드가 데이터 없음 → 더미 차량 자동 생성 + SFTP 업로드까지 해버림
        // (사용자가 생성한 적 없는 더미가 계속 생기던 원인). 명시적 생성은 온보딩 버튼 경로만.
        let streamingCleanup: (() => void) | null = null;
        let disposed = false;
        fetch(`${baseUrl}/vehicle/vehicle-route/${scenarioKey}/exists`)
            .then((r) => (r.ok ? r.json() : null))
            .then((info) => {
                if (!info || disposed) return;
                // 타일 모드 + 시뮬 원본 존재 → viewport 스트리밍 (상시 타일 모드에서 기본 경로)
                if (VEHICLE_STREAMING.ENABLED && info.simDbExists
                        && (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode)) {
                    streamingCleanup = startViewportStreaming();
                    return;
                }
                if (info.exists || info.generating || info.simDbExists) {
                    useLogStore.getState().addLog('info', `[차량 경로] ${scenarioKey} — 서버에서 데이터를 가져옵니다...`);
                    fetchWithRetry();
                } else {
                    useLogStore.getState().addLog('info', '[차량 경로] 시뮬레이션 데이터 없음 — 로드 건너뜀');
                }
            })
            .catch(() => { /* exists 확인 실패 시 로드 안 함 (더미 생성 방지 우선) */ });

        return () => { disposed = true; streamingCleanup?.(); };
    }, [ numVehicle, speedFactor, selectedScenario?.key, selectedScenarioVersion?.key, refetchTrigger ]);

    // Cesium과 OpenLayers 시뮬레이션 통합: 후처리 및 Cesium 관련 설정
    useEffect(() => {
        if (!Array.isArray(vehicleRoute)) return;
        if (vehicleRoute.length === 0) {
            // 스트리밍 viewport 0대 응답(차량 없는 지역 팬/밀집 전환): 조기 반환만 하면
            // 이전 viewport 차량들이 마지막 위치에 그려진 채 남는다 → 차량(개별) 계열 레이어만 제거.
            //
            // ⚠️ 예전엔 여기서 removeSimulationLayers()를 썼는데, 그건 heatmap/trip/odFlow까지
            // 전부 destroy한다 — 이 effect는 vehicleRoute가 (내용은 같아도) 새 배열 참조로 바뀔
            // 때마다 매번 재실행되므로("초기화됐다가 다시 생긴다"는 게 바로 이거), 원거리에서
            // 계속 켜져 있어야 할 heatmap/trip이 몇 초~수십 초마다 파괴→재생성을 반복해 깜빡였다.
            // heatmap/trip/odFlow는 개별 차량과 무관하게 자체(VehicleAggregationFeeder)의 zoom/dense
            // 감지로 표시 여부를 결정하는 독립 레이어이므로, 여기서는 건드리지 않고 "없을 때만" 만든다.
            vehicleRouteStartEndRef.current = [];
            lastPositionsRef.current = [];
            czmlPositionWorkerRef.current?.postMessage({ type: 'init', czmlPackets: [], currentTime: 0 });
            streamTransitionRef.current = false; // 빈 창도 전환 종료 (tick은 빈 목록이라 무해)
            // ⚠️ 이전 실차량 setSimulation()에서 등록된 worker onmessage 핸들러가 이 지점까지 살아있으면
            // (여기선 isStop처럼 명시적으로 해제한 적이 없었음) — 재생 중(clock 진행 중)에는 매
            // tick 응답마다 "analyze" 그룹의 모든 레이어(heatmap 포함, 필터 없이 전부)에
            // setLatestPositions(worker 결과)를 그대로 먹인다. czmlPackets를 방금 []로 리셋했으니
            // worker 결과는 사실상 빈/무효 데이터인데, 이게 VehicleAggregationFeeder가 heatmap에
            // 공급 중인 정상 데이터를 주기적으로 덮어써 "재생할 때만 깜빡"이는 원인이었다(정지 중엔
            // clock이 안 도니 worker tick 자체가 안 옴 → 간섭 없음). 여기서도 명시적으로 해제한다.
            if (czmlPositionWorkerRef.current) czmlPositionWorkerRef.current.onmessage = null;
            layerManager?.removeVehicleLayer();
            layerManager?.removeODArrows();
            if (!layerExists(layerManager, "analyze", "odFlow")) {
                layerManager?.addOdFlowLayer();
            }
            if (!layerExists(layerManager, "analyze", "congestion")) {
                layerManager?.addCongestionLayer();
            }
            if (!layerExists(layerManager, "analyze", "los")) {
                layerManager?.addLosLayer();
            }
            if (!layerExists(layerManager, "analyze", "bottleneck")) {
                layerManager?.addBottleneckLayer();
            }
            if (!layerExists(layerManager, "analyze", "region")) {
                layerManager?.addRegionTrafficLayer();
            }
            if (!layerExists(layerManager, "analyze", "regionOdGraph")) {
                layerManager?.addRegionOdGraphLayer();
            }
            if (!layerExists(layerManager, "analyze", "congestionGraph")) {
                layerManager?.addCongestionGraphLayer();
            }
            if (!layerExists(layerManager, "analyze", "isochrone")) {
                layerManager?.addIsochroneLayer();
            }
            if (!layerExists(layerManager, "analyze", "heatmap")) {
                layerManager?.addHeatmapLayer([], new VectorSource(), speedFactor, isRunningRef.current, heatmapSetting);
            }
            if (!layerExists(layerManager, "analyze", "trip")) {
                // TailPrimitive는 생성자에 넘긴 배열 길이만큼만 trail GPU 자원을 고정 할당한다 — []를
                // 넘기면 trail이 0개라 VehicleAggregationFeeder가 이후 아무리 setLatestPositions()로
                // 합성 차량 위치를 먹여도 담을 슬롯이 없어 전부 버려진다("trip이 절대 안 보임" 원인).
                // MAX_SYNTHETIC_VEHICLES 만큼 더미 슬롯을 미리 만들어둔다(위치는 즉시 덮어써지므로 무의미).
                layerManager?.addTripLayer(
                    Array.from({ length: VEHICLE_AGG_FEED.MAX_SYNTHETIC_VEHICLES }, (_, i) => [i, 0, 0, 0]),
                    speedFactor, isRunningRef.current,
                );
            }
            return;
        }

        // 신규 포맷({path, type, ...})과 레거시 포맷(flat array) 모두 처리
        const rawPaths = vehicleRoute.map((entry: any) =>
            Array.isArray(entry) ? entry : (entry.path ?? [])
        );
        const parsedVehicleRoute = parseRawODInputFromFlatArray(rawPaths);
        const simplified = parsedVehicleRoute
            .map(route => {
                if (route.length >= 2) {
                    return [ route[0], route[route.length - 1] ];
                } else {
                    return route; // 길이가 1 이하인 경우 그대로 유지
                }
            });
        vehicleRouteStartEndRef.current = simplified;
        setSimulation();

        // isRunning은 isRunningRef.current로 별도 처리
    }, [ vehicleRoute ]);

    // useRef로 안정적인 참조 유지 - 렌더마다 새 함수가 생성되면 removeEventListener가 동작 안함
    updateFrameFuncRef.current = () => {
        const currentTime = performance.now();
        const simTime = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()

        // ⚠️ 아래 어디서든(worker postMessage, 신호 스타일 갱신 등) 예외가 나면 그 프레임에서
        // 함수가 그대로 종료돼 self-sustain 렌더 요청까지 도달하지 못한다 — 그 순간부터 카메라를
        // 움직이기 전까진 화면이 다시 갱신되지 않는 채로 조용히 멈춘다(실사용 재현된 증상).
        // try/finally로 무슨 일이 있어도 다음 프레임 렌더 요청만은 실행되도록 보장한다.
        try {
            if (currentTime - lastOdUpdateTime.current >= 1000) {
                lastOdUpdateTime.current = currentTime;
                const newVehicleRoute = vehicleRouteStartEndRef.current;
                const lastPositions = lastPositionsRef.current.positions;
                makeOdDataWorkerRef.current?.postMessage({ lastPositions, newVehicleRoute })
            }
            if (currentTime - lastUpdateTime.current >= 50 && isRunningRef.current) {
                lastUpdateTime.current = currentTime;
                // 창 전환 중엔 tick 전송만 중단(시각 store 갱신 등은 유지) — simMinRef(새 창)와
                // clock/worker 경로(옛 창)의 불일치 경과초로 옛 경로를 보간하면 전 차량이 일제히
                // 점프해 trail 그물이 생긴다(streamTransitionRef 선언부 주석 참고). worker init 직후 재개.
                if (!streamTransitionRef.current) {
                    // currentTime: 절대 경과초(vehicle_sim.db timestep 기준) — computeElapsedSec 주석 참고
                    czmlPositionWorkerRef.current?.postMessage({ type: 'tick', currentTime: computeElapsedSec(viewer, viewer.clock.currentTime) });
                }
                useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.currentTime));

                // ⚠️ viewer.clock.clockRange가 기본값(UNBOUNDED)이라 아무 것도 안 하면 clock이
                // stopTime을 넘어서도 계속 흘러간다 — 차량은 전부 트립이 끝나 화면에서 사라진
                // 채로 "재생 중" 상태만 영원히 남고, 자동으로 멈추거나 초기화되지 않는다(점검
                // 요청으로 실측 확인 — 완료 처리가 아예 없었음). stop()을 호출하면 isRunning=
                // false/isStop=true가 되어 기존 정지 로직(클럭을 시작점으로 되돌리고 레이어
                // 정리)이 그대로 처리한다(사용자 확인: "재생 전" 상태가 맞음).
                if (Cesium.JulianDate.greaterThanOrEquals(viewer.clock.currentTime, viewer.clock.stopTime)) {
                    useSimulationStore.getState().stop();
                }

                const signalInterval = Math.max(200, 1000 / (speedRef.current || 1));
                if (currentTime - lastSignalUpdateTime.current >= signalInterval) {
                    lastSignalUpdateTime.current = currentTime;
                    const signalTimeline = useSignalTimelineStore.getState().signalTimeline;
                    if (signalTimeline?.length) {
                        updateSignalStyles(layerManager as any, viewer, connectionFeatureMapRef.current, signalTimeline, simTime);
                    }
                }
            }
        } finally {
            // requestRenderMode(+ maximumRenderTimeChange:Infinity)에서는 카메라가 안 움직이면
            // scene.preRender 자체가 다시 호출되지 않는다 — 이 함수가 preRender 리스너이므로,
            // 재생 중에는 위에서 무슨 예외가 나든 상관없이 다음 프레임 렌더를 스스로 요청해야
            // 자기유지 루프를 만들 수 있다. 없으면 지도를 움직여 우연히 트리거된 렌더가 끝나는
            // 순간(=팬 종료 시점) 재생이 멈춘다.
            if (isRunningRef.current) viewer.scene.requestRender();
        }
    };

    // 고정된 wrapper 함수 - addEventListener/removeEventListener에 항상 같은 참조를 사용
    const updateFrameFunc = useRef(() => {
        updateFrameFuncRef.current?.();
    }).current;

    const setSimulation = async () => {
        if (!viewer || !czml || vehicleRoute.length === 0 || !layerManager) return;
        const myGen = ++simGenRef.current;

        // 스토어가 비어있으면 먼저 fetch
        let { models, vehicleTypes, setModels, setVehicleTypes } = useVehicleModelStore.getState();
        if (models.length === 0 || vehicleTypes.length === 0) {
            try {
                const axiosInstance = (await import('@api/axiosInstance')).default;
                const [modelsData, typesData] = await Promise.all([
                    axiosInstance.get('/vehicle-models').then(r => r.data).catch(() => []),
                    axiosInstance.get('/vehicle-types').then(r => r.data).catch(() => []),
                ]);
                models = Array.isArray(modelsData) ? modelsData : [];
                vehicleTypes = Array.isArray(typesData) ? typesData : [];
                setModels(models);
                setVehicleTypes(vehicleTypes);
            } catch (e) {
                console.warn('[setSimulation] 모델 데이터 로드 실패:', e);
            }
        }
        if (myGen !== simGenRef.current) return; // 대기 중 더 새 호출이 시작됨 — 중단

        connectionFeatureMapRef.current.clear();

        loadCzmlDataSource(czml, myGen).then((czmlSource) => {
            if (!czmlSource || myGen !== simGenRef.current) {
                // stale이면 더 새 세대가 전환을 이어받아 해제하지만, czml 로드 실패(현재 세대)면
                // 여기서 해제하지 않을 시 tick이 영구 정지된다 — 실패 시에도 반드시 해제.
                if (myGen === simGenRef.current) streamTransitionRef.current = false;
                return;
            }

            viewer.clock.shouldAnimate = isRunningRef.current;

            // 레이어 초기화 — 차량(Cesium VehiclePrimitive)은 여기서 destroy하지 않는다.
            // addVehicleLayer()가 같은 차종(GLB)이면 기존 GPU 리소스를 유지한 채 인스턴스만
            // 갱신한다(destroy+재생성 시 GLB 재파싱 대기 동안 차량이 사라지는 "나타났다
            // 사라졌다" 현상 방지). 더 이상 나타나지 않는 차종은 아래 pruneVehicleTypes()가 정리.
            layerManager.removeSimulationLayersExceptVehicle();
            const vectorSource = new VectorSource();
            const typeGroups  = new Map<string, any[]>();
            const scaleGroups = new Map<string, number[]>();  // per-vehicle length (m)
            const vehicleTypeArray: string[] = [];  // 전체 차량 순서의 타입 배열 (TailPrimitive 색상용)
            vehicleRoute.forEach((entry: any, idx: number) => {
                const isLegacy = Array.isArray(entry);
                const path = isLegacy ? entry : entry.path;
                let vType: string;
                if (isLegacy) {
                    // 레거시 배열: 인덱스 기반 타입 배정 (백엔드와 동일한 비율)
                    const mod = idx % 100;
                    if (mod < 70)       vType = 'CAR';
                    else if (mod < 85)  vType = 'TAXI';
                    else if (mod < 95)  vType = 'BUS';
                    else if (mod < 99)  vType = 'TRUCK';
                    else                vType = 'MOTO';
                } else if (entry.type) {
                    vType = entry.type;
                } else {
                    // type 없는 캐시 데이터 → 백엔드와 동일한 ID 기반 배정
                    const numId = parseInt(String(entry.id ?? '0').replace(/\D/g, '')) || 0;
                    const mod = numId % 100;
                    if (mod < 70)       vType = 'CAR';
                    else if (mod < 85)  vType = 'TAXI';
                    else if (mod < 95)  vType = 'BUS';
                    else if (mod < 99)  vType = 'TRUCK';
                    else                vType = 'MOTO';
                }
                vehicleTypeArray.push(vType);
                if (!typeGroups.has(vType))  typeGroups.set(vType, []);
                if (!scaleGroups.has(vType)) scaleGroups.set(vType, []);
                typeGroups.get(vType)!.push(path);
                scaleGroups.get(vType)!.push(isLegacy ? 0 : (entry.length ?? 0) as number);
            });
            console.log('[setSimulation] vehicleRoute sample:', vehicleRoute[0], '| typeGroups:', [...typeGroups.entries()].map(([k, v]) => `${k}:${v.length}`));

            // DB vehicle_type_model.color 기반 색상 맵 (vehicleType → hex)
            const typeColorMap: Record<string, string> = {};
            vehicleTypes.forEach(vt => {
                const m = models.find(mo => mo.vehicleTypeId === vt.id);
                if (m?.color) typeColorMap[vt.vehicleId.toUpperCase()] = m.color;
            });

            const { correctionByType } = useVehicleModelStore.getState();

            const resolveCorrectionHpr = (vType: string, modelCfg?: string | { heading: number; pitch: number; roll: number }) => {
                // DB 모델에 correctionHpr이 있으면 최우선 사용 (JSON 문자열일 수 있음)
                if (modelCfg) {
                    try {
                        const parsed = typeof modelCfg === 'string' ? JSON.parse(modelCfg) : modelCfg;
                        if (parsed && parsed.heading != null) {
                            console.log(`[resolveCorrectionHpr] type=${vType} from DB:`, parsed);
                            return new Cesium.HeadingPitchRoll(parsed.heading, parsed.pitch, parsed.roll);
                        }
                    } catch (e) {
                        console.warn('[resolveCorrectionHpr] JSON parse failed:', modelCfg, e);
                    }
                }
                // DB 모델 없으면 store 설정(DEFAULT_CORRECTIONS 포함) 사용
                const stored = correctionByType[vType];
                if (stored) {
                    console.log(`[resolveCorrectionHpr] type=${vType} from DEFAULT:`, stored);
                    return new Cesium.HeadingPitchRoll(stored.heading, stored.pitch, stored.roll);
                }
                return undefined;
            };

            if (typeGroups.size === 0) {
                // 구버전 fallback
                const selModel = useVehicleModelStore.getState().selectedModel;
                const glbUrl = resolveGlbUrl(selModel);
                const modelCfg = selModel?.correctionHpr;
                const zOffset = selModel?.zOffset ?? 0;
                layerManager.addVehicleLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, glbUrl, resolveCorrectionHpr('default', modelCfg), 'default', zOffset);
            } else {
                typeGroups.forEach((paths, vType) => {
                    const typeModel = resolveModelByVehicleType(vType, models, vehicleTypes);
                    console.log(`[setSimulation] type=${vType} typeModel=`, typeModel);
                    const glbUrl = resolveGlbUrl(typeModel);
                    const zOffset = typeModel?.zOffset ?? DEFAULT_Z_OFFSET;
                    const scales = scaleGroups.get(vType);
                    layerManager.addVehicleLayer(paths, vectorSource, speedFactor, isRunningRef.current, glbUrl, resolveCorrectionHpr(vType, typeModel?.correctionHpr), vType, zOffset, scales, typeModel?.color);
                });
            }
            // 이번 refresh에 없는 차종(예: 이전 viewport엔 있었던 BUS가 새 viewport엔 없음)의
            // VehiclePrimitive는 addVehicleLayer가 호출되지 않으므로 여기서 별도로 정리한다.
            layerManager.pruneVehicleTypes(typeGroups.size > 0 ? Array.from(typeGroups.keys()) : ['default']);
            // heatmap은 grid 기반이라 매 refresh마다 재생성할 이유가 없다(trip과 달리 차량 수/타입에
            // 묶인 슬롯이 없음) — 존재하면 그대로 두고 계속 setLatestPositions()로만 갱신한다.
            // 재생성 자체가 (a) 그 사이 잠깐 사라졌다 다시 생기는 깜빡임, (b) 아래 vehicleRoute===0
            // 분기의 존재-확인 가드와 타이밍이 어긋나 인스턴스가 2개 동시에 살아남는 문제의 원인이었다.
            if (!layerExists(layerManager, "analyze", "heatmap")) {
                layerManager.addHeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, heatmapSetting);
            }
            layerManager.addODArrows(vehicleRoute, speedFactor, isRunningRef.current);
            layerManager.addTripLayer(vehicleRoute, speedFactor, isRunningRef.current, typeGroups, vehicleTypeArray, typeColorMap);
            // odFlow/congestion/los/bottleneck은 전부 자체 카메라·재생시각 구독으로 스스로 갱신되는
            // 백엔드 집계 레이어(OdFlowCesiumLayer/LinkMetricPolylineLayer 패턴)라 heatmap과 동일하게
            // 존재 가드 없이 매 refresh마다 재호출하면 구독이 누적된다 — 존재하면 재생성하지 않는다.
            if (!layerExists(layerManager, "analyze", "odFlow")) layerManager.addOdFlowLayer();
            if (!layerExists(layerManager, "analyze", "congestion")) layerManager.addCongestionLayer();
            if (!layerExists(layerManager, "analyze", "los")) layerManager.addLosLayer();
            if (!layerExists(layerManager, "analyze", "bottleneck")) layerManager.addBottleneckLayer();
            if (!layerExists(layerManager, "analyze", "region")) layerManager.addRegionTrafficLayer();
            if (!layerExists(layerManager, "analyze", "regionOdGraph")) layerManager.addRegionOdGraphLayer();
            if (!layerExists(layerManager, "analyze", "congestionGraph")) layerManager.addCongestionGraphLayer();
            if (!layerExists(layerManager, "analyze", "isochrone")) layerManager.addIsochroneLayer();

            const VehicleModelData: { id: string; position: Cesium.Cartesian3; visible: boolean; model?: Cesium.Model }[] = [];

            vehicleDataRef.current = VehicleModelData;

            czmlPositionWorkerRef.current.onmessage = (e) => {
                // 세대 검증 — 이 핸들러가 등록된 뒤 더 새 setSimulation()이 시작되면 worker의
                // onmessage는 그 새 핸들러로 이미 교체되어 있어야 정상이지만, 이 메시지가 그
                // "교체 시점" 직전에 큐잉된 이전 세대의 응답일 수 있다(연속 줌/팬으로 setSimulation이
                // worker 왕복(용답)보다 빠르게 겹쳐 실행될 때). 검증 없이 적용하면 이전 세대의
                // positions(길이가 다름)가 현재(재사용 중인) VehiclePrimitive의 instanceCount보다
                // 커서 GPU 인스턴스 버퍼 범위를 넘어 읽는 상태가 되어 차량이 멈춘 것처럼 보인다
                // ("레이어 재구성 완료"는 찍히는데 차량만 멈추는 증상의 원인) — 반드시 폐기할 것.
                if (myGen !== simGenRef.current) return;
                const result = e.data;
                // ⚠️ 핸들러 세대(myGen) 검증만으로는 부족하다 — 핸들러가 교체된 직후, worker가
                // "이전 세대 packets"로 이미 계산해 큐에 올려둔 응답이 도착하면 새 핸들러(myGen==
                // 현재 세대)가 그대로 통과시킨다. 그 응답의 positions는 옛 차량 집합의 인덱스
                // 공간이라, 새로 만들어진 trail/primitive에 엉뚱한 차량 위치가 한 번 들어가고 —
                // 바로 다음 정상 feed와 직선으로 이어져 재로드(카메라 이동)마다 전체 차량에 그물
                // 무늬가 생겼다. 응답이 어느 세대의 init 데이터로 계산됐는지(result.generation,
                // init 시 echo)를 함께 검증해 세대 불일치 응답을 폐기한다.
                if (result && result.generation !== myGen) return;
                if (result) {
                    // types 배열이 있으면 vehicleType별로 분류하여 각 VehiclePrimitive에 전달
                    const hasTypes = Array.isArray(result.types) && result.types.length > 0;

                    if (hasTypes) {
                        // vehicleType별로 positions/headings 분류 - null(비활성)도 포함하여 인덱스 보존
                        // features[i] ↔ positions[i] 1:1 대응이 깨지면 차량이 날아다니는 버그 발생
                        const byType = new Map<string, { positions: any[], headings: any[] }>();
                        result.positions.forEach((pos: any, i: number) => {
                            const t = result.types[i] ?? 'default';
                            if (!byType.has(t)) byType.set(t, { positions: [], headings: [] });
                            byType.get(t)!.positions.push(pos);        // null도 그대로 push
                            byType.get(t)!.headings.push(result.headings[i]);
                        });

                        // VehiclePrimitive(Cesium)용: null 제거한 압축 배열 별도 생성
                        const byTypeCompact = new Map<string, { positions: any[], headings: any[] }>();
                        result.positions.forEach((pos: any, i: number) => {
                            if (!pos) return;
                            const t = result.types[i] ?? 'default';
                            if (!byTypeCompact.has(t)) byTypeCompact.set(t, { positions: [], headings: [] });
                            byTypeCompact.get(t)!.positions.push(pos);
                            byTypeCompact.get(t)!.headings.push(result.headings[i]);
                        });

                        // ⚠️ 원거리 줌에서는 VehicleAggregationFeeder가 heatmap/trip을 담당한다 —
                        // 그런데 줌아웃 시 뷰포트 스트리밍은 fetch만 멈출 뿐(computeBbox()=null 조기
                        // 리턴), 마지막 뷰포트의 vehicleRoute(수백 대)와 이 onmessage 핸들러는 그대로
                        // 살아있어 재생 중 매 tick마다 그 옛 차량 위치를 heatmap/trip에 계속 덮어썼다.
                        // 피더(80ms 합성 위치)와 이 핸들러(매 프레임 실차량 위치)가 완전히 다른 두 위치
                        // 집합을 같은 레이어에 번갈아 먹이면서 "재생 중에만 심하게 깜빡"이는 원인이었다.
                        // 피더 활성 중엔 heatmap/trip feed를 이쪽에서 건너뛴다(소유권 단일화).
                        const aggFeedActive = (layerManager as any).aggFeedActive === true;
                        layerManager.getLayerGroup("analyze").forEach((layer) => {
                            if (layer && typeof layer.setLatestPositions === "function") {
                                if (aggFeedActive && (layer.layer === "heatmap" || layer.layer === "trip")) return;
                                const vType = (layer as any).vehicleType;
                                const isOlLayer = layer.constructor?.name?.includes('FeatureLayer');
                                // OL FeatureLayer(VehicleFeatureLayer 등): null 포함 인덱스 보존 배열
                                // Cesium Primitive(VehiclePrimitive 등): null 제거 압축 배열
                                const dataToSend = vType
                                    ? (isOlLayer
                                        ? (byType.get(vType) ?? { positions: [], headings: [] })
                                        : (byTypeCompact.get(vType) ?? { positions: [], headings: [] }))
                                    : result;
                                try {
                                    layer.setLatestPositions(dataToSend);
                                } catch (err) {
                                    console.warn("[LayerManager] setLatestPositions 실행 오류:", err);
                                }
                            }
                        });
                        lastPositionsRef.current = result; // OD 워커용으로 항상 전체 positions 유지
                    } else {
                        // 구버전: 모든 레이어에 동일한 positions 전달 (피더 활성 중 heatmap/trip 제외 —
                        // 위 hasTypes 분기와 동일한 이유)
                        const aggFeedActive = (layerManager as any).aggFeedActive === true;
                        layerManager.getLayerGroup("analyze").forEach((layer) => {
                            if (layer && typeof layer.setLatestPositions === "function") {
                                if (aggFeedActive && (layer.layer === "heatmap" || layer.layer === "trip")) return;
                                try {
                                    layer.setLatestPositions(result);
                                } catch (err) {
                                    console.warn("[LayerManager] setLatestPositions 실행 오류:", err);
                                }
                            }
                        });
                        lastPositionsRef.current = result;
                    }

                    useVehicleStore.getState().setActiveVehicleCount(result.positions?.filter(Boolean).length ?? 0);
                }
            }

            makeOdDataWorkerRef.current.onmessage = (e) => {
                const { odData } = e.data;
                if (odData) {
                    // getLayer()는 레이어가 1개면 단일 객체, 2개 이상이면 배열을 반환하므로 항상 배열로 처리
                    const odLayers = layerManager.getLayer("analyze", "od");
                    const odLayerArray: any[] = Array.isArray(odLayers) ? odLayers : odLayers ? [odLayers] : [];
                    odLayerArray.forEach((layer) => {
                        if (layer && typeof layer.setOdData === "function") {
                            try {
                                layer.setOdData(odData);
                            } catch (err) {
                                console.warn("[LayerManager] setOdData 실행 오류:", err);
                            }
                        }
                    });
                }
            };

            layerManager?.showLayer("analyze", "default");
            const { activeLayerName } = useLayerStore.getState();
            (activeLayerName ?? []).forEach(name => layerManager?.showLayer("analyze", name));
        }).catch((e) => {
            // 이전엔 여기서 에러가 나면 조용히 삼켜져서(catch 없음) preRender 리스너 재등록까지
            // 끊긴 채 "시간은 가는데 차량은 안 보임" 상태로 영원히 멈췄다 — 최소한 콘솔에 남긴다.
            console.error('[setSimulation] gen=', myGen, '차량 레이어 재구성 실패 — 차량이 안 보일 수 있음:', e);
            if (myGen === simGenRef.current) streamTransitionRef.current = false; // tick 영구 정지 방지
        });
    };


    const loadCzmlDataSource = (czml, myGen: number) => {
        const czmlSource = new Cesium.CzmlDataSource();

        // 재로드(viewport 스트리밍 등) 시 재생 위치 보존:
        // CzmlDataSource를 add하면 Cesium이 document clock으로 viewer.clock을 자동 동기화
        // (automaticallyTrackDataSourceClocks) → currentTime이 시작점으로 리셋됨.
        // 기존 재생 시각/재생 상태를 캡처해 두었다가 새 clock 범위 안이면 복원한다.
        const clockV = viewer!; // setSimulation에서 viewer 확인 후에만 호출됨
        const isReload = !!czmlDataSourceRef.current;
        const prevTime = isReload ? Cesium.JulianDate.clone(clockV.clock.currentTime) : null;
        const prevShouldAnimate = clockV.clock.shouldAnimate;

        if (czmlDataSourceRef.current) {
            viewer.dataSources.remove(czmlDataSourceRef.current, true);
        }

        return czmlSource.load(czml).then(() => {
            return viewer.dataSources.add(czmlSource).then((d) => {
                if (myGen !== simGenRef.current) {
                    // 더 새 setSimulation() 호출이 이미 시작됨 — 이 결과는 버리고 정리만 한다
                    // (레이어/워커는 새 호출이 소유하므로 여기서 절대 건드리지 않는다).
                    viewer.dataSources.remove(czmlSource, true);
                    return null;
                }

                viewer?.scene.preRender.removeEventListener(updateFrameFunc);
                // ⚠️ remove와 재등록(아래) 사이에서 예외가 나면(레이어 재구성 실패 등) — 예전엔
                // 그 예외가 위 setSimulation()의 .catch()로 넘어가 로그만 남기고 재등록 코드는
                // 영영 실행되지 않았다. preRender 자기유지 루프가 그 순간 끊기고, 이후로는 카메라를
                // 움직여 우연히 트리거되는 렌더 한 번에만 차량이 그 위치로 반영된다 — "재생 중인데
                // 화면을 움직여야만 차량이 움직인다"는 증상의 원인. 무슨 일이 있어도 재등록만은
                // 보장하도록 finally로 옮긴다.
                try {
                    czmlDataSourceRef.current = czmlSource;

                    const map = new Map();
                    czmlDataSourceRef.current.entities.values.forEach(entity => {
                        map.set(entity.id, entity);
                    });
                    entityMapRef.current = map;

                    if (viewerClockMultiplier.current) {
                        viewer.clock.multiplier = viewerClockMultiplier.current;
                    }

                    // 재생 위치 복원 (worker init이 viewer.clock.currentTime을 읽기 전에 수행)
                    if (prevTime
                        && Cesium.JulianDate.greaterThanOrEquals(prevTime, clockV.clock.startTime)
                        && Cesium.JulianDate.lessThan(prevTime, clockV.clock.stopTime)) {
                        clockV.clock.currentTime = prevTime;
                        clockV.clock.shouldAnimate = prevShouldAnimate;
                        useSimulationStore.getState().setCurrentTime(Cesium.JulianDate.clone(prevTime));
                    }

                    // 워커를 원본(미보정) 경로로 즉시 초기화한다 — 지형 고도 보정(아래)은 원격 지형
                    // 타일 다운로드를 기다려야 해서 차량 수가 많을 때 수백ms~수 초씩 걸릴 수 있다.
                    // 이걸 기다렸다가 워커를 초기화하면, 그 사이 줌/팬으로 다음 세대가 먼저 시작될 때
                    // (연속 줌 등) 이 세대의 워커 init이 계속 밀려나 건너뛰어지는 동안 Cesium
                    // 프리미티브(updateInstances)는 이미 최신 인스턴스 수로 바뀌어 있어 — 워커가 들고
                    // 있는 옛 세대 경로와 개수가 안 맞아 위치가 하나도 안 나와 차량이 멈춘 것처럼
                    // 보이는 원인이었다("positions/instanceCount 불일치"). 먼저 즉시 초기화해 위치
                    // 확보를 보장하고, 지형 보정은 완료되는 대로(같은 세대일 때만) 높이만 다시 적용한다.
                    // currentTime: 절대 경과초(vehicle_sim.db timestep 기준) — computeElapsedSec 주석 참고.
                    // 이전엔 epoch-ms를 그대로 보내 worker가 init 호출 시점을 0초로 잘못 재설정했다.
                    // generation: 이 packets가 어느 세대 것인지 worker가 응답에 echo → onmessage에서
                    // 세대 불일치 응답(핸들러 교체 직전에 큐잉된 이전 세대 계산 결과) 폐기에 사용.
                    czmlPositionWorkerRef.current?.postMessage({
                        type: 'init',
                        czmlPackets: vehicleRoute,
                        currentTime: computeElapsedSec(viewer, viewer.clock.currentTime),
                        generation: myGen,
                    });
                    // 창 전환 종료 — 이 시점부터 simMinRef/clock/worker 경로가 전부 새 창으로 정합
                    // (init이 방금 정확한 경과초로 위치를 즉시 계산해 보냈으므로 tick 재개 안전).
                    streamTransitionRef.current = false;
                    // ⚠️ getLayer("facility","network")는 3D(NetworkDataSourceLayer)와
                    // 2D(NetworkFeatureLayer)가 같은 group/name으로 등록돼 있어 배열로 섞여
                    // 나온다 — [0]을 그냥 집으면 어느 쪽이 나올지 보장이 없어 getNearestTerrainHeight
                    // 가 없는 2D 레이어를 잡을 수 있다("is not a function" 런타임 에러 실측).
                    // getDataSourceLayerByName은 3D 래퍼 인스턴스만 확실히 반환하는 전용 API.
                    const networkLayerForTerrain = layerManager?.getDataSourceLayerByName("network") as any;
                    applyTerrainHeightsToRoute(vehicleRoute, viewer.terrainProvider, networkLayerForTerrain).then(adjustedRoute => {
                        if (myGen !== simGenRef.current) return; // stale — 더 새 호출의 워커 상태를 덮어쓰지 않음
                        czmlPositionWorkerRef.current?.postMessage({
                            type: 'init',
                            czmlPackets: adjustedRoute,
                            currentTime: computeElapsedSec(viewer, viewer.clock.currentTime),
                            generation: myGen,
                        });
                    });
                } finally {
                    viewer.scene.preRender.addEventListener(updateFrameFunc);
                }

                return d; // ✅ CzmlDataSource를 반환
            });
        });
    };


};


export default useSimulation;