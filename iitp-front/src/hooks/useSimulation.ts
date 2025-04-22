import { useEffect, useRef } from "react";
import { LineString, Point } from "ol/geom";
import * as olProj from "ol/proj";
import { Feature } from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import DensityPrimitive from "@primitives/DensityPrimitive";
import HeatMapBend from "@primitives/HeatMapBend";
import HeatMapLayer from "@primitives/HeatMapLayer";
import FieldPrimitive from "@primitives/FieldPrimitive";
import LinePrimitive from "@primitives/LinePrimitive";
import DomePrimitive from "@primitives/DomePrimitive";
import RectanglePrimitive from "@primitives/RectanglePrimitive";
import { useLayerStore } from "@stores/useLayerStore";
import * as Cesium from "cesium";
import TailPrimitive from "@primitives/TailPrimitive";
import HeatBarLayer from "@primitives/HeatBarLayer";
import {useHeatmapSettingStore} from "@stores/useHeatmapSettingStore";
import {useShallow} from "zustand/react/shallow";
import ParabolicArrowPrimitive from "@primitives/ParabolicArrowPrimitive";
import GridAnalyzePrimitive from "@primitives/GridAnalyzePrimitive";

type GridCellKey = string; // 예: "3_5"

interface ODCellInfo {
    fromKey: GridCellKey;
    toKey: GridCellKey;
    fromCenter: Cesium.Cartesian3;
    toCenter: Cesium.Cartesian3;
    density: number;
}


const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const heatmapColors = useHeatmapSettingStore((state) => state.colors)
    const heatmapExaggeration = useHeatmapSettingStore((state) => state.exaggeration)

    const setCzml = useVehicleStore((state) => state.setCzml);
    const setVehicleData = useVehicleStore((state) => state.setVehicleData);
    const setVehicleRoute = useVehicleStore((state) => state.setVehicleRoute);

    const setFeatures = useVehicleStore((state) => state.setFeatures);
    const features = useVehicleStore((state) => state.features);
    const vehicleRoute = useVehicleStore((state) => state.vehicleRoute);

    // OpenLayers 관련 상태 및 레이어
    const map = useOpenLayersStore((state) => state.map);
    const olVehicleLayer = useLayerStore((state) => state.olVehicleLayer);
    const tripLayer = useLayerStore((state) => state.tripLayer);
    const heatmapLayer = useLayerStore((state) => state.heatmapLayer);

    // Ref 선언 (OpenLayers, Cesium, 애니메이션)
    const olVehicleLayerSourceRef = useRef<VectorSource | null>(null);
    const tripLayerSourceRef = useRef<VectorSource | null>(null);
    const heatmapLayerSourceRef = useRef<VectorSource | null>(null);
    const vehicleLayerRef = useRef(null);
    const vehicleSourceRef = useRef(null);
    const animationRef = useRef<number | null>(null); // Cesium용
    const animationOlRef = useRef<number | null>(null); // OpenLayers용
    const viewerClockMultiplier = useRef(null);
    const vehiclesRef = useRef([]);

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
        if (viewer) {
            primitiveLayerManager?.get("layer","heatmap").forEach((primitive) => {
                primitive.setColors(heatmapColors);
                primitive.setExaggeration(heatmapExaggeration);
            });
        }
    }, [heatmapColors, heatmapExaggeration]);

    const updateTrip = (vehicleFeature) => {
        if (!isRunning) return;

        if (!tripLayerSourceRef.current) {
            tripLayerSourceRef.current = tripLayer?.getSource();
        }

        const currentCoord = vehicleFeature.getGeometry().getCoordinates();
        const tripFeatureId = vehicleFeature.getId() + "_trip";
        let tripFeature = tripLayerSourceRef.current.getFeatureById(tripFeatureId);

        if (!tripFeature) {
            tripFeature = new Feature({
                geometry: new LineString([currentCoord]),
            });
            tripFeature.setId(tripFeatureId);
            tripLayerSourceRef.current.addFeature(tripFeature);
        } else {
            const currentTrail = tripFeature.getGeometry().getCoordinates();
            currentTrail.push(currentCoord);
            tripFeature.getGeometry().setCoordinates(currentTrail);
        }
    }

// trip 배열 초기화를 위한 메서드
    const resetToInitialPosition = () => {
        const layer = tripLayer; // useLayerStore에서 가져온 tripLayer
        if (!layer) {
            console.warn("Trip layer is undefined.");
            return;
        }
        const source = layer.getSource();
        if (!source) {
            console.warn("Trip layer source is undefined.");
            return;
        }
        source.clear();
    };

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
                resetToInitialPosition();
            });
    }, [numVehicle, speedFactor]);

    // OpenLayers: 각 차량 Feature의 현재 위치를 보간(interpolation)하여 업데이트하는 함수
    const updateCurrentVehiclePosition = (feature) => {
        const routeFeature = feature.get("routeFeature"); // 전체 경로 배열
        let currentIndex = feature.get("currentIndex");
        let progress = feature.get("progress");

        if (currentIndex >= routeFeature.length - 1) return;

        // 최신 speed와 speedFactor를 적용하여 보간 진행률(stepSize) 계산
        // 상수 0.000128로 조정하여 기본 속도를 낮추고, 속도 변경도 즉시 반영
        const stepSize = speedRef.current * speedFactorRef.current * 0.000128;
        progress += stepSize;

        if (progress >= 1) {
            progress = 0;
            currentIndex = Math.min(currentIndex + 1, routeFeature.length - 1);
        }

        feature.set("currentIndex", currentIndex);
        feature.set("progress", progress);

        const start = olProj.fromLonLat(routeFeature[currentIndex]);
        let end = start;
        if (routeFeature[currentIndex + 1]) {
            end = olProj.fromLonLat(routeFeature[currentIndex + 1]) || start;
        }

        // sine 함수를 사용한 보간으로 자연스러운 움직임 구현
        const interpX = start[0] + (end[0] - start[0]) * Math.sin(progress * Math.PI * 0.5);
        const interpY = start[1] + (end[1] - start[1]) * Math.sin(progress * Math.PI * 0.5);

        feature.setGeometry(new Point([interpX, interpY]));
    };

    // OpenLayers: 60FPS 애니메이션 루프를 통해 각 차량 Feature의 위치를 업데이트
    const updateOlSimulation = () => {
        if (!olVehicleLayerSourceRef.current) return;
        olVehicleLayerSourceRef.current.getFeatures().forEach((feature) => {
            updateCurrentVehiclePosition(feature);
            updateTrip(feature);
        });
        animationOlRef.current = requestAnimationFrame(updateOlSimulation);
    };

    // OpenLayers 애니메이션 제어: 재생(isRunning), 일시정지, 초기화(isStop) 조건 적용
    useEffect(() => {
        if (!olVehicleLayerSourceRef.current) return;
        if (isRunning) {
            if (!animationOlRef.current) {
                animationOlRef.current = requestAnimationFrame(updateOlSimulation);
            }
        } else {
            if (animationOlRef.current) {
                cancelAnimationFrame(animationOlRef.current);
                animationOlRef.current = null;
            }
        }
        if (isStop) {
            resetToInitialPosition();
            if (olVehicleLayerSourceRef.current) {
                const currentFeatures = olVehicleLayerSourceRef.current.getFeatures();
                currentFeatures.forEach((feature) => {
                    const route = feature.get("routeFeature");
                    if (route && route.length > 0) {
                        feature.set("currentIndex", 0);
                        feature.set("progress", 0);
                        const initialCoord = olProj.fromLonLat(route[0]);
                        feature.setGeometry(new Point(initialCoord));
                    }
                });
            }
        }
    }, [isRunning, isStop, features]);

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

    const animate = () => {
        if (!isRunning) return;

        const vehicleFeatures = vehicleSourceRef.current.getFeatures();
        const now = performance.now();

        vehicleFeatures.forEach((vehicle) => {
            const lastUpdate = vehicle.get("lastUpdateTime") || 0;
            const updateInterval = vehicle.get("updateInterval") || 100;

            if (!vehicle.get("initialPosition")) {
                vehicle.set("initialPosition", vehicle.getGeometry().getCoordinates());
            }

            if (now - lastUpdate >= updateInterval) {
                vehicle.set("lastUpdateTime", now);
                updateTrip(vehicle)
            }

        });

        animationRef.current = requestAnimationFrame(animate);
    };


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
            map?.removeLayer(vehicleLayerRef.current);
            viewer?.scene.preRender.removeEventListener(updateFrameFunc);
        };
    }, [vehicleRoute]);

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
        if (!map || !features || features.length === 0) return;
        olVehicleLayerSourceRef.current = olVehicleLayer.getSource();
        // 기존 feature 제거 (차량 수 변경에 따른 초기화)
        olVehicleLayerSourceRef.current.clear();
        resetToInitialPosition();

        const vehicleFeatures = features.map((feature, idx) => {
            const { geometry } = feature;
            const initialCoordinate = geometry.coordinates[0];
            const transformedCoord = olProj.fromLonLat(initialCoordinate);
            const vehiclePoint = new Point(transformedCoord);
            const vehicleFeature = new Feature({
                geometry: vehiclePoint,
            });
            // routeFeature에 원본 경로 좌표(경도, 위도, 고도)를 저장
            vehicleFeature.set("routeFeature", geometry.coordinates);
            vehicleFeature.set("currentIndex", 0);
            vehicleFeature.set("progress", 0);
            vehicleFeature.set("updateInterval", 18);
            vehicleFeature.set("lastUpdateTime", performance.now());
            vehicleFeature.setId(`vehicle${idx}`);
            return vehicleFeature;
        });
        olVehicleLayerSourceRef.current.addFeatures(vehicleFeatures);
    };

    const computeODMatrix = (
        geoPointGroups: { x: number; y: number; z: number }[][],
        gridSize: number = 0.01
    ): ODCellInfo[] => {
        const odMap = new Map<string, { fromKey: string; toKey: string; fromCenter: Cesium.Cartesian3; toCenter: Cesium.Cartesian3; count: number }>();

        // 격자 중심 구하기
        const getGridKeyAndCenter = (x: number, y: number): [string, Cesium.Cartesian3] => {
            const gridX = Math.floor(x / gridSize);
            const gridY = Math.floor(y / gridSize);
            const key = `${gridX}_${gridY}`;
            const centerLon = (gridX + 0.5) * gridSize;
            const centerLat = (gridY + 0.5) * gridSize;

            const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0);
            return [key, centerCartesian];
        };

        for (const route of geoPointGroups) {
            if (route.length < 2) continue;

            const start = route[0];
            const end = route[route.length - 1];

            const [fromKey, fromCenter] = getGridKeyAndCenter(start.x, start.y);
            const [toKey, toCenter] = getGridKeyAndCenter(end.x, end.y);
            const pairKey = `${fromKey}→${toKey}`;

            if (!odMap.has(pairKey)) {
                odMap.set(pairKey, {
                    fromKey,
                    toKey,
                    fromCenter,
                    toCenter,
                    count: 0,
                });
            }

            odMap.get(pairKey)!.count += 1;
        }

        const odArray = Array.from(odMap.values());

        // 최대 count로 정규화하여 density로 설정
        const maxCount = Math.max(...odArray.map((item) => item.count), 1); // 0 방지

        const result: ODCellInfo[] = odArray.map(item => ({
            fromKey: item.fromKey,
            toKey: item.toKey,
            fromCenter: item.fromCenter,
            toCenter: item.toCenter,
            density: item.count / maxCount
        }));

        return result;
    };


};


export default useSimulation;