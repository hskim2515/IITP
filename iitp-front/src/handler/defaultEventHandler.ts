import * as Cesium from "cesium";
import {MapBrowserEvent} from "ol";
import {usePropertyStore} from "@stores/usePropertyStore";
import {useSelectionStore} from "@stores/useSelectionStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import Feature, {FeatureLike} from "ol/Feature";
import {Layer} from "ol/layer";
import {isVectorLayer, isWebGLVectorLayer, matchesCustomKeyValue} from "@utils/olLayer";
import {isFeature} from "@utils/feature";
import {StyleFunction} from "ol/style/Style";
import { RegularShape, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import {propertyFormSchema} from "@schema/propertyFormSchema";
import {useMenuStore} from "@stores/useMenuStore";
import {useNetworkDrawStore} from "@stores/useNetworkDrawStore";
import { networkPrimitivePropertiesMap, highlightNetworkPrimitive } from "@datasource/NetworkDataSourceLayer";
import { getSelectedOlStyle } from "@utils/selectionStyle";
import { getOlSelectionPriority, OlSelectionCandidate, sortOlSelectionCandidates } from "@utils/selectionPriority";


const setSelectedProps = usePropertyStore.getState().setSelectedProps;
const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;


let highlightedEntity: Cesium.Entity | null = null;
const originalSizeCesiumMap = new WeakMap();
let highlightedFeature: FeatureLike | undefined = undefined;
const originalFeatureStyles = new WeakMap();

// 선택(클릭/수정) 하이라이트 상태
let selectedFeature: Feature | undefined = undefined;
const originalSelectedStyles = new WeakMap<Feature, ReturnType<Feature['getStyle']>>();
let modifyingGuid: string | null = null;

const HIGHLIGHT_SCALE = 3;
const HOVER_STROKE_COLOR = 'rgba(255, 214, 102, 0.70)';
const HOVER_FILL_COLOR = 'rgba(255, 214, 102, 0.12)';

export const defaultEventHandlers ={


    handleCesiumSelect : (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        // 도로 그리기 / 커넥션 그리기 / 선택편집 모드 중에는 속성조회 이벤트 무시
        const drawStore = useNetworkDrawStore.getState();
        if (drawStore.isActive || drawStore.isConnectionActive || drawStore.isSelectActive) return;
        if (useMenuStore.getState().activeSubmenu) return;

        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;

        const picked = viewer.scene.pick(e.position);

        if (Cesium.defined(picked)) {
            const props: Record<string, any> = {};
            const cartesian = viewer.scene.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                props.longitude = Cesium.Math.toDegrees(cartographic.longitude);
                props.latitude = Cesium.Math.toDegrees(cartographic.latitude);
                props.height = cartographic.height;
            }

            if (picked.id instanceof Cesium.Entity && picked.id.properties) {
                // Entity 피킹 (노드, 포트, 커넥션, 버스정류장 등)
                const flat = picked.id.properties.getValue(Cesium.JulianDate.now()) ?? {};
                Object.assign(props, flat);
                setSelectedProps(props);
                setSelectedGuid([props.__guid]);
            } else if (typeof picked.id === 'string') {
                // Primitive/GroundPrimitive 피킹 (링크, 레인, 경계선)
                const resolvedId = resolveNetworkId(picked.id);
                const primitiveProps = resolvedId ? networkPrimitivePropertiesMap.get(resolvedId) : null;
                if (primitiveProps) {
                    Object.assign(props, primitiveProps);
                    setSelectedProps(props);
                    setSelectedGuid([primitiveProps.__guid]);
                } else {
                    setSelectedProps(null);
                }
            } else if (picked.id && typeof picked.id === 'object' && !(picked.id instanceof Cesium.Entity)) {
                // PointPrimitive / Billboard 등 — id에 plain object가 설정된 경우 (버스정류장 마커, 신호 램프 등)
                Object.assign(props, picked.id);
                if (props.__guid || props.featureType) {
                    setSelectedProps(props);
                    setSelectedGuid(props.__guid ? [props.__guid] : []);
                } else {
                    setSelectedProps(null);
                }
            } else {
                setSelectedProps(null);
            }
        } else {
            setSelectedProps(null);
        }
    },

    handleOLSelect : (e: MapBrowserEvent<UIEvent>) => {
        // 선택편집 모드 중에는 속성조회 이벤트 무시
        if (useNetworkDrawStore.getState().isSelectActive) return;
        const olMap = useOpenLayersStore.getState().map;

        if (!olMap) {
            setSelectedProps(null);
            setSelectedGuid([]);
            return;
        }

        // hover 하이라이트 먼저 제거
        if (highlightedFeature) {
            clearOlHighlight(highlightedFeature);
            highlightedFeature = undefined;
        }

        const selectedGuids = useSelectionStore.getState().selectedGuid;
        const featureCandidates: OlSelectionCandidate<Layer>[] = [];

        olMap.forEachFeatureAtPixel(e.pixel, function (feature, layer) {
            const guid = feature.get("__guid");
            if (guid) {
                featureCandidates.push({
                    feature,
                    layer,
                    priority: getOlSelectionPriority(feature, selectedGuids),
                });
            }
            return undefined;
        }, {
            // disableHitDetection: true 인 WebGLVectorLayer(TrailFeatureLayer 등)에서
            // forEachFeatureAtPixel 호출 시 throw 발생 → 해당 레이어 제외
            layerFilter: (layer) => !isWebGLVectorLayer(layer),
        });

        const selectedCandidate = sortOlSelectionCandidates(featureCandidates)[0];

        if (selectedCandidate) {
            const {feature, layer} = selectedCandidate;
            const guid = feature.get("__guid");
            setSelectedProps(feature.getProperties());
            setSelectedGuid([guid]);

            if (isFeature(feature)) {
                // 이전 선택 하이라이트 제거
                if (selectedFeature && selectedFeature !== feature) {
                    clearSelectionHighlight(selectedFeature);
                }
                // 새 선택 하이라이트 적용
                if (selectedFeature !== feature && isVectorLayer(layer)) {
                    const styleFn = layer.getStyleFunction();
                    if (styleFn) {
                        applySelectionHighlight(feature, styleFn);
                    }
                }
            }
            return;
        }

        if (!selectedCandidate) {
            setSelectedProps(null);
            setSelectedGuid([]);
            if (selectedFeature) {
                clearSelectionHighlight(selectedFeature);
            }
        }
    },

    handleCesiumHover : (e: any) => {
        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;
        const scene = viewer.scene;
        const position = e.endPosition ?? e.position;
        if (!position) return;

        const pickedObject = scene.pick(position);

        if (!pickedObject) {
            clearCesiumHighlight();
            highlightNetworkPrimitive?.(null);
            return;
        }

        if (pickedObject.id instanceof Cesium.Entity) {
            // Entity 호버 (노드, 포트, 커넥션 등)
            highlightNetworkPrimitive?.(null);
            if (highlightedEntity !== pickedObject.id) {
                highlightEntity(pickedObject.id);
            }
        } else if (typeof pickedObject.id === 'string') {
            // GroundPrimitive 호버 (링크, 레인, 경계선) — _divider suffix 정규화
            const resolvedId = resolveNetworkId(pickedObject.id);
            if (resolvedId) {
                clearCesiumHighlight();
                highlightNetworkPrimitive?.(resolvedId);
            } else {
                clearCesiumHighlight();
                highlightNetworkPrimitive?.(null);
            }
        } else {
            clearCesiumHighlight();
            highlightNetworkPrimitive?.(null);
        }
    },

    handleOlHover : (e: MapBrowserEvent<UIEvent>) => {
        const olMap = useOpenLayersStore.getState().map;
        const activeSubmenu = useMenuStore.getState().activeSubmenu

        const hoverLayerName = activeSubmenu ? propertyFormSchema[activeSubmenu?.menuCode].layer : undefined;

        if (!olMap) return;

        const selectedGuids = useSelectionStore.getState().selectedGuid;
        const featureCandidates: OlSelectionCandidate<Layer>[] = [];

        olMap.forEachFeatureAtPixel(
            e.pixel,
            (feature: FeatureLike, layer: Layer) => {
                const isTargetLayer = !hoverLayerName || (hoverLayerName && matchesCustomKeyValue(layer, 'layer', hoverLayerName));

                if (isTargetLayer
                    && isVectorLayer(layer)
                    && isFeature(feature)
                    && feature.get("__guid")
                ) {
                    const guid = feature.get("__guid");
                    // 현재 선택(하이라이트)된 피처 자체는 hover 제외
                    if (selectedFeature === feature) {
                        return undefined;
                    }
                    // 수정 중인 피처는 hover 제외
                    if (modifyingGuid && guid === modifyingGuid) {
                        return undefined;
                    }
                    featureCandidates.push({
                        feature,
                        layer,
                        priority: getOlSelectionPriority(feature, selectedGuids),
                    });
                }
                return undefined;
            },
            {
                hitTolerance: 10,
                layerFilter: (layer) => !isWebGLVectorLayer(layer),
            }
        );

        const featureInfo = sortOlSelectionCandidates(featureCandidates)[0];

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

const applySelectionHighlight = (feature: Feature, styleFunction: StyleFunction) => {
    if (originalSelectedStyles.has(feature)) return; // 이미 선택 하이라이트 적용됨
    const currentStyle = feature.getStyle();
    originalSelectedStyles.set(feature, currentStyle);
    feature.setStyle((f, resolution) => {
        const baseStyle = styleFunction(f, resolution) ?? undefined;
        return getSelectedOlStyle(baseStyle);
    });
    selectedFeature = feature;
};

const clearSelectionHighlight = (feature: Feature) => {
    if (!isFeature(feature)) return;
    const originalStyle = originalSelectedStyles.get(feature);
    feature.setStyle(originalStyle ?? undefined);
    originalSelectedStyles.delete(feature);
    if (selectedFeature === feature) {
        selectedFeature = undefined;
    }
};

/**
 * 수정 시작 시 호출: modifyingGuid 설정 + 해당 피처 선택 하이라이트
 */
export const setModifyingFeature = (guid: string, feature: Feature, styleFunction?: StyleFunction) => {
    modifyingGuid = guid;
    if (selectedFeature && selectedFeature !== feature) {
        clearSelectionHighlight(selectedFeature);
    }
    if (selectedFeature !== feature && styleFunction) {
        applySelectionHighlight(feature, styleFunction);
    }
};

/**
 * 수정 종료 시 호출: modifyingGuid 해제 (선택 하이라이트는 유지)
 */
export const clearModifyingFeature = () => {
    modifyingGuid = null;
};

/**
 * load() 로 source가 재구성된 후, 새 Feature 객체에 선택 하이라이트를 재적용
 * modifyend 이후 processAndStoreStation → load() 완료 후 호출
 */
/**
 * load() 로 source가 재구성된 후, 새 Feature 객체에 선택 하이라이트를 재적용.
 * 새 Feature 객체를 반환하므로 호출부에서 modifyFeatures 컬렉션 갱신에 활용 가능.
 */
export const reapplySelectionHighlight = (guid: string, layer: any): Feature | undefined => {
    const source = (layer as any)?.getSource?.();
    const features = source?.getFeatures?.() as Feature[] | undefined;
    const newFeature = features?.find((f: Feature) => f.get('__guid') === guid);
    if (!newFeature) return undefined;

    // 이전 참조 정리 (detached Feature이므로 스타일 복원 불필요)
    if (selectedFeature) {
        originalSelectedStyles.delete(selectedFeature);
        selectedFeature = undefined;
    }

    const styleFn = (layer as any)?.getStyleFunction?.() as StyleFunction | undefined;
    if (styleFn) {
        applySelectionHighlight(newFeature, styleFn);
    }
    // selectedGuid 등록 → handleOlHover가 이 피처를 hover 대상에서 제외
    setSelectedProps(newFeature.getProperties());
    setSelectedGuid([guid]);

    return newFeature;
};

const highlightFeature = (feature: FeatureLike | Feature, styleFunction: StyleFunction) => {
    if (!isFeature(feature)) return;
    const currentStyle = feature.getStyle();
    originalFeatureStyles.set(feature, currentStyle);

    feature.setStyle((feature, resolution) => {
        const baseStyle = styleFunction(feature, resolution) ?? undefined;
        return getHighlightedOlStyle(baseStyle, HIGHLIGHT_SCALE);
    });

    highlightedFeature = feature;
};

/**
 * GroundPrimitive pick id 정규화.
 * - 경계선 id: "{guid}_divider" → 부모 lane guid 반환
 * - networkPrimitivePropertiesMap에 있는 id → 그대로 반환
 * - 없으면 null
 */
const resolveNetworkId = (id: string): string | null => {
    if (networkPrimitivePropertiesMap.has(id)) return id;
    // _divider suffix 제거 후 재시도
    const withoutSuffix = id.replace(/_divider$/, '');
    if (networkPrimitivePropertiesMap.has(withoutSuffix)) return withoutSuffix;
    return null;
};

const getHighlightedOlStyle = (baseStyle: Style | Style[] | null | undefined, scale: number) => {

    if (!baseStyle) return undefined;

    const styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];

    return styles.map((style) => {
        const hoverStyle = style.clone();
        const image = hoverStyle.getImage();
        const stroke = hoverStyle.getStroke();
        const fill = hoverStyle.getFill();

        if (image instanceof CircleStyle || image instanceof RegularShape) {
            image.getFill()?.setColor(HOVER_FILL_COLOR);
            image.getStroke()?.setColor(HOVER_STROKE_COLOR);
            image.getStroke()?.setWidth(2.5);
        }

        if (stroke) {
            stroke.setColor(HOVER_STROKE_COLOR);
            stroke.setWidth(Math.max((stroke.getWidth() ?? 1) + 1, 3));
        }

        if (fill) {
            fill.setColor(HOVER_FILL_COLOR);
        }

        hoverStyle.setZIndex(250);
        return hoverStyle;
    });
};
