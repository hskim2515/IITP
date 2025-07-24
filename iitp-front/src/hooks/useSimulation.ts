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

const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const heatmapSetting = {
        exaggeration: useHeatmapSettingStore.state.exaggeration(),
        colors: useHeatmapSettingStore.state.colors(),
        blur: useHeatmapSettingStore.state.blur(),
    };

    const setCzml = useVehicleStore((state) => state.setCzml);
    const setVehicleData = useVehicleStore((state) => state.setVehicleData);
    const setVehicleRoute = useVehicleStore((state) => state.setVehicleRoute);

    const setFeatures = useVehicleStore((state) => state.setFeatures);
    const features = useVehicleStore((state) => state.features);
    const vehicleRoute = useVehicleStore((state) => state.vehicleRoute);

    // Ref 선언 (OpenLayers, Cesium, 애니메이션)
    const viewerClockMultiplier = useRef(null);

    const viewer = useCesiumStore((state) => state.viewer);
    const layerManager: LayerManager = useLayerStore((state) => state.layerManager);
    const czml = useVehicleStore((state) => state.czml);
    const vehicleData = useVehicleStore((state) => state.vehicleData);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);
    const vehicleRouteStartEndRef = useRef(null);

    // 최신 speed와 speedFactor를 참조하기 위한 ref
    const speedRef = useRef(speed);
    const speedFactorRef = useRef(speedFactor);
    const isRunningRef = useRef(isRunning);

    const lastUpdateTime = useRef(0);
    const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());
    const lastPositionsRef = useRef([])

    const changeModelWorkerRef = useRef<Worker | null>(null);
    const czmlPositionWorkerRef = useRef<Worker | null>(null);
    const makeOdDataWorkerRef = useRef<Worker | null>(null);

    useEffect(() => {
        if (!changeModelWorkerRef.current) {
            changeModelWorkerRef.current = new Worker(new URL('/src/workers/changeModelWorker.ts', import.meta.url), { type: 'module' });
        }
        if (!czmlPositionWorkerRef.current) {
            czmlPositionWorkerRef.current = new Worker(new URL('/src/workers/czmlPositionWorker.ts', import.meta.url), { type: 'module' });
        }
        if (!makeOdDataWorkerRef.current) {
            makeOdDataWorkerRef.current = new Worker(new URL('/src/workers/makeOdDataWorker.ts', import.meta.url), { type: 'module' });
        }

        return () => {
            changeModelWorkerRef.current?.terminate();
            czmlPositionWorkerRef.current?.terminate();
            makeOdDataWorkerRef.current?.terminate();
            changeModelWorkerRef.current = null;
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
            layerManager.getLayerGroup("analyze").forEach((layer) => {
                layer.setSpeed(speed * speedFactor);
                layer.setStatus(isRunning);
            });

            viewerClockMultiplier.current = speed;

            viewer.clock.shouldAnimate = isRunning;
            viewer.clock.multiplier = viewerClockMultiplier.current;

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
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
        fetch(process.env.VITE_API_URL + "/vehicle/generate-vehicle-route/" + selectedScenario.key, { // generate-czml
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor, czml }),
        })
            .then((response) => response.json())
            .then(({ czml, newVehicleData, positions, features }) => {
                setVehicleRoute(positions);
                setCzml(czml);
                setVehicleData(newVehicleData);
                setFeatures(features);

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

        if (currentTime - lastUpdateTime.current >= 1000) { // 1초(1000ms)마다 실행
            lastUpdateTime.current = currentTime;

            const cameraPositionWC = Cesium.Cartesian3.clone(viewer.camera.positionWC);
            const cameraDirectionWC = Cesium.Cartesian3.clone(viewer.camera.directionWC);
            if (vehicleDataRef.current) {
                const newVehicleData = vehicleDataRef.current;
                const type = 'tick';
                changeModelWorkerRef.current.postMessage({ type, newVehicleData, cameraPositionWC, cameraDirectionWC });
            }
            const newVehicleRoute = vehicleRouteStartEndRef.current;
            const lastPositions = lastPositionsRef.current;
            makeOdDataWorkerRef.current?.postMessage({ lastPositions, newVehicleRoute })
        }

        czmlPositionWorkerRef.current.postMessage({ type: 'tick', currentTime: simTime });

    };

    const setSimulation = () => {
        if (!viewer || !czml || !vehicleData || vehicleRoute.length === 0 || !layerManager) return;

        const newVehicleData = vehicleDataRef.current = vehicleData

        const type = 'init';
        changeModelWorkerRef.current.postMessage({ type, newVehicleData })
        const sampleModel = new Cesium.ModelGraphics({
            uri: "CesiumMilkTruck.glb",
            scale: 0.8,
            maximumScale: 0.8,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        });
        // CZML
        loadCzmlDataSource(czml).then((czmlSource) => {
            // Clock 설정
            viewer.clock.shouldAnimate = isRunningRef.current;

            // 초기화
            layerManager.removeSimulationLayers();
            const vectorSource = new VectorSource();
            layerManager.addVehicleLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, czmlSource);
            layerManager.addHeatmapLayer(vehicleRoute, vectorSource, speedFactor, isRunningRef.current, heatmapSetting)
            layerManager.addODArrows(vehicleRoute, speedFactor, isRunningRef.current)
            layerManager.addTripLayer(vehicleRoute, speedFactor, isRunningRef.current)
        });



        // Worker 메시지 처리
        changeModelWorkerRef.current.onmessage = (e) => {
            const map = entityMapRef.current;

            e.data.forEach(data => {
                const vehicleEntity = map.get(data.id);

                if (data.changed) {
                    if (data.display) {
                        vehicleEntity.model = sampleModel;
                        //layerManager?.hideLayer("layer", "default");
                    } else {
                        vehicleEntity.model = undefined;
                        layerManager?.showLayer("analyze", "default");
                    }
                }
            });
            vehicleDataRef.current = e.data;
        };

        czmlPositionWorkerRef.current.onmessage = (e) => {
            const { positions } = e.data;
            if (positions) {
                layerManager.getLayerGroup("analyze").forEach((layer) => {
                    if (layer && typeof layer.setLatestPositions === "function") {
                        try {
                            layer.setLatestPositions(positions)
                            lastPositionsRef.current = positions
                        } catch (err) {
                            console.warn("[LayerManager] setLatestPositions 실행 오류:", err);
                        }
                    } else {
                        console.log("[LayerManager] 해당 layer는 setLatestPositions를 지원하지 않음:", layer);
                    }
                });
            }
        }

        makeOdDataWorkerRef.current.onmessage = (e) => {
            const { odData } = e.data;
            if (odData) {
                layerManager.getLayer("analyze", "od").forEach((layer)=> {
                    if (layer && typeof layer.setOdData === "function") {
                        try {
                            layer.setOdData(odData)
                        } catch (err) {
                            console.warn("[LayerManager] setOdData 실행 오류:", err);
                        }
                    } else {
                        console.log("[LayerManager] 해당 layer는 setOdData 지원하지 않음:", layer);

                    }
                });
            }
        }
        layerManager?.showLayer("analyze", "default");
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