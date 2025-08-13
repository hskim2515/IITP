import { useEffect, useMemo, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { MapBrowserEvent } from "ol";
import Feature, { FeatureLike } from "ol/Feature";
import { Layer } from "ol/layer";
import { StyleFunction, StyleLike } from "ol/style/Style";
import { isVectorLayer, matchesCustomKeyValue } from "@utils/olLayer";
import CircleStyle from "ol/style/Circle";
import { Icon, Style } from "ol/style";
import { isFeature } from "@utils/feature";
import throttle from 'lodash/throttle';
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@component/form/propertyFormSchema";
import { useSelectionStore } from "@stores/useSelectionStore";

const useDefaultMoveMouse = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const olManager = useEventStore((state) => state.olEventManager);
    const cesiumManager = useEventStore((state) => state.cesiumEventManager);

    const activeSubmenu = useMenuStore((state) => state.activeSubmenu)

    const highlightedEntityRef = useRef<Cesium.Entity | null>(null);
    const originalSizeCesiumMap = useRef<WeakMap<Cesium.Entity, any>>(new WeakMap());

    const highlightedFeatureRef = useRef<Feature | FeatureLike | undefined>(undefined);
    const originalFeatureStyles = useRef<WeakMap<Feature, StyleLike | undefined>>(new WeakMap())

    const selectedGuid = useSelectionStore((state) => state.selectedGuid)

    const HIGHLIGHT_SCALE = 3;
    const THROTTLE_MS = 16

    const hoverLayerName = useMemo(() => {
        if (!activeSubmenu) {
            return undefined;
        }
        return propertyFormSchema[activeSubmenu.menuCode].layer;
    }, [activeSubmenu]);

    useEffect(() => {
        if (!olMap || !olManager) return;
        const throttledOlHover = throttle(handleOlHover, THROTTLE_MS);
        olManager.bind("pointermove", throttledOlHover);
        return () => {
            throttledOlHover.cancel()
            olManager.unbind("pointermove", throttledOlHover);
        };
    }, [olMap, olManager, hoverLayerName]);

    useEffect(() => {
        if (!viewer || !cesiumManager) return;
        const throttledCesiumHover = throttle(handleCesiumHover, THROTTLE_MS);
        cesiumManager.bind("move", throttledCesiumHover);
        return () => {
            cesiumManager.unbind("move", throttledCesiumHover);
            throttledCesiumHover.cancel()
        };
    }, [viewer, cesiumManager]);


    const handleOlHover = (e: MapBrowserEvent<UIEvent>) => {
        if (!olMap) return;

        const featureInfo = olMap.forEachFeatureAtPixel(
            e.pixel,
            (feature: FeatureLike, layer: Layer) => {
                const isTargetLayer = !hoverLayerName || (hoverLayerName && matchesCustomKeyValue(layer, 'layer', hoverLayerName));

                if (isTargetLayer
                    && isVectorLayer(layer)
                    && isFeature(feature)
                    && feature.get("__guid")
                ) {
                    if (selectedGuid.includes(feature.get("__guid"))) {
                        return undefined;
                    }
                    return {feature, layer};
                }
                return undefined;
            },
            {hitTolerance: 10}
        );

        if (!featureInfo) {
            if (highlightedFeatureRef.current) {
                clearOlHighlight(highlightedFeatureRef.current);
            }
            highlightedFeatureRef.current = undefined;
            return;
        }

        const {feature, layer} = featureInfo;
        const layerStyleFunction = layer.getStyleFunction();

        if (highlightedFeatureRef.current === feature) return;

        if (highlightedFeatureRef.current) {
            clearOlHighlight(highlightedFeatureRef.current);
        }

        if (feature && layerStyleFunction) {
            highlightFeature(feature, layerStyleFunction);
        } else {
            highlightedFeatureRef.current = undefined;
        }
    };

    const clearOlHighlight = (feature: FeatureLike | Feature | undefined) => {
        if (!feature || !isFeature(feature)) return;
        const originalStyle = originalFeatureStyles.current.get(feature)
        feature.setStyle(originalStyle ?? undefined)
        originalFeatureStyles.current.delete(feature)
        highlightedFeatureRef.current = undefined;
    }

    const highlightFeature = (feature: FeatureLike | Feature, styleFunction: StyleFunction) => {
        if (!isFeature(feature) || !olManager) return;
        const currentStyle = feature.getStyle();
        originalFeatureStyles.current.set(feature, currentStyle);

        feature.setStyle((feature, resolution) => {
            const baseStyle = styleFunction(feature, resolution) ?? undefined;
            return getHighlightedOlStyle(baseStyle, HIGHLIGHT_SCALE);
        });

        highlightedFeatureRef.current = feature;
    };

    const getHighlightedOlStyle = (baseStyle: Style | Style[] | null | undefined, scale: number) => {

        if (!baseStyle) return undefined;

        const styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];

        return styles.map((style) => {
            const image = style.getImage();
            const stroke = style.getStroke();

            if (image instanceof Icon) {
                const scaleValue = image.getScale();
                if (Array.isArray(scaleValue)) {
                    const [scaleX, scaleY] = scaleValue;
                    image.setScale([scaleX * scale, scaleY * scale]);
                } else {
                    image.setScale(scaleValue * scale);
                }

            } else if (image instanceof CircleStyle) {
                image.setRadius(image.getRadius() * scale);
            }


            if (stroke) {
                const currentWidth = stroke.getWidth() ?? 1;
                stroke.setWidth(currentWidth * scale);
            }
            return style;
        });
    };

    const handleCesiumHover = (e: any) => {
        if (!viewer) return;
        const scene = viewer.scene;
        const position = e.endPosition ?? e.position;
        if (!position) return;

        const cartesian = scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
        if (!cartesian) return;

        const pickedObject = scene.pick(position);
        const entity = pickedObject?.id as Cesium.Entity;
        if (!entity) {
            clearCesiumHighlight();
            return;
        }

        if (highlightedEntityRef.current !== entity) {

            highlightEntity(entity);

        }

    };

    const clearCesiumHighlight = () => {
        const entity = highlightedEntityRef.current;
        if (!entity) return;

        const original = originalSizeCesiumMap.current.get(entity);
        if (!original) return;

        if (entity.point && original.pixelSize !== undefined) {
            entity.point.pixelSize = new Cesium.ConstantProperty(original.pixelSize);
        }
        if (entity.model && original.scale !== undefined) {
            entity.model.scale = new Cesium.ConstantProperty(original.scale);
        }
        if (entity.polyline && original.width !== undefined) {
            entity.polyline.width = new Cesium.ConstantProperty(original.width);
        }
        if (entity.corridor && original.width !== undefined) {
            entity.corridor.width = new Cesium.ConstantProperty(original.width);
        }
        if (entity.polygon && original.extrudedHeight !== undefined) {
            entity.polygon.extrudedHeight = new Cesium.ConstantProperty(original.extrudedHeight);
        }
        if (entity.ellipse) {
            if (original.semiMajorAxis !== undefined) {
                entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(original.semiMajorAxis);
            }
            if (original.semiMinorAxis !== undefined) {
                entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(original.semiMinorAxis);
            }
        }
        if (entity.cylinder) {
            if (original.length !== undefined) {
                entity.cylinder.length = new Cesium.ConstantProperty(original.length);
            }
            if (original.topRadius !== undefined) {
                entity.cylinder.topRadius = new Cesium.ConstantProperty(original.topRadius);
            }
            if (original.bottomRadius !== undefined) {
                entity.cylinder.bottomRadius = new Cesium.ConstantProperty(original.bottomRadius);
            }
        }

        highlightedEntityRef.current = null;

    };

    const highlightEntity = (entity: Cesium.Entity) => {
        clearCesiumHighlight(); // reset any previous entity

        const now = Cesium.JulianDate.now();
        const original: any = {};

        if (entity.point) {
            original.pixelSize = entity.point.pixelSize?.getValue(now) ?? 10;
            entity.point.pixelSize = new Cesium.ConstantProperty(original.pixelSize * HIGHLIGHT_SCALE);
        }
        if (entity.model) {
            original.scale = entity.model.scale?.getValue(now) ?? 1.0;
            entity.model.scale = new Cesium.ConstantProperty(original.scale * HIGHLIGHT_SCALE);
        }
        if (entity.polyline) {
            original.width = entity.polyline.width?.getValue(now) ?? 3.0;
            entity.polyline.width = new Cesium.ConstantProperty(original.width * HIGHLIGHT_SCALE);
        }
        if (entity.corridor) {
            original.width = entity.corridor.width?.getValue(now) ?? 3.0;
            entity.corridor.width = new Cesium.ConstantProperty(original.width * HIGHLIGHT_SCALE * 0.5);
        }
        if (entity.polygon) {
            original.extrudedHeight = entity.polygon.extrudedHeight?.getValue(now) ?? 0;
            entity.polygon.extrudedHeight = new Cesium.ConstantProperty(original.extrudedHeight * HIGHLIGHT_SCALE);
        }
        if (entity.ellipse) {
            original.semiMajorAxis = entity.ellipse.semiMajorAxis?.getValue(now) ?? 1.0;
            original.semiMinorAxis = entity.ellipse.semiMinorAxis?.getValue(now) ?? 1.0;
            entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(original.semiMajorAxis * HIGHLIGHT_SCALE * 0.5);
            entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(original.semiMinorAxis * HIGHLIGHT_SCALE * 0.5);
        }
        if (entity.cylinder) {
            original.length = entity.cylinder.length?.getValue(now) ?? 1.0;
            original.topRadius = entity.cylinder.topRadius?.getValue(now) ?? 0.5;
            original.bottomRadius = entity.cylinder.bottomRadius?.getValue(now) ?? 0.5;
            entity.cylinder.length = new Cesium.ConstantProperty(original.length * HIGHLIGHT_SCALE * 0.5);
            entity.cylinder.topRadius = new Cesium.ConstantProperty(original.topRadius * HIGHLIGHT_SCALE * 0.5);
            entity.cylinder.bottomRadius = new Cesium.ConstantProperty(original.bottomRadius * HIGHLIGHT_SCALE * 0.5);
        }


        originalSizeCesiumMap.current.set(entity, original);
        highlightedEntityRef.current = entity;
    };
};

export default useDefaultMoveMouse;