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
import VehicleFactory from "../features/VehicleFactory";
import TrailFactory from "../features/TrailFactory";
import ODMatrixFactory from "../features/ODMatrixFactory";
import { Coordinate } from "ol/coordinate";

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
    const primitiveLayerManager = useLayerStore((state) => state.cesiumPrimitiveLayerManager);
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
            primitiveLayerManager.getAllByGroup("layer").forEach((primitive) => {
                primitive.setSpeed(speed * speedFactor);
                primitive.setStatus(isRunning);
            });
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
            primitiveLayerManager?.get("layer","heatmap").forEach((primitive) => {
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

    const transformToTimeBasedPositions = (vehiclePositions)=> {
        if (vehiclePositions.length === 0) return [];

        const timeSteps = Math.max(...vehiclePositions.map(arr => arr.length));
        const timeBasedPositions = Array.from({ length: timeSteps }, () => []);

        vehiclePositions.forEach((vehicleData) => {
            if (!vehicleData) return; // vehicleData가 없으면 해당 반복을 건너뜀

            for(let i = 0; i < timeSteps; i++){
                const entry = vehicleData[i];
                if (entry) {
                    timeBasedPositions[i].push(new Cesium.Cartesian3.fromDegrees(entry.x, entry.y, entry.z));
                } else {
                    timeBasedPositions[i].push(null);
                }
            }
        });
        return timeBasedPositions;
    }

    const generateCzmlFromCoordinates = (coordinatesArray) => {
        const czml = [
            {
                "id": "document",
                "name": "Vehicle Movement",
                "version": "1.0"
            },
        ];
        coordinatesArray.forEach( (ca,idx) => {
            const currentTime = new Date().toISOString();

            // Start the CZML structure
            const czmlObj = {
                "id": "vehicle"+idx,
                "availability": `${currentTime}/${new Date(Date.now() + ca.length * 1000).toISOString()}`, // Set availability from current time to an end time based on coordinates
                "position": {
                    "interpolationDegree": 2,
                    "epoch": currentTime,
                    "cartesian": [],
                    "interpolationAlgorithm":"LINEAR"
                },
                "orientation": {
                    "velocityReference": "#position"
                },
                "point": {
                    "outlineWidth": 1,
                    "pixelSize": 10
                }
            };

            const flatArray = ca.flatMap(({ x, y, z }) => [x, y, z]);

            Cesium.Cartesian3.fromDegreesArrayHeights(flatArray).forEach((coordinates, index) => {
                const time = index;
                czmlObj.position.cartesian.push(time, coordinates.x, coordinates.y, coordinates.z);
            });
            czml.push(czmlObj)
        })
        return czml;
    }

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
                    //console.log(newVehicleData)
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

        if(czml && vehicleData && vehicleRoute.length != 0){
            if (!viewer) return;

            const sampleModel = new Cesium.ModelGraphics({
                uri: "CesiumMilkTruck.glb",
                scale: 1.0,
                minimumPixelSize: 30,
                maximumScale: 2.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            });

            viewer.clock.shouldAnimate = isRunning;
            // layer init
            primitiveLayerManager?.removeGroup("layer");

            const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);
            const heatBarLayer = new HeatBarLayer(viewer, timeBasedPositions, speedFactor, isRunning, colors, exaggeration);
            //const heatBarLayer = new GridAnalyzePrimitive(viewer, timeBasedPositions, speedFactor, isRunning, colors, exaggeration);
            primitiveLayerManager.add(heatBarLayer, "layer", "heatmap");

            const sampleOD = computeODMatrix(vehicleRoute);

            sampleOD.forEach(cell => {
                const odPrimitive = new ParabolicArrowPrimitive(viewer.scene.context, cell.fromCenter, cell.toCenter, cell.density);
                primitiveLayerManager.add(odPrimitive, "layer", "od");
            })

            //const primitive = new ParabolicArrowPrimitive(viewer.scene.context, vehicleRoute[0]);

            vehicleRoute.forEach((position) => {
                const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);
                position = new Cesium.Cartesian3.fromDegreesArrayHeights(flatArray);

                const vehicleFieldPrimitive = new FieldPrimitive(position, viewer.scene.context, speedFactor, isRunning);
                const tailPrimitive = new TailPrimitive(position, viewer.scene.context,speedFactor, isRunning);
                const vehicleDomePrimitive = new DomePrimitive(position, viewer.scene.context, speedFactor, isRunning);

                //arrowLayer.flyToLastArrow(viewer)
                //arrowLayer.update()

                //arrowLayer.update(); // 렌더링 수행

                primitiveLayerManager.add(vehicleFieldPrimitive, "layer", "trip");
                primitiveLayerManager.add(tailPrimitive, "layer", "trip");
                primitiveLayerManager.add(vehicleDomePrimitive, "layer", "default");
            });

            //const czml = generateCzmlFromCoordinates(positions);
            vehicleDataRef.current = vehicleData
            if (czmlDataSourceRef.current) {
                viewer.dataSources.remove(czmlDataSourceRef.current, true); // true 옵션을 주면 완전히 제거됨
            }

            const newCzmlDataSource = new Cesium.CzmlDataSource();

            newCzmlDataSource.load(czml).then(() => {
                viewer.dataSources.add(newCzmlDataSource);
                czmlDataSourceRef.current = newCzmlDataSource; // 레퍼런스 업데이트
            });

            viewer.scene.preRender.addEventListener(updateFrameFunc);
            workerRef.current.onmessage = (e) => {

                e.data.forEach(data => {

                    const vehicleEntity = newCzmlDataSource.entities.getById(data.id);
                    const now = Cesium.JulianDate.now(); // 현재 시각
                    const position = vehicleEntity.position.getValue(now); // 현재 위치 (Cartesian3)
                    data.position = position

                    if(data.changed){

                        if (data.display) {
                            vehicleEntity.model = sampleModel;
                            primitiveLayerManager?.hide("layer", "default");
                        }else{
                            vehicleEntity.model = undefined;
                            primitiveLayerManager?.show("layer", "default");
                        }
                        // else if(data.displayType === "point") {
                        //     vehicleEntity.model = undefined;
                        //     vehicleEntity.path = undefined;
                        //     vehicleEntity.point = new Cesium.PointGraphics({
                        //         color: Cesium.Color.RED,
                        //         outlineColor: Cesium.Color.BLACK,
                        //         outlineWidth: 1,
                        //         pixelSize: 10,
                        //         heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        //     });
                        // }
                        // else if(data.displayType === "line") {
                        //     vehicleEntity.model = undefined;
                        //     vehicleEntity.point = undefined;
                        //     vehicleEntity.path = new Cesium.PolylineGraphics({
                        //         material: new Cesium.PolylineOutlineMaterialProperty({
                        //             color: Cesium.Color.RED.withAlpha(0.1), // 주 색상 (보라색)
                        //         }),
                        //         width: 10, // 선 두께
                        //         leadTime: 10, // 앞쪽으로 보이는 길이
                        //         trailTime: 10, // 뒤쪽으로 보이는 길이
                        //         resolution: 5, // 경로 해상도
                        //         clampToGround: true, // 지면에 붙이기
                        //     });
                        // }
                    }
                });

                vehicleDataRef.current = e.data;
            };
        }
        primitiveLayerManager?.show("layer", "default")
    }

    const setOpenlayersSimulation = () => {
        if (!olLayerManager || !features || vehicleRoute.length === 0) return;

        const olVehicleSource = olLayerManager.getLayerWithGroupName("vehicle", "vehicle").getSource() as VectorSource;
        olVehicleSource.clear();

        const olTripSource = olLayerManager.getLayerWithGroupName("layer", "trip").getSource() as VectorSource;
        olTripSource.clear();

        const olODSource = olLayerManager.getLayerWithGroupName("layer", "od").getSource() as VectorSource;
        olODSource.clear();

        olVehicleFactoryRef.current?.destroy();
        olVehicleFactoryRef.current = new VehicleFactory(features, olVehicleSource, speedFactor, isRunning);
        olVehicleFactoryRef.current.setStatus(isRunning);

        olTripFactoryRef.current?.destroy();
        olTripFactoryRef.current = new TrailFactory(features, olVehicleSource, olTripSource, isRunning);
        olTripFactoryRef.current.setStatus(isRunning);

        const odData: ODCellInfo[] = computeODMatrix(vehicleRoute);

        olODMatrixFactoryRef.current?.destroy();
        olODMatrixFactoryRef.current = new ODMatrixFactory(odData, olODSource, isRunning);
        olODMatrixFactoryRef.current.setStatus(isRunning);

    };

    const computeODMatrix = (
        geoPointGroups: { x: number; y: number; z: number }[][],
        gridSize: number = 0.01
    ): ODCellInfo[] => {
        const odMap = new Map<string, {
            fromKey: string;
            toKey: string;
            fromCenter: Cesium.Cartesian3;
            toCenter: Cesium.Cartesian3;
            fromCoord: [number, number];
            toCoord: [number, number];
            count: number;
        }>();

        const getGridKeyAndCenter = (x: number, y: number): [string, Cesium.Cartesian3, [number, number]] => {
            const gridX = Math.floor(x / gridSize);
            const gridY = Math.floor(y / gridSize);
            const key = `${gridX}_${gridY}`;
            const centerLon = (gridX + 0.5) * gridSize;
            const centerLat = (gridY + 0.5) * gridSize;

            const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0);
            return [key, centerCartesian, [centerLon, centerLat]];
        };

        for (const route of geoPointGroups) {
            if (route.length < 2) continue;

            const start = route[0];
            const end = route[route.length - 1];

            const [fromKey, fromCenter, fromCoord] = getGridKeyAndCenter(start.x, start.y);
            const [toKey, toCenter, toCoord] = getGridKeyAndCenter(end.x, end.y);
            const pairKey = `${fromKey}→${toKey}`;

            if (!odMap.has(pairKey)) {
                odMap.set(pairKey, {
                    fromKey,
                    toKey,
                    fromCenter,
                    toCenter,
                    fromCoord,
                    toCoord,
                    count: 0,
                });
            }

            odMap.get(pairKey)!.count += 1;
        }

        const odArray = Array.from(odMap.values());
        const maxCount = Math.max(...odArray.map((item) => item.count), 1); // 0 방지

        return odArray.map(item => ({
            ...item,
            density: item.count / maxCount,
        }));
    };



};


export default useSimulation;