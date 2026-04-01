import { useEffect, useRef } from "react";
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
import {getFeaturesByProperties} from "@utils/feature";
import {Fill, Stroke, Style} from "ol/style";
import {Feature} from "ol";
import {applyCesiumSignalStyle, applyOlSignalStyle, updateSignalStyles} from "@utils/signal";
import { useVehicleModelStore, resolveGlbUrl, resolveModelByVehicleType } from "@stores/useVehicleModelStore";

const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);
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
    const layerManager: LayerManager = useLayerStore((state) => state.layerManager);
    const czml = useVehicleStore((state) => state.czml);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);
    const vehicleRouteStartEndRef = useRef(null);

    // 최신 speed와 speedFactor를 참조하기 위한 ref
    const speedRef = useRef(speed);
    const speedFactorRef = useRef(speedFactor);
    const isRunningRef = useRef(isRunning);

    const lastUpdateTime = useRef(0);
    const lastOdUpdateTime = useRef(0);
    const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());
    const lastPositionsRef = useRef([]);
    /** stop→play 전환 감지용: isRunning이 false→true 전환 시에만 워커 재초기화 */
    const wasRunningRef = useRef(false);

    // const changeModelWorkerRef = useRef<Worker | null>(null);
    const czmlPositionWorkerRef = useRef<Worker | null>(null);
    const workerGenerationRef   = useRef(0);
    const makeOdDataWorkerRef = useRef<Worker | null>(null);
    /** 시뮬레이션 자연 종료 감지용 clock.onTick 리스너 참조 */
    const clockEndListenerRef = useRef<((clock: Cesium.Clock) => void) | null>(null);
    /** preRender 리스너 참조 — React 리렌더 시 함수 참조 변경으로 인한 누수 방지 */
    const updateFrameFuncRef = useRef<(() => void) | null>(null);

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
            if (clockEndListenerRef.current && viewer) {
                viewer.clock.onTick.removeEventListener(clockEndListenerRef.current);
                clockEndListenerRef.current = null;
            }
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
            layerManager.getLayerGroup("analyze").forEach((layer) => {
                layer.setSpeed(speed * speedFactor);
                layer.setStatus(isRunning);
            });

            viewerClockMultiplier.current = speed;

            viewer.clock.shouldAnimate = isRunning;
            viewer.clock.multiplier = viewerClockMultiplier.current;

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
                useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.startTime));
                useVehicleStore.getState().setActiveVehicleCount(0);
                lastPositionsRef.current = [];
                wasRunningRef.current = false;
                layerManager.getLayerGroup("analyze").forEach((layer) => {
                    if (typeof (layer as any).stop === "function") (layer as any).stop();
                });
                if (czmlDataSourceRef.current) {
                    (czmlDataSourceRef.current as any).show = false;
                }
            } else if (isRunning) {
                // stop/drain → play 전환: 워커 세대를 갱신하여 스테일 응답 무효화
                if (!wasRunningRef.current && vehicleRoute.length > 0) {
                    const newGen = ++workerGenerationRef.current;
                    czmlPositionWorkerRef.current?.postMessage({
                        type: 'init',
                        czmlPackets: vehicleRoute,
                        currentTime: Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime(),
                        generation: newGen,
                    });
                }
                wasRunningRef.current = true;
                layerManager.getLayerGroup("analyze").forEach((layer) => {
                    if (typeof (layer as any).start === "function") (layer as any).start();
                });
                if (czmlDataSourceRef.current) {
                    (czmlDataSourceRef.current as any).show = true;
                }
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
        fetch(process.env.VITE_API_URL + "/vehicle/vehicle-route/" + selectedScenario.key, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor, czml }),
        })
            .then((response) => response.json())
            .then(({ czml, positions, features, signalTimeline }) => {
                setVehicleRoute(positions);
                setCzml(czml);
                setFeatures(features);
                setSignalTimeline(signalTimeline);
                const clock = czml[0].clock;
                const [startTime, endTime] = czml[0].clock.interval.split('/');
                const start = JulianDate.fromIso8601(startTime);
                const end = JulianDate.fromIso8601(endTime);
                const current = JulianDate.fromIso8601(clock.currentTime);

                useSimulationStore.getState().setClock(start, end, current);

            });
    }, [ numVehicle, speedFactor ]);

    // Cesium과 OpenLayers 시뮬레이션 통합: 후처리 및 Cesium 관련 설정
    useEffect(() => {
        const parsedVehicleRoute = parseRawODInputFromFlatArray(vehicleRoute);
        const simplified = parsedVehicleRoute
            .map(route => {
                if (route.length >= 2) {
                    return [ route[0], route[route.length - 1] ];
                } else {
                    return route; // 길이가 1 이하인 경우 그대로 유지
                }
            });
        vehicleRouteStartEndRef.current = simplified
        if (vehicleRoute.length > 0) {
            setSimulation();
        }

        // isRunning은 isRunningRef.current로 별도 처리
    }, [ vehicleRoute ]);

    const updateFrameFunc = () => {

        const currentTime = performance.now(); // 고해상도 시간 (ms)
        const simTime = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()

        if (currentTime - lastOdUpdateTime.current >= 1000) { // 1초(1000ms)마다 실행
            lastOdUpdateTime.current = currentTime;

            const newVehicleRoute = vehicleRouteStartEndRef.current;
            const lastPositions = lastPositionsRef.current.positions;
            makeOdDataWorkerRef.current?.postMessage({ lastPositions, newVehicleRoute })

        }
        if(currentTime - lastUpdateTime.current >= 50 && isRunningRef.current){
            lastUpdateTime.current = currentTime;
            czmlPositionWorkerRef.current.postMessage({ type: 'tick', currentTime: simTime });
            useSimulationStore.getState().setCurrentTime(JulianDate.clone(viewer.clock.currentTime));
        }
    };

    const setSimulation = async () => {
        if (!viewer || !czml || vehicleRoute.length === 0 || !layerManager) return;
        // 이전 워커 메시지가 새 레이어에 유입되지 않도록 세대 ID 증가
        const generation = ++workerGenerationRef.current;
        // 즉시 워커를 리셋: 구 세대 tick 응답이 새 레이어에 유입되지 않도록
        // → sampledPositionsList = [] 로 초기화되어 이후 tick은 early-return
        czmlPositionWorkerRef.current?.postMessage({
            type: 'init',
            czmlPackets: [],
            currentTime: 0,
            generation,
        });

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

        // ── 즉시 실행: OL 레이어 + 워커 핸들러 (CZML 로드 대기 없음) ──────────
        layerManager.removeSimulationLayers();
        const vectorSource = new VectorSource();

        const typeGroups = new Map<string, any[]>();
        const vehicleTypeArray: string[] = [];
        vehicleRoute.forEach((entry: any, idx: number) => {
            const isLegacy = Array.isArray(entry);
            const path = isLegacy ? entry : entry.path;
            let vType: string;
            if (isLegacy) {
                const mod = idx % 100;
                if (mod < 70)       vType = 'CAR';
                else if (mod < 85)  vType = 'TAXI';
                else if (mod < 95)  vType = 'BUS';
                else if (mod < 99)  vType = 'TRUCK';
                else                vType = 'MOTO';
            } else if (entry.type) {
                vType = entry.type;
            } else {
                const numId = parseInt(String(entry.id ?? '0').replace(/\D/g, '')) || 0;
                const mod = numId % 100;
                if (mod < 70)       vType = 'CAR';
                else if (mod < 85)  vType = 'TAXI';
                else if (mod < 95)  vType = 'BUS';
                else if (mod < 99)  vType = 'TRUCK';
                else                vType = 'MOTO';
            }
            vehicleTypeArray.push(vType);
            if (!typeGroups.has(vType)) typeGroups.set(vType, []);
            typeGroups.get(vType)!.push(path);
        });
        console.log('[setSimulation] vehicleRoute sample:', vehicleRoute[0], '| typeGroups:', [...typeGroups.entries()].map(([k, v]) => `${k}:${v.length}`));

        // OL 레이어 즉시 추가 — trail이 재생 시작과 동시에 위치를 수신할 수 있도록
        layerManager.addHeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, heatmapSetting);
        layerManager.addODArrows(vehicleRoute, speedFactor, isRunningRef.current);
        layerManager.addTripLayer(vehicleRoute, speedFactor, isRunningRef.current, typeGroups, vehicleTypeArray);
        layerManager.addTrafficLayer();

        // 워커 핸들러 즉시 설정 — 레이어 생성 직후부터 위치 데이터 수신
        czmlPositionWorkerRef.current.onmessage = (e) => {
            // 워커 응답의 generation이 현재 세대와 다르면 스테일 메시지 — 무시
            const result = e.data;
            if (!result || result.generation !== workerGenerationRef.current) return;

            {
                const hasTypes = Array.isArray(result.types) && result.types.length > 0;

                if (hasTypes) {
                    const n = result.positions.length;
                    // packed: VehicleFeatureLayer / VehiclePrimitive 용 (null 제거, 연속 배열)
                    const byTypePacked = new Map<string, { positions: any[], headings: any[] }>();
                    // sparse: TrailFeatureLayer 용 (원본 인덱스 보존 — null 제거 시 idx 불일치로 trail 점프 발생)
                    const byTypeSparse = new Map<string, { positions: any[], headings: any[] }>();
                    result.positions.forEach((pos: any, i: number) => {
                        const t = result.types[i] ?? 'default';
                        // sparse
                        if (!byTypeSparse.has(t)) {
                            byTypeSparse.set(t, {
                                positions: new Array(n).fill(null),
                                headings:  new Array(n).fill(null),
                            });
                        }
                        byTypeSparse.get(t)!.positions[i] = pos ?? null;
                        byTypeSparse.get(t)!.headings[i]  = result.headings?.[i] ?? null;
                        // packed
                        if (!pos) return;
                        if (!byTypePacked.has(t)) byTypePacked.set(t, { positions: [], headings: [] });
                        byTypePacked.get(t)!.positions.push(pos);
                        byTypePacked.get(t)!.headings.push(result.headings?.[i]);
                    });

                    layerManager.getLayerGroup("analyze").forEach((layer) => {
                        if (layer && typeof layer.setLatestPositions === "function") {
                            const vType = (layer as any).vehicleType;
                            const useSparse = (layer as any).sparsePositions === true;
                            const byTypeMap = useSparse ? byTypeSparse : byTypePacked;
                            const dataToSend = vType
                                ? (byTypeMap.get(vType) ?? { positions: [], headings: [] })
                                : result;
                            try {
                                layer.setLatestPositions(dataToSend);
                            } catch (err) {
                                console.warn("[LayerManager] setLatestPositions 실행 오류:", err);
                            }
                        }
                    });
                    lastPositionsRef.current = result;
                } else {
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
        };

        makeOdDataWorkerRef.current.onmessage = (e) => {
            const { odData } = e.data;
            if (odData) {
                layerManager.getLayer("analyze", "od").forEach((layer) => {
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

        // 레이어 가시성 즉시 적용
        layerManager?.showLayer("analyze", "default");
        const { activeLayerName } = useLayerStore.getState();
        (activeLayerName ?? []).forEach(name => layerManager?.showLayer("analyze", name));

        // ── 비동기: Cesium 차량 레이어 (CZML 로드 필요) ──────────────────────
        const { correctionByType } = useVehicleModelStore.getState();

        const resolveCorrectionHpr = (vType: string, modelCfg?: string | { heading: number; pitch: number; roll: number }) => {
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
            const stored = correctionByType[vType];
            if (stored) {
                console.log(`[resolveCorrectionHpr] type=${vType} from DEFAULT:`, stored);
                return new Cesium.HeadingPitchRoll(stored.heading, stored.pitch, stored.roll);
            }
            return undefined;
        };

        loadCzmlDataSource(czml, generation).then(() => {
            viewer.clock.shouldAnimate = isRunningRef.current;

            if (typeGroups.size === 0) {
                const selModel = useVehicleModelStore.getState().selectedModel;
                const glbUrl = resolveGlbUrl(selModel, 'CAR');
                const modelCfg = selModel?.correctionHpr;
                const zOffset = selModel?.zOffset ?? 0;
                layerManager.addVehicleLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, glbUrl, resolveCorrectionHpr('default', modelCfg), 'default', zOffset);
            } else {
                typeGroups.forEach((paths, vType) => {
                    const typeModel = resolveModelByVehicleType(vType, models, vehicleTypes);
                    console.log(`[setSimulation] type=${vType} typeModel=`, typeModel);
                    const glbUrl = resolveGlbUrl(typeModel, vType);
                    const zOffset = typeModel?.zOffset ?? 0;
                    layerManager.addVehicleLayer(paths, vectorSource, speedFactor, isRunningRef.current, glbUrl, resolveCorrectionHpr(vType, typeModel?.correctionHpr), vType, zOffset);
                });
            }

            vehicleDataRef.current = [];
        });
    };


    const loadCzmlDataSource = (czml, generation: number) => {
        const czmlSource = new Cesium.CzmlDataSource();

        if (czmlDataSourceRef.current) {
            viewer.dataSources.remove(czmlDataSourceRef.current, true);
        }

        return czmlSource.load(czml).then(() => {
            return viewer.dataSources.add(czmlSource).then((d) => {
                if (updateFrameFuncRef.current) {
                    viewer?.scene.preRender.removeEventListener(updateFrameFuncRef.current);
                }
                czmlDataSourceRef.current = czmlSource;

                const map = new Map();
                czmlDataSourceRef.current.entities.values.forEach(entity => {
                    map.set(entity.id, entity);
                });
                entityMapRef.current = map;

                if (viewerClockMultiplier.current) {
                    viewer.clock.multiplier = viewerClockMultiplier.current;
                }

                czmlPositionWorkerRef.current.postMessage({
                    type: 'init',
                    czmlPackets: vehicleRoute,
                    currentTime: Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime(),
                    generation: workerGenerationRef.current,
                });

                updateFrameFuncRef.current = updateFrameFunc;
                viewer.scene.preRender.addEventListener(updateFrameFunc);

                // 이전 리스너 제거 후 자연 종료 감지 리스너 등록
                if (clockEndListenerRef.current) {
                    viewer.clock.onTick.removeEventListener(clockEndListenerRef.current);
                }
                clockEndListenerRef.current = (clock: Cesium.Clock) => {
                    if (!isRunningRef.current) return;
                    if (Cesium.JulianDate.compare(clock.currentTime, clock.stopTime) < 0) return;
                    viewer.clock.onTick.removeEventListener(clockEndListenerRef.current!);
                    clockEndListenerRef.current = null;
                    layerManager.getLayerGroup("analyze").forEach((layer) => {
                        if (typeof (layer as any).drain === "function") (layer as any).drain();
                    });
                    viewer.clock.currentTime = Cesium.JulianDate.clone(viewer.clock.startTime);
                    viewer.clock.shouldAnimate = false;
                    lastPositionsRef.current = [];
                    wasRunningRef.current = false;
                    useVehicleStore.getState().setActiveVehicleCount(0);
                    useSimulationStore.getState().pause();
                };
                viewer.clock.onTick.addEventListener(clockEndListenerRef.current);

                return d; // ✅ CzmlDataSource를 반환
            });
        });
    };


};


export default useSimulation;