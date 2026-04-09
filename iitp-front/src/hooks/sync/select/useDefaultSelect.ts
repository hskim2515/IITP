import { useEffect, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { Map as OLMap, MapBrowserEvent } from 'ol';
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { getFeaturesByGuidPrefix } from "@utils/feature";
import { Fill, Stroke, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import { matchesCustomKeyValue } from "@utils/olLayer";
import { Entity, Viewer } from "cesium";
import {defaultEventHandlers} from "@handler/defaultEventHandler";
import {FEATURE_TYPE} from "@type/Signal";
import {getNetworkGuid} from "@utils/signal";
import {useLayerStore} from "@stores/useLayerStore";

const useDefaultSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const cesiumEventManager = useEventStore.getState().cesiumEventManager;
    const olEventManager = useEventStore.getState().olEventManager;

    const activeSubmenu = useMenuStore((state) => state.activeSubmenu)

    const layerManager = useLayerStore((state) => state.layerManager);

    const selectedGuid = useSelectionStore((state) => state.selectedGuid);

    const prevSelectedGuidsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!cesiumEventManager || !viewer) return
        cesiumEventManager.bind('select', defaultEventHandlers.handleCesiumSelect);
        return () => {
            cesiumEventManager.unbind('select', defaultEventHandlers.handleCesiumSelect);
        };
    }, [viewer, cesiumEventManager]);

    useEffect(() => {
        if (!olEventManager || !olMap) return
        olEventManager.bind('click', defaultEventHandlers.handleOLSelect);
        return () => {
            olEventManager.unbind('click', defaultEventHandlers.handleOLSelect);
        };
    }, [olEventManager, olMap]);

    useEffect(() => {
        console.log('selectedGuid', selectedGuid)
            if (!activeSubmenu) return;
            if (!propertyFormSchema[activeSubmenu.menuCode]) return;
            const layerName = propertyFormSchema[activeSubmenu.menuCode].layer

            if (!layerName || !viewer || !olMap) return

            const nextSet = new Set<string>(selectedGuid ?? []);
            const prevSet = prevSelectedGuidsRef.current;

            for (const guid of prevSet) {
                if (!nextSet.has(guid)) {
                    clearOlStyleByGuid(olMap, layerName, guid);
                    // clearCesiumStyleByGuid(viewer, layerName, guid);
                }
            }

            for (const guid of nextSet) {
                if (!prevSet.has(guid)) {
                    if (FEATURE_TYPE.SIGNAL === layerName) {
                        const mappedGuid = getNetworkGuid(layerManager,guid);
                        if (mappedGuid) {
                            const networkLayerName  ='network'
                            highlightOlStyleByGuid(olMap, networkLayerName, mappedGuid);
                            highlightCesiumStyleByGuid(viewer, networkLayerName, mappedGuid);
                        }
                    } else {
                        highlightOlStyleByGuid(olMap, layerName, guid);
                        highlightCesiumStyleByGuid(viewer, layerName, guid);
                    }
                }
            }

            prevSelectedGuidsRef.current = nextSet;


            return () => {
                for (const guid of prevSelectedGuidsRef.current) {
                    clearOlStyleByGuid(olMap, layerName, guid);
                    // clearCesiumStyleByGuid(viewer, layerName, guid);
                }
                prevSelectedGuidsRef.current.clear();
            };
        }, [selectedGuid, activeSubmenu]
    );

    function highlightCesiumStyleByGuid(viewer: Viewer, layerName: string, guid: string) {
        viewer?.dataSources?.getByName(layerName)[0]?.entities.values.forEach(entity => {
            if (entity.id === guid) {

                const blinkingColor = new Cesium.CallbackProperty((time) => {
                    // 현재 시간(ms 기준)
                    const currentTime = Date.now();

                    // 0.5초마다 색상 전환
                    const isYellow = Math.floor(currentTime / 500) % 2 === 0;

                    return isYellow
                        ? Cesium.Color.YELLOW.withAlpha(1.0)
                        : Cesium.Color.RED.withAlpha(1.0);
                }, false);

                const blinkingMaterial = new Cesium.ColorMaterialProperty(blinkingColor);

                let originalMaterial: Cesium.MaterialProperty | undefined = undefined;
                let originalColor: Cesium.Property | undefined = undefined;

                if (entity.polyline) {
                    originalMaterial = entity.polyline.material;
                    entity.polyline.material = blinkingMaterial;
                } else if (entity.corridor) {
                    originalMaterial = entity.corridor.material;
                    entity.corridor.material = blinkingMaterial;
                } else if (entity.point) {
                    originalColor = entity.point.color;
                    entity.point.color = blinkingColor;
                } else if (entity.polygon) {
                    originalMaterial = entity.polygon.material;
                    entity.polygon.material = blinkingColor;
                }

                setTimeout(() => {
                    if (entity.polyline && originalMaterial) {
                        entity.polyline.material = originalMaterial;
                    } else if (entity.corridor && originalMaterial) {
                        entity.corridor.material = originalMaterial;
                    } else if (entity.point && originalColor) {
                        entity.point.color = originalColor;
                    } else if (entity.polygon && originalMaterial) {
                        entity.polygon.material = originalMaterial;
                    }
                }, 5000);
                zoomToEntity(entity, viewer)
            }
        })
    }

    const SELECTION_COLOR = 'rgb(31,255,0)';

    function highlightOlStyleByGuid(olMap: OLMap, layerName: string, guid: string) {
        const olLayer = olMap.getLayers().getArray().find((layer) => {
            return matchesCustomKeyValue(layer, 'layer', layerName)
        }) as (VectorLayer<VectorSource> | WebGLVectorLayer | undefined);
        const features = getFeaturesByGuidPrefix(olLayer, guid);

        if (!features) return;

        const styleFn = (olLayer as VectorLayer<VectorSource>)?.getStyleFunction?.();

        features.getArray().forEach((feature) => {
            if (styleFn) {
                // 레이어 스타일 함수 기반으로 형광 초록 적용 (geometry override 포함)
                feature.setStyle((f, resolution) => {
                    const base = styleFn(f, resolution);
                    if (!base) return undefined;
                    const arr = Array.isArray(base) ? base : [base];
                    arr.forEach(s => {
                        const image = s.getImage();
                        if (image instanceof CircleStyle) {
                            image.getFill()?.setColor(SELECTION_COLOR);
                            image.getStroke()?.setColor('white');
                        }
                        s.getStroke()?.setColor(SELECTION_COLOR);
                        s.getFill()?.setColor(SELECTION_COLOR);
                    });
                    return arr;
                });
            } else {
                feature.setStyle(
                    new Style({
                        stroke: new Stroke({color: SELECTION_COLOR}),
                        zIndex: 200,
                        fill: new Fill({color: SELECTION_COLOR}),
                        image: new CircleStyle({
                            radius: 7,
                            fill: new Fill({color: SELECTION_COLOR}),
                            stroke: new Stroke({color: 'white', width: 3}),
                        }),
                    }),
                );
            }
        });
    }

    function clearOlStyleByGuid(olMap: OLMap, layerName: string, guid: string) {
        const olLayer = olMap.getLayers().getArray().find((layer) => {
            return matchesCustomKeyValue(layer, 'layer', layerName)
        }) as (VectorLayer<VectorSource> | WebGLVectorLayer | undefined);
        const features = getFeaturesByGuidPrefix(olLayer, guid);

        if (!features) return;
        features.getArray().forEach((feature) => {
            feature.setStyle(undefined)
        })
    }

    function zoomToEntity(entity: Entity, viewer: Viewer): void {
        if (entity.point && entity.position) {
            const entityPosition = entity.position.getValue(Cesium.JulianDate.now());
            if (!entityPosition) return
            viewer.camera.flyTo({
                destination: entityPosition,
                duration: 2.0,
            });
        } else if (entity.polyline && entity.polyline.positions) {
            const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
            const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
            viewer.camera.flyToBoundingSphere(boundingSphere, {
                duration: 2.0,
                offset: new Cesium.HeadingPitchRange(0, -0.7, boundingSphere.radius * 2.0),
            });
        } else if (entity.corridor && entity.corridor.positions) {
            const positions = entity.corridor.positions.getValue(Cesium.JulianDate.now());
            const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
            viewer.camera.flyToBoundingSphere(boundingSphere, {
                duration: 2.0,
                offset: new Cesium.HeadingPitchRange(0, -0.7, boundingSphere.radius * 2.0),
            });
        } else if (entity.ellipse && entity.position) {
            const position = entity.position.getValue(Cesium.JulianDate.now());
            const semiMajor = entity.ellipse.semiMajorAxis?.getValue(Cesium.JulianDate.now()) ?? 10;
            const semiMinor = entity.ellipse.semiMinorAxis?.getValue(Cesium.JulianDate.now()) ?? 10;

            const radius = Math.max(semiMajor, semiMinor);
            const boundingSphere = new Cesium.BoundingSphere(position, radius);
            viewer.camera.flyToBoundingSphere(boundingSphere, {
                duration: 2.0,
                offset: new Cesium.HeadingPitchRange(0, -0.7, radius * 2.0),
            });
        } else if (entity.cylinder && entity.position) {
            const position = entity.position.getValue(Cesium.JulianDate.now());
            const topRadius = entity.cylinder.topRadius?.getValue(Cesium.JulianDate.now()) ?? 1.0;
            const bottomRadius = entity.cylinder.bottomRadius?.getValue(Cesium.JulianDate.now()) ?? 1.0;
            const length = entity.cylinder.length?.getValue(Cesium.JulianDate.now()) ?? 10;

            // 반지름과 길이를 고려한 대략적인 반경 계산
            const radius = Math.sqrt(Math.max(topRadius, bottomRadius) ** 2 + (length / 2) ** 2);
            const boundingSphere = new Cesium.BoundingSphere(position, radius);
            viewer.camera.flyToBoundingSphere(boundingSphere, {
                duration: 2.0,
                offset: new Cesium.HeadingPitchRange(0, -0.7, radius * 2.0),
            });
        }

    };

}
export default useDefaultSelect;
