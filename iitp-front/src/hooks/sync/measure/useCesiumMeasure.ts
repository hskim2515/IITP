import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import {useMapStore} from "@stores/useMapStore";

export const useCesiumMeasure = (selectedTool: string | null, viewer:Cesium.Viewer) => {
    const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
    const activePointRef = useRef<Cesium.Entity | null>(null);
    const pointsRef = useRef<Cesium.Cartesian3[]>([]);
    const entitiesRef = useRef<Cesium.Entity[]>([]);
    const previewLineEntityRef = useRef<Cesium.Entity | null>(null);
    const totalAreaRef = useRef<number>(0);

    const handler = viewer.screenSpaceEventHandler;
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const { isCesiumSyncingState } = useMapStore();

    useEffect(() => {
        if (!isCesiumSyncingState){
            clearMeasurements();
        }else{
            if (selectedTool === "distance") {
                startDistanceMeasurement();
            } else if (selectedTool === "area") {
                startAreaMeasurement();
            }
        }

    }, [isCesiumSyncingState, selectedTool]);

    useEffect(() => {
        if (!viewer) return;

        if (!handlerRef.current) {
            handlerRef.current = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        }

        if (selectedTool === "distance") {
            clearMeasurements();
            startDistanceMeasurement();
        } else if (selectedTool === "area") {
            clearMeasurements();
            startAreaMeasurement();
        } else {
            //clearMeasurements();
        }

        return () => {
            clearMeasurements();
        };
    }, [selectedTool, viewer]);

    const startDistanceMeasurement = () => {
        if (!viewer || !handlerRef.current) return;

        let totalDistance = 0;
        let labelEntity: Cesium.Entity;

        addActivePoint();
        trackMousePoint();

        handlerRef.current.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.scene.pickPosition(click.position);
            if (!cartesian) return;

            pointsRef.current.push(cartesian);

            const pointEntity = viewer.entities.add({
                position: cartesian,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.NONE,
                },
            });
            entitiesRef.current.push(pointEntity);

            if (pointEntity) {
                viewer.entities.remove(pointEntity);
            }

            if (pointsRef.current.length >= 2) {
                const [pointA, pointB] = pointsRef.current.slice(-2);
                const distance = Cesium.Cartesian3.distance(pointA, pointB);
                totalDistance += distance;

                const lineEntity = viewer.entities.add({
                    polyline: {
                        positions: [pointA, pointB],
                        width: 3,
                        material: Cesium.Color.YELLOW,
                        clampToGround: true,
                    },
                });
                entitiesRef.current.push(lineEntity);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handlerRef.current.setInputAction(() => {
            const lastPoint = pointsRef.current[pointsRef.current.length - 1];
            createLabelEntity(labelEntity, lastPoint, totalDistance);
            endMeasurement();
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    };
    const createLabelEntity = (labelEntity:Cesium.Entity, cartesian:Cesium.Cartesian3, totalDistance:number) => {
        labelEntity = viewer.entities.add({
            position: cartesian,
            label: {
                text: `${totalDistance.toFixed(2)} m`,
                font: "16px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0, 0, 0, 0.6),
                pixelOffset: new Cesium.Cartesian2(0, -20),
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            },
        });
        entitiesRef.current.push(labelEntity);
    }

    const startAreaMeasurement = () => {
        if (!viewer || !handlerRef.current) return;

        let totalArea = 0;
        let labelEntity: Cesium.Entity;

        addActivePoint();
        trackMousePoint();

        let lineEntities: Cesium.Entity[] = [];

        handlerRef.current.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.scene.pickPosition(click.position);
            if (!cartesian) return;

            pointsRef.current.push(cartesian);

            const pointEntity = viewer.entities.add({
                position: cartesian,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.NONE,
                },
            });
            entitiesRef.current.push(pointEntity);

            if (pointEntity) {
                viewer.entities.remove(pointEntity);
            }

            if (pointsRef.current.length >= 2) {
                const [pointA, pointB] = pointsRef.current.slice(-2);
                const lineEntity = viewer.entities.add({
                    polyline: {
                        positions: [pointA, pointB],
                        width: 3,
                        material: Cesium.Color.YELLOW,
                        clampToGround: true,
                    },
                });
                lineEntities.push(lineEntity);
                entitiesRef.current.push(lineEntity);
            }

            if (pointsRef.current.length >= 3) {
                const existingPolygonEntity = entitiesRef.current.find(entity => entity.polygon);
                if (existingPolygonEntity) {
                    viewer.entities.remove(existingPolygonEntity);
                    entitiesRef.current = entitiesRef.current.filter(entity => entity !== existingPolygonEntity);
                }

                if (pointsRef.current.length >= 4) {
                    if (lineEntities.length > 0) {
                        viewer.entities.remove(lineEntities[lineEntities.length - 2]);
                    }
                }

                const polygonEntity = createPolygon(pointsRef.current);
                entitiesRef.current.push(polygonEntity);

                const firstPoint = pointsRef.current[0];
                const lastPoint = pointsRef.current[pointsRef.current.length - 1];
                const closingLineEntity = viewer.entities.add({
                    polyline: {
                        positions: [firstPoint, lastPoint],
                        width: 3,
                        material: Cesium.Color.YELLOW,
                        clampToGround: true,
                    },
                });
                lineEntities.push(closingLineEntity);
                entitiesRef.current.push(closingLineEntity);

                const area = calculateArea(pointsRef.current);
                totalArea = area;

                const existingLabelEntity = entitiesRef.current.find(entity => entity.label);
                if (existingLabelEntity) {
                    viewer.entities.remove(existingLabelEntity);
                    entitiesRef.current = entitiesRef.current.filter(entity => entity !== existingLabelEntity);
                }
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handlerRef.current.setInputAction(() => {
            const centroid = calculateCentroid(pointsRef.current);
            createLabelEntity(labelEntity, centroid, totalArea)
            endMeasurement();
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    };

    const addActivePoint = () => {
        activePointRef.current = viewer.entities.add({
            point: {
                pixelSize: 10,
                color: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.NONE,
            },
        });
    };

    const addPreviewLine = (cartesian: Cesium.Cartesian3) => {
        if (pointsRef.current.length > 0 && cartesian) {
            if (!previewLineEntityRef.current) {
                previewLineEntityRef.current = viewer.entities.add({
                    polyline: {
                        positions: new Cesium.CallbackProperty(() => {
                            return [pointsRef.current[pointsRef.current.length - 1], cartesian];
                        }, false),
                        width: 2,
                        material: Cesium.Color.YELLOW.withAlpha(0.5),
                        clampToGround: true,
                    },
                });
            } else {
                previewLineEntityRef.current.polyline.positions = new Cesium.CallbackProperty(() => {
                    return [pointsRef.current[pointsRef.current.length - 1], cartesian];
                }, false);
            }
        }
    };

    const trackMousePoint = () => {
        handlerRef.current.setInputAction((movement) => {
            const cartesian = viewer.scene.pickPosition(movement.endPosition);
            if (cartesian && activePointRef.current) {
                activePointRef.current.position = new Cesium.CallbackProperty(() => cartesian, false);
            }
            addPreviewLine(cartesian);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };

    const endMeasurement = () => {
        if (!viewer || !handlerRef.current) return;

        handlerRef.current.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        handlerRef.current.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);

        if (activePointRef.current) {
            viewer.entities.remove(activePointRef.current);
            activePointRef.current = null;
        }

        if (previewLineEntityRef.current) {
            viewer.entities.remove(previewLineEntityRef.current);
            previewLineEntityRef.current = null;
        }
    };

    const clearMeasurements = () => {
        if (!viewer || !handlerRef.current) return;

        handlerRef.current.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        handlerRef.current.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);

        entitiesRef.current.forEach((entity) => viewer.entities.remove(entity));
        entitiesRef.current = [];
        pointsRef.current = [];

        if (activePointRef.current) {
            viewer.entities.remove(activePointRef.current);
            activePointRef.current = null;
        }

        if (previewLineEntityRef.current) {
            viewer.entities.remove(previewLineEntityRef.current);
            previewLineEntityRef.current = null;
        }
        totalAreaRef.current = 0;
    };

    const calculateCentroid = (points: Cesium.Cartesian3[]) => {
        let x = 0, y = 0;
        points.forEach(point => {
            x += Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(point).longitude);
            y += Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(point).latitude);
        });
        const centerX = x / points.length;
        const centerY = y / points.length;
        return Cesium.Cartesian3.fromDegrees(centerX, centerY);
    };

    const calculateArea = (points: Cesium.Cartesian3[]): number => {
        let area = 0;
        const xyPoints = points.map((point) => {
            const cartographic = Cesium.Cartographic.fromCartesian(point);
            return {
                x: Cesium.Math.toDegrees(cartographic.longitude),
                y: Cesium.Math.toDegrees(cartographic.latitude),
            };
        });
        const n = xyPoints.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += xyPoints[i].x * xyPoints[j].y;
            area -= xyPoints[j].x * xyPoints[i].y;
        }
        area = Math.abs(area) / 2;
        const firstLat = Cesium.Math.toRadians(xyPoints[0].y);
        const scalingFactor = Math.cos(firstLat) * 111319.9;
        area = area * scalingFactor * scalingFactor;
        return area;
    };

    const createPolygon = (points: Cesium.Cartesian3[]) => {
        return viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(points),
                material: Cesium.Color.YELLOW.withAlpha(0.3),
                outline: true,
                outlineColor: Cesium.Color.YELLOW,
            },
        });
    };
};
