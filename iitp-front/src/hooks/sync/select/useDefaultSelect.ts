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
    const cesiumHighlightStateRef = useRef<Map<string, {
        entity: Entity;
        originalMaterial?: Cesium.MaterialProperty;
        originalColor?: Cesium.Property;
    }>>(new Map());

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
            const menuCode = activeSubmenu.menuCode;
            if (!menuCode) return;
            const schema = propertyFormSchema[menuCode];
            if (!schema) return;
            const layerName = schema.layer

            if (!layerName || !viewer || !olMap) return

            const nextSet = new Set<string>((selectedGuid ?? []).map(String));
            const prevSet = prevSelectedGuidsRef.current;
            const isSignalLayer = FEATURE_TYPE.SIGNAL === layerName;
            const highlightLayerName = isSignalLayer ? 'network' : layerName;
            const resolveHighlightGuid = (guid: string) =>
                isSignalLayer ? (getNetworkGuid(layerManager, guid) ?? guid) : guid;

            for (const guid of prevSet) {
                if (!nextSet.has(guid)) {
                    const highlightGuid = resolveHighlightGuid(guid);
                    clearOlStyleByGuid(olMap, highlightLayerName, highlightGuid, isSignalLayer);
                    clearCesiumStyleByGuid(highlightLayerName, highlightGuid);
                }
            }

            const resolvedHighlightGuids = [...nextSet].map(resolveHighlightGuid);
            for (const highlightGuid of resolvedHighlightGuids) {
                highlightOlStyleByGuid(olMap, highlightLayerName, highlightGuid, isSignalLayer);
            }

            // 신호 편집기에서 교차로를 누르면 카메라 이동과 동시에 detail 타일/Entity가
            // 비동기로 만들어진다. 선택 순간에 Entity가 아직 없어도 collectionChanged 때
            // 같은 선택을 다시 적용해 3D 하이라이트가 빠지지 않게 한다.
            const applyCesiumSelection = () => {
                for (const highlightGuid of resolvedHighlightGuids) {
                    // 신호 메뉴의 flyTo는 SignalWorkspaceEditor가 노드 좌표 기준으로 한 번만 수행한다.
                    // 여기서 개별 커넥션마다 zoom 하면 마지막 대상이 카메라를 계속 빼앗는다.
                    highlightCesiumStyleByGuid(viewer, highlightLayerName, highlightGuid, !isSignalLayer);
                }
            };
            applyCesiumSelection();

            const highlightDataSource = viewer.dataSources.getByName(highlightLayerName)[0];
            const removeCollectionListener = highlightDataSource?.entities.collectionChanged.addEventListener(
                () => applyCesiumSelection(),
            );

            prevSelectedGuidsRef.current = nextSet;


            return () => {
                removeCollectionListener?.();
                for (const guid of prevSelectedGuidsRef.current) {
                    const highlightGuid = resolveHighlightGuid(guid);
                    clearOlStyleByGuid(olMap, highlightLayerName, highlightGuid, isSignalLayer);
                    clearCesiumStyleByGuid(highlightLayerName, highlightGuid);
                }
                prevSelectedGuidsRef.current.clear();
            };
        }, [selectedGuid, activeSubmenu, layerManager, olMap, viewer]
    );

    function highlightCesiumStyleByGuid(viewer: Viewer, layerName: string, guid: string, shouldZoom = true): boolean {
        const entity = viewer.dataSources.getByName(layerName)[0]?.entities.getById(guid);
        if (!entity) return false;

        const blinkingColor = new Cesium.CallbackProperty(() => {
            const currentTime = Date.now();
            const isYellow = Math.floor(currentTime / 500) % 2 === 0;
            return isYellow
                ? Cesium.Color.YELLOW.withAlpha(1.0)
                : Cesium.Color.RED.withAlpha(1.0);
        }, false);
        const blinkingMaterial = new Cesium.ColorMaterialProperty(blinkingColor);

        const stateKey = `${layerName}:${guid}`;
        const previousState = cesiumHighlightStateRef.current.get(stateKey);
        if (previousState?.entity === entity) {
            try { viewer.scene.requestRender(); } catch (_) {}
            return true;
        }
        // LOD 재빌드로 같은 GUID의 Entity가 교체됐으면 새 Entity의 원본 재질을 다시 보관한다.
        if (previousState) cesiumHighlightStateRef.current.delete(stateKey);

        let originalMaterial: Cesium.MaterialProperty | undefined;
        let originalColor: Cesium.Property | undefined;

        if (entity.polyline) {
            originalMaterial = entity.polyline.material;
            entity.polyline.material = blinkingMaterial;
        } else if (entity.corridor) {
            originalMaterial = entity.corridor.material;
            entity.corridor.material = blinkingMaterial;
        } else if (entity.point) {
            originalColor = entity.point.color;
            entity.point.color = blinkingColor;
        } else if (entity.cylinder) {
            originalMaterial = entity.cylinder.material;
            entity.cylinder.material = blinkingMaterial;
        } else if (entity.polygon) {
            originalMaterial = entity.polygon.material;
            entity.polygon.material = blinkingMaterial;
        } else {
            return false;
        }

        cesiumHighlightStateRef.current.set(stateKey, {
            entity,
            originalMaterial,
            originalColor,
        });
        // requestRenderMode에서는 카메라가 움직이지 않으면 재질 변경만으로 화면이
        // 다시 그려지지 않는다. 이동류 선택은 FlyTo를 하지 않으므로 직접 요청한다.
        try { viewer.scene.requestRender(); } catch (_) {}
        if (shouldZoom) zoomToEntity(entity, viewer);
        return true;
    }

    function clearCesiumStyleByGuid(layerName: string, guid: string) {
        const stateKey = `${layerName}:${guid}`;
        const state = cesiumHighlightStateRef.current.get(stateKey);
        if (!state) return;

        const { entity, originalMaterial, originalColor } = state;
        if (entity.polyline && originalMaterial) {
            entity.polyline.material = originalMaterial;
        } else if (entity.corridor && originalMaterial) {
            entity.corridor.material = originalMaterial;
        } else if (entity.point && originalColor) {
            entity.point.color = originalColor;
        } else if (entity.cylinder && originalMaterial) {
            entity.cylinder.material = originalMaterial;
        } else if (entity.polygon && originalMaterial) {
            entity.polygon.material = originalMaterial;
        }
        cesiumHighlightStateRef.current.delete(stateKey);
        const viewer = useCesiumStore.getState().viewer;
        try { viewer?.scene.requestRender(); } catch (_) {}
    }

    const SELECTION_COLOR = 'rgb(31,255,0)';

    function highlightOlStyleByGuid(olMap: OLMap, layerName: string, guid: string, exact = false) {
        const olLayer = olMap.getLayers().getArray().find((layer) => {
            return matchesCustomKeyValue(layer, 'layer', layerName)
        }) as (VectorLayer<VectorSource> | WebGLVectorLayer | undefined);
        const features = getFeaturesByGuidPrefix(olLayer, guid);

        if (!features) return;

        const styleFn = (olLayer as VectorLayer<VectorSource>)?.getStyleFunction?.();

        features.getArray()
            .filter(feature => !exact || feature.get('__guid') === guid)
            .forEach((feature) => {
            if (styleFn) {
                // 레이어 스타일 함수 기반으로 형광 초록 적용 (geometry override 포함)
                feature.setStyle((f, resolution) => {
                    const base = styleFn(f, resolution);
                    if (!base) return undefined;
                    // 레이어 공용 Style을 직접 바꾸면 다른 커넥션까지 같은 색으로 변한다.
                    const arr = (Array.isArray(base) ? base : [base]).map(style => style.clone());
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

    function clearOlStyleByGuid(olMap: OLMap, layerName: string, guid: string, exact = false) {
        const olLayer = olMap.getLayers().getArray().find((layer) => {
            return matchesCustomKeyValue(layer, 'layer', layerName)
        }) as (VectorLayer<VectorSource> | WebGLVectorLayer | undefined);
        const features = getFeaturesByGuidPrefix(olLayer, guid);

        if (!features) return;
        features.getArray()
            .filter(feature => !exact || feature.get('__guid') === guid)
            .forEach((feature) => {
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
