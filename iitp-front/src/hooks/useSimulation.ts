import {useEffect, useRef, useState} from "react";
import {LineString, Point} from "ol/geom";
import * as olProj from "ol/proj";
import {Feature} from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useEffect } from 'react';
import {useVehicleStore} from "@stores/useVehicleStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import * as Cesium from "cesium";
import VehicleDensityPrimitive from "@primitives/VehicleDensityPrimitive";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useSimulationStore} from "@stores/useSimulationStore";

const useSimulation = () => {
    const { isRunning, isStop, speed } = useSimulationStore();

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const setCzml = useVehicleStore((state) => state.setCzml);
    const setVehicleData = useVehicleStore((state) => state.setVehicleData);
    const setVehicleRoute = useVehicleStore((state) => state.setVehicleRoute);

    const map = useOpenLayersStore((state) => state.map);
    const vehicleRoute = useVehicleStore((state) => state.vehicleRoute);
    const vehicleLayerRef = useRef(null);
    const vehicleSourceRef = useRef(null);

    const animationRef = useRef(null);
    const viewerClockMultiplier = useRef(null);
    const vehiclesRef = useRef([]);

    const viewer = useCesiumStore((state) => state.viewer);
    const czml = useVehicleStore((state) => state.czml);
    const vehicleData = useVehicleStore((state) => state.vehicleData);
    const czmlDataSourceRef = useRef(null);
    const vehicleDataRef = useRef(null);
    const worker = new Worker(new URL('/src/workers/changeModelWorker.ts', import.meta.url), { type: 'module'  });

    useEffect(() => {
        if (viewer) {
            if(viewerClockMultiplier.current == null)
                viewerClockMultiplier.current = viewer.clock.multiplier
            viewer.clock.multiplier = viewerClockMultiplier.current * speed;
            console.log(viewer.clock.multiplier)
            console.log(viewerClockMultiplier.current)

            if (isRunning) {
                viewer.clock.shouldAnimate = true;
                animationRef.current = requestAnimationFrame(animate);
            } else {
                viewer.clock.shouldAnimate = false;
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                }
            }

            if (isStop) {
                viewer.clock.currentTime = viewer.clock.startTime;
                resetToInitialPosition();
            }
        }
    }, [isRunning, isStop, speed]);


    useEffect(() => {

        //if (!viewer) return;

        fetch("http://localhost:8080/vehicle/generate-czml", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor }),
        })
            .then(response => response.json())
            .then(({ czml, newVehicleData, positions }) => {
                setCzml(czml);
                setVehicleData(newVehicleData);
                setVehicleRoute(positions);
            });

    }, [numVehicle, speedFactor, viewer]);

    useEffect(() => {

        setOpenlayersSimulation();
        setCesiumSimulation();

        return () => {
            map?.removeLayer(vehicleLayerRef.current)
            worker?.terminate()
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

    const setCesiumSimulation = () => {
        if (!viewer) return;
        viewer.clock.shouldAnimate = isRunning;

        if(czml && vehicleData){

            //viewer.scene.primitives.removeAll()
            const primitives = new Cesium.PrimitiveCollection();
            const timeBasedPositions = transformToTimeBasedPositions(vehicleRoute);

            const vehicleDensityPrimitive = new VehicleDensityPrimitive(timeBasedPositions, viewer.scene.context);
            //primitives.add(vehicleDensityPrimitive);

            vehicleRoute.forEach((position,i) => {
                //if(i == 0){
                // const flatArray = position.flatMap(({ x, y, z }) => [x, y, z]);

                // position = new Cesium.Cartesian3.fromDegreesArrayHeights(flatArray)
                // const vehicleFieldPrimitive = new VehicleFieldPrimitive(position, viewer.scene.context);
                // const vehicleRootPrimitive = new VehicleRootPrimitive(position, viewer.scene.context);
                // const vehicleRectanglePrimitive = new VehicleRectanglePrimitive(position, viewer.scene.context);
                // const vehicleDomePrimitive = new VehicleDomePrimitive(position, viewer.scene.context);
                // primitives.add(vehicleFieldPrimitive);
                // primitives.add(vehicleRootPrimitive);
                // primitives.add(vehicleRectanglePrimitive);
                // primitives.add(vehicleDomePrimitive);
                //}

            });

            // 모든 VehicleFieldPrimitive 객체를 viewer의 scene에 추가
            viewer.scene.primitives.add(primitives);

            //const czml = generateCzmlFromCoordinates(positions);
            vehicleDataRef.current = vehicleData
            if (czmlDataSourceRef.current) {
                viewer.dataSources.remove(czmlDataSourceRef.current, true); // true 옵션을 주면 완전히 제거됨
            }

            viewer.scene.preRender.addEventListener((scene, time) => {
                const cameraPositionWC = viewer.camera.positionWC;
                if(vehicleDataRef.current){
                    const currentTime = viewer.clock.currentTime;
                    const newVehicleData = vehicleDataRef.current
                    //worker.postMessage({ newVehicleData, cameraPositionWC });
                    // updateHeatmap(vehicleDataRef.current, currentTime, heatmapRectangleRef.current);
                }
            });
            worker.onmessage = (e) => {
                vehicleDataRef.current = e.data;
                e.data.forEach(data => {
                    // if(data.displayType === "model"){
                    //     console.log(data)
                    // }
                    if(data.changed){
                        //console.log(data)
                        const vehicleEntity = newCzmlDataSource.entities.getById(data.id);
                        //console.log(vehicleEntity)
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
                            //console.log(data)
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

            const newCzmlDataSource = new Cesium.CzmlDataSource();

            newCzmlDataSource.load(czml).then(() => {
                viewer.dataSources.add(newCzmlDataSource);
                czmlDataSourceRef.current = newCzmlDataSource; // 레퍼런스 업데이트
            });
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
        if (!vehicleRoute) return;
        if ( !map ) return;

        vehiclesRef.current = vehicleRoute.map((route, idx) => {

            route = route.map(item => [item.x, item.y]);
            const vehiclePoint = new Point(olProj.fromLonLat(route[0]));
            const coords = vehiclePoint.getCoordinates();
            const vehicleFeature = new Feature({
                geometry: vehiclePoint,
                rotation: 0,
                updateInterval: 18, // 18ms 업데이트 주기
                lastUpdateTime: performance.now(),
            });
            vehicleFeature.set("routeFeature", route);
            vehicleFeature.set("currentIndex", 0);
            vehicleFeature.set("progress", 0);
            vehicleFeature.setId(`vehicle-${idx}`);
            vehicleFeature.set("trail", [coords[0]]);

            return vehicleFeature;
        });

        const vehicleLayer = new VectorLayer({
            source: new VectorSource(),
            declutter: true, // ✅ 중복된 요소를 렌더링하지 않도록 설정
        });

        vehicleSourceRef.current = vehicleLayer.getSource()

        vehicleSourceRef.current.addFeatures(vehiclesRef.current);

        map.addLayer(vehicleLayer);

        // const animate = () => {
        //     const vehicleFeatures = vehicleSource.getFeatures();
        //     const now = performance.now();
        //
        //     vehicleFeatures.forEach((vehicle) => {
        //         const lastUpdate = vehicle.get("lastUpdateTime") || 0;
        //         const updateInterval = vehicle.get("updateInterval") || 100;
        //
        //         // 차량이 일정 주기마다만 업데이트되도록 설정
        //         if (now - lastUpdate >= updateInterval) {
        //             updateVehiclePosition(vehicle);
        //             vehicle.set("lastUpdateTime", now);
        //             // 차량 위치 업데이트 후 트레일 업데이트
        //             updateVehicleAndTrail(vehicle);
        //         }
        //         applyDetailedAnimation(vehicle);
        //     });
        //     animationRef.current = requestAnimationFrame(animate);
        // };
        // animationRef.current = requestAnimationFrame(animate);

        vehicleLayerRef.current = vehicleLayer;
    }

};


export default useSimulation;