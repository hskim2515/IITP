import { useEffect, useRef } from "react";
import { Draw } from "ol/interaction";
import {LineString, Polygon} from "ol/geom";
import { getLength } from "ol/sphere";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import { Map as OlMap, View as OlView } from "ol";
import Overlay from "ol/Overlay";
import {getArea} from 'ol/sphere';
import {useMapStore} from "@stores/useMapStore";

export const useOlMeasure = (selectedTool: string | null, olMap: OlMap, olView: OlView) => {
    const drawRef = useRef<Draw | null>(null);
    const sketchRef = useRef<any>(null);
    const overlayRef = useRef<Overlay | null>(null);
    const vectorSource = useRef<VectorSource>(new VectorSource());
    const vectorLayer = useRef<VectorLayer>(new VectorLayer({ source: vectorSource.current }));
    const totalDistanceRef = useRef<number>(0);
    const totalAreaRef = useRef<number>(0);

    const { isOLSyncingState } = useMapStore();

    useEffect(() => {
        if (!isOLSyncingState){
            vectorSource.current.clear();
            drawRef.current?.abortDrawing();
            if (overlayRef.current) {
                olMap.removeOverlay(overlayRef.current);
                overlayRef.current = null;
            }
        }
    }, [isOLSyncingState]);

    useEffect(() => {
        if (!olMap || !selectedTool) return;

        if (drawRef.current) {
            olMap.removeInteraction(drawRef.current);
        }

        if (overlayRef.current) {
            olMap.removeOverlay(overlayRef.current);
            overlayRef.current = null;
        }

        if (vectorLayer.current) {
            olMap.removeLayer(vectorLayer.current);
        }

        vectorSource.current.clear();

        if (selectedTool === "distance") {
            drawRef.current = new Draw({
                source: vectorSource.current,
                type: "LineString",
            });

            drawRef.current.on("drawstart", (event: any) => {
                vectorSource.current.clear();

                if (overlayRef.current) {
                    olMap.removeOverlay(overlayRef.current);
                    overlayRef.current = null;
                }

                sketchRef.current = event.feature;
            });

            drawRef.current.on("drawend", (event: any) => {
                const lineString = event.feature.getGeometry() as LineString;
                const length = getLength(lineString);
                totalDistanceRef.current += length;

                const lastPoint = lineString.getLastCoordinate();

                if (!overlayRef.current) {
                    overlayRef.current = new Overlay({
                        element: document.createElement("div"),
                        offset: [0, 0],
                    });
                    olMap.addOverlay(overlayRef.current);
                }

                const overlayElement = overlayRef.current.getElement();
                if (overlayElement) {
                    overlayElement.innerHTML = `${totalDistanceRef.current.toFixed(2)} m`;

                    overlayElement.style.padding = "5px";
                    overlayElement.style.borderRadius = "4px";
                    overlayElement.style.color = "blue";
                    overlayElement.style.fontSize = "14px";
                    overlayElement.style.fontWeight = "bold";
                    overlayElement.style.textAlign = "center";
                    overlayElement.style.whiteSpace = "nowrap";
                    overlayElement.style.border = "2px solid blue";
                    overlayElement.style.backgroundColor = "rgba(255, 255, 255, 0.7)";
                    overlayElement.style.maxWidth = "200px";
                    overlayElement.style.wordWrap = "break-word";
                }

                overlayRef.current.setPosition(lastPoint);
            });

            olMap.addInteraction(drawRef.current);
            olMap.addLayer(vectorLayer.current);
        }else if (selectedTool === "area") {
            drawRef.current = new Draw({
                source: vectorSource.current,
                type: "Polygon",
            });

            drawRef.current.on("drawstart", (event: any) => {
                vectorSource.current.clear();

                if (overlayRef.current) {
                    olMap.removeOverlay(overlayRef.current);
                    overlayRef.current = null;
                }

                sketchRef.current = event.feature;
            });

            drawRef.current.on("drawend", (event: any) => {
                const polygon = event.feature.getGeometry();

                if (polygon instanceof Polygon) {
                    const area = getArea(polygon);
                    totalAreaRef.current = area;

                    const interiorPoint = polygon.getInteriorPoint();

                    const lastPoint = interiorPoint.getCoordinates();

                    if (!overlayRef.current) {
                        overlayRef.current = new Overlay({
                            element: document.createElement("div"),
                            offset: [0, 0],
                        });
                        olMap.addOverlay(overlayRef.current);
                    }

                    const overlayElement = overlayRef.current.getElement();
                    if (overlayElement) {
                        overlayElement.textContent = `${totalAreaRef.current.toFixed(2)} m²`;

                        overlayElement.style.padding = "5px";
                        overlayElement.style.borderRadius = "4px";
                        overlayElement.style.color = "blue";
                        overlayElement.style.fontSize = "14px";
                        overlayElement.style.fontWeight = "bold";
                        overlayElement.style.textAlign = "center";
                        overlayElement.style.whiteSpace = "nowrap";
                        overlayElement.style.backgroundColor = "rgba(255, 255, 255, 0.7)";
                        overlayElement.style.border = "2px solid blue";
                        overlayElement.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
                    }

                    overlayRef.current.setPosition(lastPoint);
                } else {
                    console.error("The geometry is not a valid Polygon object:", polygon);
                }
            });

            olMap.addInteraction(drawRef.current);
            olMap.addLayer(vectorLayer.current);
        }

        return () => {
            if (drawRef.current) {
                olMap.removeInteraction(drawRef.current);
            }
            if (overlayRef.current) {
                olMap.removeOverlay(overlayRef.current);
            }
            if (vectorLayer.current) {
                olMap.removeLayer(vectorLayer.current);
            }
        };
    }, [selectedTool, olMap]);

};
