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
import VehicleDensityPrimitive from "@primitives/VehicleDensityPrimitive";
import HeatMapBend from "@primitives/HeatMapBend";
import HeatMapLayer from "@primitives/HeatMapLayer";
import VehicleFieldPrimitive from "@primitives/VehicleFieldPrimitive";
import VehicleRootPrimitive from "@primitives/VehicleRootPrimitive";
import VehicleDomePrimitive from "@primitives/VehicleDomePrimitive";
import VehicleRectanglePrimitive from "@primitives/VehicleRectanglePrimitive";
import { useLayerStore } from "@stores/useLayerStore";
import * as Cesium from "cesium";

const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

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
    const worker = new Worker(new URL('/src/workers/changeModelWorker.ts', import.meta.url), { type: 'module'  });

    // 최신 speed와 speedFactor를 참조하기 위한 ref
    const speedRef = useRef(speed);
    const speedFactorRef = useRef(speedFactor);
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
            if (viewerClockMultiplier.current == null)
                viewerClockMultiplier.current = viewer.clock.multiplier;
            viewer.clock.multiplier = viewerClockMultiplier.current * speed;
            viewer.clock.shouldAnimate = isRunning;

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
            }
        }
    }, [isRunning, isStop, speed, speedFactor]);

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
        fetch("http://localhost:8080/vehicle/generate-vehicle-route", { // generate-czml
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor, czml }),
        })
            .then((response) => response.json())
            .then(({ czml, newVehicleData, positions, features }) => {
                console.log(czml)
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
                    worker.postMessage({ newVehicleData, cameraPositionWC });

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

    const setCesiumSimulation = (updateFrameFunc) => {


        if(czml && vehicleData && vehicleRoute.length != 0){
            if (!viewer) return;
            console.log(isRunning)

            viewer.clock.shouldAnimate = isRunning;
            primitiveLayerManager?.removeGroup("layer")
            //viewer.scene.primitives.remove(primitivesCollectionRef.current)

            //primitivesCollectionRef.current = getPrimitiveCollectionByName("layer");

            //const primitiveCollection = primitivesCollectionRef.current
            const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);

            //const vehicleDensityPrimitive = new VehicleDensityPrimitive(timeBasedPositions, viewer.scene.context);
            //primitiveCollection.add(vehicleDensityPrimitive);
            const heatMapLayer = new HeatMapLayer(viewer, timeBasedPositions, speedFactor, isRunning);
            primitiveLayerManager.add(heatMapLayer, "layer", "heatmap");

            vehicleRoute.forEach((position) => {
                const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);

                position = new Cesium.Cartesian3.fromDegreesArrayHeights(flatArray)
                const vehicleFieldPrimitive = new VehicleFieldPrimitive(position, viewer.scene.context, speedFactor, isRunning);
                const vehicleRootPrimitive = new VehicleRootPrimitive(position, viewer.scene.context, speedFactor, isRunning);
                const vehicleRectanglePrimitive = new VehicleRectanglePrimitive(position, viewer.scene.context,speedFactor, isRunning);
                const vehicleDomePrimitive = new VehicleDomePrimitive(position, viewer.scene.context, speedFactor, isRunning);
                primitiveLayerManager.add(vehicleFieldPrimitive, "layer", "trip");
                primitiveLayerManager.add(vehicleRootPrimitive, "layer", "trip");
                primitiveLayerManager.add(vehicleRectanglePrimitive, "layer", "trip");
                primitiveLayerManager.add(vehicleDomePrimitive, "layer", "trip");

            });

            // 모든 VehicleFieldPrimitive 객체를 viewer의 scene에 추가

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
            worker.onmessage = (e) => {
                vehicleDataRef.current = e.data;

                e.data.forEach(data => {
                    if(data.changed){

                        const vehicleEntity = newCzmlDataSource.entities.getById(data.id);
                        if (data.displayType === "model") {
                            vehicleEntity.path = undefined;
                            vehicleEntity.point = undefined;
                            vehicleEntity.model = new Cesium.ModelGraphics({
                                uri: "CesiumMilkTruck.glb",
                                scale: 1.0,
                                minimumPixelSize: 30,
                                maximumScale: 2.0,
                                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                            });
                        }
                        else if(data.displayType === "point") {
                            vehicleEntity.model = undefined;
                            vehicleEntity.path = undefined;
                            vehicleEntity.point = new Cesium.PointGraphics({
                                color: Cesium.Color.RED,
                                outlineColor: Cesium.Color.BLACK,
                                outlineWidth: 1,
                                pixelSize: 10,
                                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                            });
                        }
                        else if(data.displayType === "line") {
                            vehicleEntity.model = undefined;
                            vehicleEntity.point = undefined;
                            vehicleEntity.path = new Cesium.PolylineGraphics({
                                material: new Cesium.PolylineOutlineMaterialProperty({
                                    color: Cesium.Color.RED.withAlpha(0.1), // 주 색상 (보라색)
                                }),
                                width: 10, // 선 두께
                                leadTime: 10, // 앞쪽으로 보이는 길이
                                trailTime: 10, // 뒤쪽으로 보이는 길이
                                resolution: 5, // 경로 해상도
                                clampToGround: true, // 지면에 붙이기
                            });
                        }
                    }
                });
            };
        }
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

};


export default useSimulation;