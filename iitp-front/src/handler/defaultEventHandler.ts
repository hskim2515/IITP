import * as Cesium from "cesium";
import {MapBrowserEvent} from "ol";
import {usePropertyStore} from "@stores/usePropertyStore";
import {useSelectionStore} from "@stores/useSelectionStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import Feature, {FeatureLike} from "ol/Feature";
import {Layer} from "ol/layer";
import {isVectorLayer, matchesCustomKeyValue} from "@utils/olLayer";
import {isFeature} from "@utils/feature";
import {StyleFunction} from "ol/style/Style";
import { Icon, RegularShape, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import {useEventStore} from "@stores/useEventStore";
import {propertyFormSchema} from "@schema/propertyFormSchema";
import {useMenuStore} from "@stores/useMenuStore";


const selectedGuid = useSelectionStore.getState().selectedGuid;
const setSelectedProps = usePropertyStore.getState().setSelectedProps;
const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;


let highlightedEntity: Cesium.Entity | null = null;
const originalSizeCesiumMap = new WeakMap();
let highlightedFeature: FeatureLike | undefined = undefined;
const originalFeatureStyles =new WeakMap()

const HIGHLIGHT_SCALE = 3;

export const defaultEventHandlers ={


    handleCesiumSelect : (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {

        const viewer = useCesiumStore.getState().viewer;

        if (!viewer) return

        const picked = viewer.scene.pick(e.position);

        if (Cesium.defined(picked) && picked.id?.properties) {
            const props: Record<string, any> = {};
            const cartesian = viewer.scene.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const longitude = Cesium.Math.toDegrees(cartographic.longitude);
                const latitude = Cesium.Math.toDegrees(cartographic.latitude);
                const height = cartographic.height;

                props.longitude = longitude;
                props.latitude = latitude;
                props.height = height; // 높이도 함께 포함
            }
            const propBag = picked.id.properties;
            const time = Cesium.JulianDate.now();
            const flat = propBag.getValue(time) ?? {};
            Object.assign(props, flat);

            // propBag.propertyNames.forEach((key: string) => {
            //     props[key] = propBag[key].getValue(Cesium.JulianDate.now());
            // });
            setSelectedProps(props);

            setSelectedGuid([props.__guid])

        } else {
            setSelectedProps(null);
        }
    },

    handleOLSelect : (e: MapBrowserEvent<UIEvent>) => {
        const olMap = useOpenLayersStore.getState().map;

        if (!olMap) {
            setSelectedProps(null);
            setSelectedGuid([]);
            return;
        }
        let isFeatureExist = false
        olMap.forEachFeatureAtPixel(e.pixel, function (feature) {
            const guid = feature.get("__guid");
            if (guid) {
                isFeatureExist = true;
                setSelectedProps(feature.getProperties())
                setSelectedGuid([feature.get("__guid")])
                return true
            }
        });
        if (!isFeatureExist) {
            setSelectedProps(null)
            setSelectedGuid([])
        }
    },

    handleCesiumHover : (e: any) => {
        const viewer = useCesiumStore.getState().viewer;

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

        if (highlightedEntity !== entity) {

            highlightEntity(entity);

        }

    },

    handleOlHover : (e: MapBrowserEvent<UIEvent>) => {
        const olMap = useOpenLayersStore.getState().map;
        const activeSubmenu = useMenuStore.getState().activeSubmenu

        const hoverLayerName = activeSubmenu ? propertyFormSchema[activeSubmenu?.menuCode].layer : undefined;

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
            if (highlightedFeature) {
                clearOlHighlight(highlightedFeature);
            }
            highlightedFeature = undefined;
            return;
        }

        const {feature, layer} = featureInfo;
        const layerStyleFunction = layer.getStyleFunction();

        if (highlightedFeature === feature) return;

        if (highlightedFeature) {
            clearOlHighlight(highlightedFeature);
        }

        if (feature && layerStyleFunction) {
            highlightFeature(feature, layerStyleFunction);
        } else {
            highlightedFeature = undefined;
        }
    },


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


    originalSizeCesiumMap.set(entity, original);
    highlightedEntity = entity;
};

const clearCesiumHighlight = () => {
    const entity = highlightedEntity;
    if (!entity) return;

    const original = originalSizeCesiumMap.get(entity);
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

    highlightedEntity = null;

};

const clearOlHighlight = (feature: FeatureLike | Feature | undefined) => {
    if (!feature || !isFeature(feature)) return;
    const originalStyle = originalFeatureStyles.get(feature)
    feature.setStyle(originalStyle ?? undefined)
    originalFeatureStyles.delete(feature)
    highlightedFeature = undefined;
}

const highlightFeature = (feature: FeatureLike | Feature, styleFunction: StyleFunction) => {
    const olManager = useEventStore.getState().olEventManager;

    if (!isFeature(feature) || !olManager) return;
    const currentStyle = feature.getStyle();
    originalFeatureStyles.set(feature, currentStyle);

    feature.setStyle((feature, resolution) => {
        const baseStyle = styleFunction(feature, resolution) ?? undefined;
        return getHighlightedOlStyle(baseStyle, HIGHLIGHT_SCALE);
    });

    highlightedFeature = feature;
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
        } else if (image instanceof RegularShape) {
            const s = (image as any).getScale?.() ?? 1;
            if (Array.isArray(s)) {
                image.setScale([s[0] * scale, s[1] * scale]);
            } else {
                image.setScale(s * scale);
            }
        }


        if (stroke) {
            const currentWidth = stroke.getWidth() ?? 1;
            stroke.setWidth(currentWidth * scale);
        }
        return style;
    });
};