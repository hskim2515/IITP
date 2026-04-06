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

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((state) => state.selectedScenarioVersion);

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

        const scenarioKey = selectedScenario.key;
        const baseUrl = process.env.VITE_API_URL;
        const requestBody = JSON.stringify({ numVehicle, speedFactor, czml });

        const applyRouteData = (data: any) => {
            if (!data || !data.czml) return;
            const { czml: czmlData, positions, features, signalTimeline } = data;
            setVehicleRoute(positions);
            setCzml(czmlData);
            setFeatures(features);
            setSignalTimeline(signalTimeline);
            const clock = czmlData[0].clock;
            const [startTime, endTime] = czmlData[0].clock.interval.split('/');
            const start = JulianDate.fromIso8601(startTime);
            const end = JulianDate.fromIso8601(endTime);
            const current = JulianDate.fromIso8601(clock.currentTime);
            useSimulationStore.getState().setClock(start, end, current);
        };

        fetch(`${baseUrl}/vehicle/vehicle-route/${scenarioKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
        })
            .then((r) => {
                if (!r.ok) {
                    console.warn(`[useSimulation] 차량 경로 로드 실패 (${r.status}):`, scenarioKey);
                    return null;
                }
                return r.json();
            })
            .then(applyRouteData);
    }, [ numVehicle, speedFactor, selectedScenario?.key ]);

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
            console.log('[OD] postMessage lastPositions.length:', lastPositions?.length, 'newVehicleRoute.length:', newVehicleRoute?.length, 'sample route:', newVehicleRoute?.[0]);
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
                if (!typeGroups.has(vType))  typeGroups.set(vType, []);
                if (!scaleGroups.has(vType)) scaleGroups.set(vType, []);
                typeGroups.get(vType)!.push(path);
                scaleGroups.get(vType)!.push(isLegacy ? 0 : (entry.length ?? 0) as number);
            });
            console.log('[setSimulation] vehicleRoute sample:', vehicleRoute[0], '| typeGroups:', [...typeGroups.entries()].map(([k, v]) => `${k}:${v.length}`));

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
                    const scales = scaleGroups.get(vType);
                    layerManager.addVehicleLayer(paths, vectorSource, speedFactor, isRunningRef.current, glbUrl, resolveCorrectionHpr(vType, typeModel?.correctionHpr), vType, zOffset, scales);
                });
            }
            layerManager.addHeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, heatmapSetting);
            layerManager.addODArrows(vehicleRoute, speedFactor, isRunningRef.current);
            layerManager.addTripLayer(vehicleRoute, speedFactor, isRunningRef.current);
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
                console.log('[OD] worker result odData.length:', odData?.length);
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
        });
    };


    const loadCzmlDataSource = (czml) => {
        const czmlSource = new Cesium.CzmlDataSource();

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

                czmlPositionWorkerRef.current.postMessage({
                    type: 'init',
                    czmlPackets: vehicleRoute,
                    currentTime: Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()
                });

                viewer.scene.preRender.addEventListener(updateFrameFunc);

                return d; // ✅ CzmlDataSource를 반환
            });
        });
    };


};


export default useSimulation;