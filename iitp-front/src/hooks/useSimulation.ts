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
import { VEHICLE_STREAMING, NETWORK_TILING } from "@utils/lodConstants";

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
    terrainProvider: Cesium.TerrainProvider
): Promise<any[]> {
    if (terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
        return vehicleRoute;
    }

    // 1. 모든 웨이포인트 수집 (flat array: [t, x, y, z, ...])
    type PosRef = { trackIdx: number; offset: number };
    const GRID = 4; // 소수점 자릿수 (~11m 격자)
    const uniqueCartoMap = new Map<string, Cesium.Cartographic>();
    const refs: { key: string; ref: PosRef }[] = [];

    vehicleRoute.forEach((track: any, trackIdx: number) => {
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
            refs.push({ key, ref: { trackIdx, offset: i } });
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

    // 4. 각 웨이포인트 ECEF에 지형 고도 적용
    const scratch = new Cesium.Cartesian3();
    refs.forEach(({ key, ref }) => {
        const terrainH = heightMap.get(key) ?? 0;
        const track = adjusted[ref.trackIdx];
        const path: number[] = Array.isArray(track) ? track : track.path;

        const x = path[ref.offset + 1];
        const y = path[ref.offset + 2];
        const z = path[ref.offset + 3];

        scratch.x = x; scratch.y = y; scratch.z = z;
        const carto = Cesium.Cartographic.fromCartesian(scratch);
        carto.height = terrainH+1;
        const newPos = Cesium.Cartesian3.fromRadians(
            carto.longitude, carto.latitude, terrainH+1
        );

        path[ref.offset + 1] = newPos.x;
        path[ref.offset + 2] = newPos.y;
        path[ref.offset + 3] = newPos.z;
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
    const vehicleRouteStartEndRef = useRef(null);
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

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
                viewer.clock.shouldAnimate = false;
                useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.startTime));
                useVehicleStore.getState().setActiveVehicleCount(0);

                // worker 리셋
                const startSimTime = Cesium.JulianDate.toDate(viewer.clock.startTime).getTime();
                czmlPositionWorkerRef.current?.postMessage({ type: 'reset', currentTime: startSimTime });

                // 신호 스타일 초기화
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
        if (!selectedScenario) return;

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

            // 카메라 viewport bbox (한 변 MAX_BBOX_DEG 초과 시 null → fetch 생략)
            const computeBbox = (): { w: number; s: number; e: number; n: number } | null => {
                const v = useCesiumStore.getState().viewer;
                if (!v) return null;
                const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
                if (!rect) return null;
                let w = Cesium.Math.toDegrees(rect.west), e = Cesium.Math.toDegrees(rect.east);
                let s = Cesium.Math.toDegrees(rect.south), n = Cesium.Math.toDegrees(rect.north);
                const MAX = VEHICLE_STREAMING.MAX_BBOX_DEG;
                if (e - w > MAX * 2 || n - s > MAX * 2) return null; // 줌아웃 → 집계 히트맵 담당
                // 소폭 초과는 중앙 기준으로 절삭
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

            const doFetch = (force = false) => {
                if (fetching) return;
                const bbox = computeBbox();
                if (!bbox) return;
                const bboxKey = `${bbox.w.toFixed(4)},${bbox.s.toFixed(4)},${bbox.e.toFixed(4)},${bbox.n.toFixed(4)}`;
                const cur = simMin + currentElapsed();
                const windowOk = windowTo > 0 && cur >= windowFrom && cur < windowTo - VEHICLE_STREAMING.REFETCH_REMAIN_SEC;
                if (!force && bboxKey === lastBboxKey && windowOk) return; // 같은 bbox + 창 여유 → 스킵
                // 벽시계 최소 간격 — 재로드는 32MB fetch + 전체 시뮬 레이어 재구성이라, 재생 배속으로
                // 시간창이 빨리 소진되어도 수 초마다 반복되면 시뮬/타일 렌더가 전부 굶는다.
                if (!force && performance.now() - lastFetchWall < 8000) return;

                // 시간창을 재생 배속에 비례해 확장 — 배속 30x면 시뮬시간 창이 벽시계로 순식간에
                // 소진되므로(120s÷30 = 4s) 창을 곱해 재로드 주기를 벽시계 기준으로 되돌린다.
                const mult = Math.max(1, (useVehicleStore.getState() as any).speedFactor || 1);
                const windowSec = Math.min(
                    VEHICLE_STREAMING.TIME_WINDOW_SEC * mult,
                    Math.max(600, simMax - simMin), // 최소 600s, simRange 전체 초과 불필요
                );
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
                    }),
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        if (!data) return;
                        simMin = Array.isArray(data.simRange) ? (data.simRange[0] ?? 0) : 0;
                        simMax = Array.isArray(data.simRange) ? (data.simRange[1] ?? Infinity) : Infinity;
                        windowFrom = from; windowTo = to;
                        lastBboxKey = bboxKey;

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
                                    `[차량] viewport 차량 ${total.toLocaleString()}대 — 상한 초과, 교통량 히트맵으로 전환`);
                                layerManager?.hideLayer('analyze', 'vehicle');
                                layerManager?.showLayer('analyze', 'traffic');
                            }
                            if (firstLoad) {
                                // 재생 clock 초기화는 필요 (document packet만 적용, 차량은 비움)
                                applyRouteData({ ...data, czml: [data.czml[0]], positions: [], features: [] });
                            }
                            // 개별 차량 데이터는 적용하지 않음 (worker 재빌드 비용 절약, 히트맵이 대체)
                            firstLoad = false;
                            return;
                        }
                        if (wasDense) {
                            // 밀집 해제 (줌인 등) → 개별 차량 복귀
                            layerManager?.showLayer('analyze', 'vehicle');
                            layerManager?.hideLayer('analyze', 'traffic');
                        }
                        applyRouteData(data, { preserveClock: !firstLoad });
                        firstLoad = false;
                    })
                    .catch((e) => console.warn('[useSimulation] viewport 스트리밍 실패:', e))
                    .finally(() => { fetching = false; });
            };

            const schedule = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => { timer = null; doFetch(); }, VEHICLE_STREAMING.DEBOUNCE_MS);
            };

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
                camViewer?.camera.changed.removeEventListener(camHandler);
                if (viewerWaitTimer) clearInterval(viewerWaitTimer);
                unsubTime();
                if (timer) clearTimeout(timer);
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
    }, [ numVehicle, speedFactor, selectedScenario?.key, refetchTrigger ]);

    // Cesium과 OpenLayers 시뮬레이션 통합: 후처리 및 Cesium 관련 설정
    useEffect(() => {
        if (!Array.isArray(vehicleRoute) || vehicleRoute.length === 0) return;

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

        if (currentTime - lastOdUpdateTime.current >= 1000) {
            lastOdUpdateTime.current = currentTime;
            const newVehicleRoute = vehicleRouteStartEndRef.current;
            const lastPositions = lastPositionsRef.current.positions;
            makeOdDataWorkerRef.current?.postMessage({ lastPositions, newVehicleRoute })
        }
        if (currentTime - lastUpdateTime.current >= 50 && isRunningRef.current) {
            lastUpdateTime.current = currentTime;
            czmlPositionWorkerRef.current.postMessage({ type: 'tick', currentTime: simTime });
            useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.currentTime));

            const signalInterval = Math.max(200, 1000 / (speedRef.current || 1));
            if (currentTime - lastSignalUpdateTime.current >= signalInterval) {
                lastSignalUpdateTime.current = currentTime;
                const signalTimeline = useSignalTimelineStore.getState().signalTimeline;
                if (signalTimeline?.length) {
                    updateSignalStyles(layerManager as any, viewer, connectionFeatureMapRef.current, signalTimeline, simTime);
                }
            }
        }
    };

    // 고정된 wrapper 함수 - addEventListener/removeEventListener에 항상 같은 참조를 사용
    const updateFrameFunc = useRef(() => {
        updateFrameFuncRef.current?.();
    }).current;

    const setSimulation = async () => {
        if (!viewer || !czml || vehicleRoute.length === 0 || !layerManager) return;

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

        connectionFeatureMapRef.current.clear();

        loadCzmlDataSource(czml).then((czmlSource) => {
            viewer.clock.shouldAnimate = isRunningRef.current;

            // 레이어 초기화
            layerManager.removeSimulationLayers();
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
            layerManager.addHeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, heatmapSetting);
            layerManager.addODArrows(vehicleRoute, speedFactor, isRunningRef.current);
            layerManager.addTripLayer(vehicleRoute, speedFactor, isRunningRef.current, typeGroups, vehicleTypeArray, typeColorMap);
            layerManager.addTrafficLayer();

            const VehicleModelData: { id: string; position: Cesium.Cartesian3; visible: boolean; model?: Cesium.Model }[] = [];

            vehicleDataRef.current = VehicleModelData;

            czmlPositionWorkerRef.current.onmessage = (e) => {
                const result = e.data;
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

                        layerManager.getLayerGroup("analyze").forEach((layer) => {
                            if (layer && typeof layer.setLatestPositions === "function") {
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
                        // 구버전: 모든 레이어에 동일한 positions 전달
                        layerManager.getLayerGroup("analyze").forEach((layer) => {
                            if (layer && typeof layer.setLatestPositions === "function") {
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
        });
    };


    const loadCzmlDataSource = (czml) => {
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
                viewer?.scene.preRender.removeEventListener(updateFrameFunc);
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

                // 지형이 있으면 모든 웨이포인트에 지형 고도를 주입한 뒤 워커 초기화
                applyTerrainHeightsToRoute(vehicleRoute, viewer.terrainProvider).then(adjustedRoute => {
                    czmlPositionWorkerRef.current?.postMessage({
                        type: 'init',
                        czmlPackets: adjustedRoute,
                        currentTime: Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()
                    });
                });

                viewer.scene.preRender.addEventListener(updateFrameFunc);

                return d; // ✅ CzmlDataSource를 반환
            });
        });
    };


};


export default useSimulation;