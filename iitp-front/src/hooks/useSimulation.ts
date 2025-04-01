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
    const czml = useVehicleStore((state) => state.czml);
    const vehicleData = useVehicleStore((state) => state.vehicleData);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);
    const primitivesCollectionRef = useRef(null);
    //const worker = new Worker(new URL('/src/workers/changeModelWorker.ts', import.meta.url), { type: 'module'  });

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
            console.log(isRunning);
            primitivesCollectionRef.current._primitives.forEach((primitive) => {
                primitive.setSpeed(speed * speedFactor);
                primitive.setStatus(isRunning);
            });
            if (viewerClockMultiplier.current == null)
                viewerClockMultiplier.current = viewer.clock.multiplier;
            viewer.clock.multiplier = viewerClockMultiplier.current * speed;
            if (isRunning) {
                viewer.clock.shouldAnimate = true;
            } else {
                viewer.clock.shouldAnimate = false;
                if (animationRef.current) {
                }
            }
            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
            }
        }
    }, [isRunning, isStop, speed, speedFactor]);

    useEffect(() => {
        fetch("http://localhost:8080/vehicle/generate-vehicle-route", { // generate-czml
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor }),
        })
            .then((response) => response.json())
            .then(({ czml, newVehicleData, positions, features }) => {
                setCzml(czml);
                setVehicleData(newVehicleData);
                setVehicleRoute(positions);
                setFeatures(features);
            });
    }, [numVehicle, speedFactor, viewer, map]);


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
        });
        animationOlRef.current = requestAnimationFrame(updateOlSimulation);
    };

    // OpenLayers 애니메이션 제어: 재생(isRunning), 일시정지, 초기화(isStop) 조건 적용
    useEffect(() => {
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
        const updateFrameFunc = () => {
            const cameraPositionWC = viewer.camera.positionWC;
            if (vehicleDataRef.current) {
                const currentTime = viewer.clock.currentTime;
                const newVehicleData = vehicleDataRef.current;
                // 추가 작업: heatmap 업데이트 또는 worker 처리 등
            }
        };
        setOpenlayersSimulation();
        setCesiumSimulation(updateFrameFunc);

        return () => {
            map?.removeLayer(vehicleLayerRef.current);
            viewer?.scene.preRender.removeEventListener(updateFrameFunc);
        };
    }, [vehicleRoute]);

    const transformToTimeBasedPositions = (vehiclePositions)=> {
        if (vehiclePositions.length === 0) return [];

        const timeSteps = vehiclePositions[0].length; // 시점 개수 (모든 차량이 동일한 시점 개수를 가정)
        const timeBasedPositions = Array.from({ length: timeSteps }, () => []);

        vehiclePositions.forEach((vehicleData) => {
            vehicleData.forEach((entry, timeIndex) => {
                timeBasedPositions[timeIndex]?.push(new Cesium.Cartesian3.fromDegrees(entry.x, entry.y, entry.z));
            });
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

    // 회전 계산 함수
    const applyRotation = (obj) => {
        const segIndex = Math.floor(obj.animationIndex);
        if (segIndex < obj.interpolatedPath.length - 1) {
            const p0 = olProj.fromLonLat(obj.interpolatedPath[segIndex]);
            const p1 = olProj.fromLonLat(obj.interpolatedPath[segIndex + 1]);
            const dx = p1[0] - p0[0];
            const dy = p1[1] - p0[1];
            const computedAngle = Math.atan2(dx, dy);
            if (obj.feature.get("rotation") !== computedAngle) {
                obj.feature.set("rotation", computedAngle);
            }
        }
    };

    const updateTrail = (vehicleFeature, currentCoord) => {
        let trail = vehicleFeature.get("trail") || [];
        trail.push(currentCoord);

        if(trail.length > 100) {
            trail.shift();
        }
        vehicleFeature.set("trail", trail);
    }

    const updateVehicleAndTrail = (vehicle) => {
        const currentCoord = vehicle.getGeometry().getCoordinates();
        // trail 배열 업데이트
        updateTrail(vehicle, currentCoord);

        // trailFeature 업데이트: 차량의 'trail' 속성에 저장된 좌표를 사용해 LineString 피처로 표현
        const trail = vehicle.get("trail");

        let trailFeature = vehicle.get("trailFeature");
        if (!trailFeature) {
            // 새로운 trailFeature 생성
            trailFeature = new Feature({
                geometry: new LineString(trail),
            });
            //trailLayer.getSource().addFeature(trailFeature);
            vehicle.set("trailFeature", trailFeature);
        } else {
            // 기존 trailFeature의 geometry 좌표 업데이트
            trailFeature.getGeometry().setCoordinates(trail);
        }
    };

    // 화면 내 차량에 대해 상세한 애니메이션(회전 계산 등)을 적용하는 함수
    const applyDetailedAnimation = (vehicle) => {
        const routeFeature = vehicle.get("routeFeature");
        //const coords = routeFeature.getGeometry().getCoordinates();
        const currentIndex = vehicle.get("currentIndex");
        const progress = vehicle.get("progress");
        const animationIndex = currentIndex + progress;
        applyRotation({
            interpolatedPath: routeFeature,
            animationIndex: animationIndex,
            feature: vehicle,
        });
    };

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
                updateVehiclePosition(vehicle);
                vehicle.set("lastUpdateTime", now);
                updateVehicleAndTrail(vehicle);
            }

            applyDetailedAnimation(vehicle);
        });

        animationRef.current = requestAnimationFrame(animate);
    };

    const resetToInitialPosition = () => {
        const vehicleFeatures = vehicleSourceRef.current.getFeatures();
        vehicleFeatures.forEach((vehicle) => {
            const initialPosition = vehicle.get("initialPosition");
            if (initialPosition) {
                vehicle.getGeometry().setCoordinates(initialPosition);
            }
        });
    };

    const updateVehiclePosition = (vehicle) => {
        let coords = vehicle.get("routeFeature");
        let currentIndex = vehicle.get("currentIndex");
        let progress = vehicle.get("progress");

        if (currentIndex >= coords.length - 1) {
            return;
        }

        const stepSize = 18 / speedFactor;
        progress += stepSize;

        if (progress >= 1) {
            progress = 0;
            currentIndex = Math.min(currentIndex + 1, coords.length - 1);
        }

        vehicle.set("currentIndex", currentIndex);
        vehicle.set("progress", progress);

        const start = olProj.fromLonLat(coords[currentIndex]);
        let end = start;

        if (coords[currentIndex + 1]) {
            end = olProj.fromLonLat(coords[currentIndex + 1]) || start;
        }

        const interpX = start[0] + (end[0] - start[0]) * Math.sin(progress * Math.PI * 0.5);
        const interpY = start[1] + (end[1] - start[1]) * Math.sin(progress * Math.PI * 0.5);

        vehicle.setGeometry(new Point([interpX, interpY]));
    };

    const setCesiumSimulation = (updateFrameFunc) => {
        if (!viewer) return;

        viewer.clock.shouldAnimate = isRunning;
        viewer.scene.primitives.remove(primitivesCollectionRef.current)

        if(czml && vehicleData){

            primitivesCollectionRef.current = new Cesium.PrimitiveCollection();
            const primitiveCollection = primitivesCollectionRef.current
            const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);

            const vehicleDensityPrimitive = new VehicleDensityPrimitive(timeBasedPositions, viewer.scene.context);
            //const heatMapLayer = new HeatMapBend(viewer, timeBasedPositions);
            //primitives.add(vehicleDensityPrimitive);
            //primitives.add(heatMapLayer);

            vehicleRoute.forEach((position,i) => {
                //if(i == 0){
                const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);

                position = new Cesium.Cartesian3.fromDegreesArrayHeights(flatArray)
                const vehicleFieldPrimitive = new VehicleFieldPrimitive(position, viewer.scene.context, speedFactor, isRunning);
                const vehicleRootPrimitive = new VehicleRootPrimitive(position, viewer.scene.context, speedFactor, isRunning);
                const vehicleRectanglePrimitive = new VehicleRectanglePrimitive(position, viewer.scene.context,speedFactor, isRunning);
                const vehicleDomePrimitive = new VehicleDomePrimitive(position, viewer.scene.context, speedFactor, isRunning);
                primitiveCollection.add(vehicleFieldPrimitive);
                primitiveCollection.add(vehicleRootPrimitive);
                primitiveCollection.add(vehicleRectanglePrimitive);
                primitiveCollection.add(vehicleDomePrimitive);
                //}
            });

            // 모든 VehicleFieldPrimitive 객체를 viewer의 scene에 추가
            viewer.scene.primitives.add(primitiveCollection);

            //const czml = generateCzmlFromCoordinates(positions);
            vehicleDataRef.current = vehicleData
            if (czmlDataSourceRef.current) {
                viewer.dataSources.remove(czmlDataSourceRef.current, true); // true 옵션을 주면 완전히 제거됨
            }

            viewer.scene.preRender.addEventListener(updateFrameFunc);
            // worker.onmessage = (e) => {
            //     vehicleDataRef.current = e.data;
            //     e.data.forEach(data => {
            //         if(data.changed){
            //             const vehicleEntity = newCzmlDataSource.entities.getById(data.id);
            //             if (data.displayType === "model") {
            //                 vehicleEntity.path = undefined;
            //                 vehicleEntity.point = undefined;
            //                 vehicleEntity.model = new Cesium.ModelGraphics({
            //                     uri: "CesiumMilkTruck.glb",
            //                     scale: 1.0,
            //                     minimumPixelSize: 30,
            //                     maximumScale: 2.0,
            //                     heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            //                 });
            //             }
            //             else if(data.displayType === "point") {
            //                 vehicleEntity.model = undefined;
            //                 vehicleEntity.path = undefined;
            //                 vehicleEntity.point = new Cesium.PointGraphics({
            //                     color: Cesium.Color.RED,
            //                     outlineColor: Cesium.Color.BLACK,
            //                     outlineWidth: 1,
            //                     pixelSize: 10,
            //                     heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            //                 });
            //             }
            //             else if(data.displayType === "line") {
            //                 vehicleEntity.model = undefined;
            //                 vehicleEntity.point = undefined;
            //                 vehicleEntity.path = new Cesium.PolylineGraphics({
            //                     material: new Cesium.PolylineOutlineMaterialProperty({
            //                         color: Cesium.Color.RED.withAlpha(0.1), // 주 색상 (보라색)
            //                     }),
            //                     width: 10, // 선 두께
            //                     leadTime: 10, // 앞쪽으로 보이는 길이
            //                     trailTime: 10, // 뒤쪽으로 보이는 길이
            //                     resolution: 5, // 경로 해상도
            //                     clampToGround: true, // 지면에 붙이기
            //                 });
            //             }
            //         }
            //     });
            // };

            const newCzmlDataSource = new Cesium.CzmlDataSource();

            // newCzmlDataSource.load(czml).then(() => {
            //     viewer.dataSources.add(newCzmlDataSource);
            //     czmlDataSourceRef.current = newCzmlDataSource; // 레퍼런스 업데이트
            // });

// const updateHeatmap = (vehicleData, currentTime, bounds) => {
            //     heatmapWorker.postMessage({
            //         vehicleData,
            //         width: 256,
            //         height: 256,
            //         bounds,
            //         currentTime
            //     });
            // };
        }
    }

    const setOpenlayersSimulation = () => {
        if (!map || !features || features.length === 0) return;
        olVehicleLayerSourceRef.current = olVehicleLayer.getSource();
        // 기존 feature 제거 (차량 수 변경에 따른 초기화)
        olVehicleLayerSourceRef.current.clear();

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