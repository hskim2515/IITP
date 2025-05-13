import { useEffect, useRef } from "react";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import FieldPrimitive from "@primitives/FieldPrimitive";
import DomePrimitive from "@primitives/DomePrimitive";
import { useLayerStore } from "@stores/useLayerStore";
import * as Cesium from "cesium";
import TailPrimitive from "@primitives/TailPrimitive";
import HeatBarLayer from "@primitives/HeatBarLayer";
import {useHeatmapSettingStore} from "@stores/useHeatmapSettingStore";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import { Heatmap } from "ol/layer";
import VectorSource from "ol/source/Vector";
import VehicleFactory from "@features/VehicleFactory";
import TrailFactory from "@features/TrailFactory";
import ODMatrixFactory from "@features/ODMatrixFactory";
import {computeODMatrix} from "@utils/transform"


type GridCellKey = string; // 예: "3_5"

interface ODCellInfo {
    fromKey: GridCellKey;
    toKey: GridCellKey;
    fromCenter: Cesium.Cartesian3;
    toCenter: Cesium.Cartesian3;
    fromCoord: [number, number];
    toCoord: [number, number];
    density: number;
}


const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const heatmapColors = useHeatmapSettingStore((state) => state.colors)
    const heatmapExaggeration = useHeatmapSettingStore((state) => state.exaggeration)
    const heatmapBlur = useHeatmapSettingStore.state.blur();

    const setCzml = useVehicleStore((state) => state.setCzml);
    const setVehicleData = useVehicleStore((state) => state.setVehicleData);
    const setVehicleRoute = useVehicleStore((state) => state.setVehicleRoute);

    const setFeatures = useVehicleStore((state) => state.setFeatures);
    const features = useVehicleStore((state) => state.features);
    const vehicleRoute = useVehicleStore((state) => state.vehicleRoute);

    const olLayerManager = useLayerStore.state.olLayerManager();

    const olVehicleFactoryRef = useRef<VehicleFactory>(null);
    const olTripFactoryRef = useRef<TrailFactory>(null);
    const olODMatrixFactoryRef = useRef<ODMatrixFactory>(null);

    // Ref 선언 (OpenLayers, Cesium, 애니메이션)
    const animationRef = useRef<number | null>(null); // Cesium용
    const animationOlRef = useRef<number | null>(null); // OpenLayers용
    const viewerClockMultiplier = useRef(null);

    const viewer = useCesiumStore((state) => state.viewer);
    const layerManager = useLayerStore((state) => state.layerManager);
    const czml = useVehicleStore((state) => state.czml);
    const vehicleData = useVehicleStore((state) => state.vehicleData);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);

    // 최신 speed와 speedFactor를 참조하기 위한 ref
    const speedRef = useRef(speed);
    const speedFactorRef = useRef(speedFactor);

    const {
        colors,
        exaggeration,
    } = useHeatmapSettingStore();

    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        if (!workerRef.current) {
            workerRef.current = new Worker(new URL('/src/workers/changeModelWorker.ts', import.meta.url), { type: 'module' });
        }

        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    useEffect(() => {
        speedRef.current = speed;
    }, [speed]);

    useEffect(() => {
        speedFactorRef.current = speedFactor;
    }, [speedFactor]);

    // Cesium 시뮬레이션 업데이트 (재생/일시정지/초기화 적용)
    useEffect(() => {
        if (viewer) {
            // primitiveLayerManager.getAllByGroup("layer").forEach((primitive) => {
            //     primitive.setSpeed(speed * speedFactor);
            //     primitive.setStatus(isRunning);
            // });
            if (viewerClockMultiplier.current == null){
                viewerClockMultiplier.current = viewer.clock.multiplier;
            }

            viewer.clock.multiplier = viewerClockMultiplier.current * speed;
            viewer.clock.shouldAnimate = isRunning;

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
            }
        }
    }, [isRunning, isStop, speed, speedFactor]);

    useEffect(() => {
        const olVehicleFactory = olVehicleFactoryRef.current;
        const olVehicleSource = olLayerManager?.getLayerWithGroupName("vehicle", "vehicle").getSource() as VectorSource;
        if (!olVehicleFactory || !olVehicleSource) return;

        olVehicleFactory.setSpeed(speed * speedFactor);
        olVehicleFactory.setStatus(isRunning);

        if (isStop) {
            olVehicleFactory.stop();
        }
    }, [isRunning, isStop, speed, speedFactor]);

    useEffect(() => {
        if (viewer) {

            layerManager?.getLayer("layer","heatmap")?.forEach((primitive) => {
                primitive.setColors(heatmapColors);
                primitive.setExaggeration(heatmapExaggeration);
            });
        }
    }, [heatmapColors, heatmapExaggeration]);

    useEffect(() => {
        if (viewer) {
            const heatmapLayer = olLayerManager?.getLayerWithGroupName("layer","heatmap") as Heatmap
            heatmapLayer.setRadius(heatmapBlur)
            heatmapLayer.setBlur(heatmapBlur)
            heatmapLayer.setGradient(heatmapColors)
        }
    }, [heatmapColors, heatmapBlur, heatmapExaggeration]);

    useEffect(() => {
        fetch(process.env.VITE_API_URL + "/vehicle/generate-vehicle-route", { // generate-czml
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
            });
    }, [numVehicle, speedFactor]);

    // Cesium과 OpenLayers 시뮬레이션 통합: 후처리 및 Cesium 관련 설정
    useEffect(() => {
        let lastUpdateTime = 0;

        const updateFrameFunc = () => {
            const currentTime = performance.now(); // 고해상도 시간 (ms)

            if (currentTime - lastUpdateTime >= 1000) { // 1초(1000ms)마다 실행
                lastUpdateTime = currentTime;

                const cameraPositionWC = viewer.camera.positionWC;
                if (vehicleDataRef.current) {
                    const newVehicleData = vehicleDataRef.current;
                    //worker.postMessage({ newVehicleData, cameraPositionWC });
                    console.log(newVehicleData)
                    workerRef.current.postMessage({ newVehicleData: newVehicleData.filter(v => v.position), cameraPositionWC });
                }
            }
        };

        if(vehicleRoute.length > 0) {
            setOpenlayersSimulation();
            setCesiumSimulation(updateFrameFunc);
        }

        return () => {
            viewer?.scene.preRender.removeEventListener(updateFrameFunc);
            olVehicleFactoryRef.current?.destroy();
        };
    }, [vehicleRoute, isRunning]);

    const setCesiumSimulation = (updateFrameFunc) => {
        if (!viewer || !czml || !vehicleData || vehicleRoute.length === 0) return;

        // 기본 모델 정의
        const sampleModel = new Cesium.ModelGraphics({
            uri: "CesiumMilkTruck.glb",
            scale: 1.0,
            minimumPixelSize: 30,
            maximumScale: 2.0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        });

        // Clock 설정
        viewer.clock.shouldAnimate = isRunning;

        // 초기화
        layerManager?.removeSimulationLayers();

        layerManager?.addHeatmapLayer(vehicleRoute, speedFactor, isRunning, colors, exaggeration)
        layerManager?.addODArrows(vehicleRoute)
        layerManager?.addTripPrimitives(vehicleRoute, speedFactor, isRunning)

        vehicleDataRef.current = vehicleData

        // CZML
        loadCzmlDataSource(czml, sampleModel);

        // Update loop
        viewer.scene.preRender.addEventListener(updateFrameFunc);

        // Worker 메시지 처리
        workerRef.current.onmessage = (e) => {
            e.data.forEach(data => {
                const vehicleEntity = czmlDataSourceRef.current.entities.getById(data.id);
                const now = Cesium.JulianDate.now();
                vehicleEntity.position.getValue(now, data.position);

                if (data.changed) {
                    if (data.display) {
                        vehicleEntity.model = sampleModel;
                        layerManager?.hideLayer("layer", "default");
                    } else {
                        vehicleEntity.model = undefined;
                        layerManager?.showLayer("layer", "default");
                    }
                }
            });
            vehicleDataRef.current = e.data;
        };
        layerManager?.showLayer("layer", "default");
    };

    const loadCzmlDataSource = (czml) => {

        const czmlSource = new Cesium.CzmlDataSource();

        if (czmlDataSourceRef.current) {
            viewer.dataSources.remove(czmlDataSourceRef.current, true);
        }

        czmlSource.load(czml).then(() => {
            viewer.dataSources.add(czmlSource);
            czmlDataSourceRef.current = czmlSource;
        });
    };

    const setOpenlayersSimulation = () => {
        if (!olLayerManager || !features || vehicleRoute.length === 0) return;

        // Source 초기화
        const olVehicleSource = clearOLSource("vehicle", "vehicle");
        const olTripSource = clearOLSource("layer", "trip");
        const olODSource = clearOLSource("layer", "od");

        // Vehicle
        olVehicleFactoryRef.current?.destroy();
        olVehicleFactoryRef.current = new VehicleFactory(features, olVehicleSource, speedFactor, isRunning);
        olVehicleFactoryRef.current.setStatus(isRunning);

        // Trip
        olTripFactoryRef.current?.destroy();
        olTripFactoryRef.current = new TrailFactory(features, olVehicleSource, olTripSource, isRunning);
        olTripFactoryRef.current.setStatus(isRunning);

        // OD
        const odData: ODCellInfo[] = computeODMatrix(vehicleRoute);
        olODMatrixFactoryRef.current?.destroy();
        olODMatrixFactoryRef.current = new ODMatrixFactory(odData, olODSource, isRunning);
        olODMatrixFactoryRef.current.setStatus(isRunning);
    };

    const clearOLSource = (group: string, name: string): VectorSource => {
        const source = olLayerManager.getLayerWithGroupName(group, name).getSource() as VectorSource;
        source.clear();
        return source;
    };
};


export default useSimulation;