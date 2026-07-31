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
import {defaultEventHandlers, clearMapHoverArtifacts} from "@handler/defaultEventHandler";
import {FEATURE_TYPE} from "@type/Signal";
import {getNetworkGuid} from "@utils/signal";
import {useLayerStore} from "@stores/useLayerStore";
import { setNetworkSelectionHighlight, clearNetworkSelectionHighlight } from "@datasource/NetworkDataSourceLayer";
import { networkPrimitivePropertiesMap } from "@utils/networkPrimitiveShared";
import {
    parseTileGuid,
    flyToNetworkFeatureByGuid,
    highlightNetworkFeature2DByGuid,
    clearNetworkHighlight2D,
} from "@utils/networkFeatureLocator";

// 선택된 Cesium 엔티티 정적 강조의 원복 함수 저장소(guid → 원본 복원).
// 깜빡임/자동 만료 없이 다음 선택·선택해제 전까지 강조를 유지하고, 해제 시 원본 스타일로 되돌린다.
const cesiumHighlightReverts = new Map<string, () => void>();
const SELECTION_HIGHLIGHT_COLOR = Cesium.Color.YELLOW;

const useDefaultSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const cesiumEventManager = useEventStore.getState().cesiumEventManager;
    const olEventManager = useEventStore.getState().olEventManager;

    const activeSubmenu = useMenuStore((state) => state.activeSubmenu)

    const layerManager = useLayerStore((state) => state.layerManager);

    const selectedGuid = useSelectionStore((state) => state.selectedGuid);

    const prevSelectedGuidsRef = useRef<Set<string>>(new Set());
    // 오프스크린 네트워크 링크: fly-to 후 primitive 로드가 끝나야 선택 슬롯 적용 가능 → 재시도 타이머
    const highlightRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // 커서가 지도 밖으로 나가면 hover 강조를 해제한다.
    //   hover 슬롯은 pointermove 로만 갱신되므로, 커서가 하단 편집 그리드 쪽으로 빠져나가면
    //   마지막 hover 가 지도에 그대로 남는다(해제 이벤트가 아예 오지 않음). 이 잔상이
    //   이후 그리드 선택 변경 때 이전 링크에 주황 계열 하이라이트로 드러난다.
    useEffect(() => {
        const olViewport = olMap?.getViewport?.() ?? null;
        const cesiumCanvas = viewer?.canvas ?? null;
        if (!olViewport && !cesiumCanvas) return;
        const onLeave = () => clearMapHoverArtifacts();
        olViewport?.addEventListener('pointerleave', onLeave);
        cesiumCanvas?.addEventListener('pointerleave', onLeave);
        return () => {
            olViewport?.removeEventListener('pointerleave', onLeave);
            cesiumCanvas?.removeEventListener('pointerleave', onLeave);
        };
    }, [olMap, viewer]);

    useEffect(() => {
            if (!activeSubmenu) return;
            if (!propertyFormSchema[activeSubmenu.menuCode]) return;
            const layerName = propertyFormSchema[activeSubmenu.menuCode].layer

            if (!layerName || !viewer || !olMap) return

            // 'grid'(그리드/에디터 **단일** 행 선택)만 카메라 이동 동반 — 지도 클릭('map')과
            //   다중 체크('grid-bulk')는 하이라이트만 하고 카메라를 고정한다. 다중 선택에서
            //   guid 마다 fly-to 를 돌리면 화면이 대상 사이를 계속 튀어다니며 버벅인다.
            // 속성모달 "편집" 진입(suppressFlyToOnce)은 대상이 이미 화면에 보이므로 fly 억제
            //   (리렌더 중 2초 flyToBoundingSphere 버벅임 방지). 소비 즉시 플래그 해제.
            //   'grid-bulk' 는 어차피 fly 하지 않으므로 이 1회용 플래그를 소모하지 않는다.
            const nextSet = new Set<string>(selectedGuid ?? []);
            const prevSet = prevSelectedGuidsRef.current;

            const selectionSource = useSelectionStore.getState().selectionSource;
            // 선택이 2개 이상이면 소스가 'grid' 여도 이동하지 않는다 — 아래 nextSet 루프가 guid
            //   마다 fly/zoom 을 호출하므로 카메라가 대상 사이를 연쇄로 튀어다닌다. GridTable 외의
            //   경로(예: PropertyPanel 이 pendingGridGuid 를 여러 개 복원할 때)도 같은 정책을 탄다.
            let fromGrid = selectionSource === 'grid' && nextSet.size <= 1;
            if (fromGrid && useSelectionStore.getState().suppressFlyToOnce) {
                useSelectionStore.getState().setSuppressFlyToOnce(false);
                fromGrid = false;
            }

            // 선택이 바뀌는 순간, 지도가 남겨둔 hover 잔상을 먼저 지운다.
            //   hover 는 pointermove 로만 갱신되므로 커서가 지도 밖(그리드)으로 나가면 마지막
            //   hover 강조가 그대로 남는다 — 선택이 다른 객체로 옮겨가면 이전 링크를 덮고 있던
            //   노란 선택 오버레이가 빠지면서 그 아래 주황 계열 hover 오버레이가 드러난다.
            //   지도 클릭 경로에서도 안전하다: 이 이펙트는 handleXxxSelect 가 선택 강조를 적용한
            //   뒤에 실행되고, 여기서 지우는 것은 hover 슬롯뿐이라 선택 강조는 유지된다.
            const selectionChanged =
                prevSet.size !== nextSet.size || [...nextSet].some((g) => !prevSet.has(g));
            if (selectionChanged) clearMapHoverArtifacts();

            for (const guid of prevSet) {
                if (!nextSet.has(guid)) {
                    clearCesiumStyleByGuid(guid); // 3D 엔티티(노드/시설물) 정적 강조 원복
                    if (layerName === 'network' && parseTileGuid(guid)) {
                        clearNetworkSelection();
                    } else {
                        clearOlStyleByGuid(olMap, layerName, guid);
                    }
                }
            }

            for (const guid of nextSet) {
                if (!prevSet.has(guid)) {
                    if (layerName === 'network' && parseTileGuid(guid)) {
                        // 타일 모드 네트워크: 3D 선택 슬롯 + 2D 오버레이 (fly-to 는 grid 선택만)
                        applyNetworkSelection(viewer, olMap, guid, fromGrid);
                    } else if (FEATURE_TYPE.SIGNAL === layerName) {
                        const mappedGuid = getNetworkGuid(layerManager,guid);
                        if (mappedGuid) {
                            const networkLayerName  ='network'
                            highlightOlStyleByGuid(olMap, networkLayerName, mappedGuid);
                            highlightCesiumStyleByGuid(viewer, networkLayerName, mappedGuid, { zoom: fromGrid });
                        }
                    } else {
                        highlightOlStyleByGuid(olMap, layerName, guid);
                        highlightCesiumStyleByGuid(viewer, layerName, guid, { zoom: fromGrid });
                    }
                }
            }

            prevSelectedGuidsRef.current = nextSet;


            return () => {
                for (const guid of prevSelectedGuidsRef.current) {
                    clearCesiumStyleByGuid(guid); // 3D 엔티티(노드/시설물) 정적 강조 원복
                    if (layerName === 'network' && parseTileGuid(guid)) {
                        clearNetworkSelection();
                    } else {
                        clearOlStyleByGuid(olMap, layerName, guid);
                    }
                }
                prevSelectedGuidsRef.current.clear();
            };
        }, [selectedGuid, activeSubmenu]
    );

    /** 로드된 링크 primitive 면 3D 선택 슬롯 적용 (성공 여부 반환) */
    function highlightNetworkLinkByGuid(guid: string): boolean {
        const parsed = parseTileGuid(guid);
        if (!parsed || parsed.featureType !== 'links') return false;
        if (!setNetworkSelectionHighlight || !networkPrimitivePropertiesMap.has(parsed.parentGuid)) return false;
        setNetworkSelectionHighlight(parsed.parentGuid, parsed.laneIdx);
        return true;
    }

    function cancelHighlightRetry() {
        if (highlightRetryRef.current) {
            clearInterval(highlightRetryRef.current);
            highlightRetryRef.current = null;
        }
    }

    /** fly-to 이후 타일 primitive 로드 완료 시점에 선택 슬롯을 적용 (500ms × 10회) */
    function scheduleHighlightRetry(guid: string) {
        cancelHighlightRetry();
        let attempts = 0;
        highlightRetryRef.current = setInterval(() => {
            attempts += 1;
            if (highlightNetworkLinkByGuid(guid) || attempts >= 10) cancelHighlightRetry();
        }, 500);
    }

    /** 타일 모드 네트워크 선택: 3D 선택 슬롯(+오프스크린 재시도) + 2D 오버레이.
     *  flyTo=true(그리드 행 선택)일 때만 두 지도 카메라를 이동한다 — 지도 단순 클릭은
     *  카메라 고정 (의도치 않은 줌인/시점 재설정 방지). */
    function applyNetworkSelection(viewer: Viewer, olMap: OLMap, guid: string, flyTo: boolean) {
        const applied = highlightNetworkLinkByGuid(guid);
        if (!applied) {
            // 노드/포트 등 엔티티는 정적 강조(줌은 flyTo 경로가 담당) — 다음 선택/해제 전까지 유지
            highlightCesiumStyleByGuid(viewer, 'network', guid, { zoom: false });
        }
        if (flyTo) {
            // 두 지도 이동 + 2D 선택 오버레이 (좌표는 캐시 우선, 오프스크린은 /feature 조회)
            flyToNetworkFeatureByGuid(guid, viewer, olMap);
            if (!applied && parseTileGuid(guid)?.featureType === 'links') {
                scheduleHighlightRetry(guid);
            }
        } else {
            // 카메라 고정 — 2D 선택 오버레이만 표시
            highlightNetworkFeature2DByGuid(guid, olMap);
        }
    }

    function clearNetworkSelection() {
        cancelHighlightRetry();
        clearNetworkSelectionHighlight?.();
        clearNetworkHighlight2D();
    }

    // 정적(비-깜빡임) 강조를 적용하고, 원복 함수를 저장해 선택해제 시 되돌린다.
    // 자동 만료 setTimeout 을 두지 않아 다음 선택/선택해제 전까지 강조가 유지된다.
    function highlightCesiumStyleByGuid(viewer: Viewer, layerName: string, guid: string, options?: { zoom?: boolean }): boolean {
        let found = false;
        viewer?.dataSources?.getByName(layerName)[0]?.entities.values.forEach(entity => {
            if (entity.id !== guid) return;
            found = true;

            // 이미 강조 중이면 원본을 다시 캡처하지 않는다(재선택 시 원본이 노란색으로 덮이는 것 방지).
            if (!cesiumHighlightReverts.has(guid)) {
                const highlightMaterial = new Cesium.ColorMaterialProperty(SELECTION_HIGHLIGHT_COLOR);
                if (entity.polyline) {
                    const orig = entity.polyline.material;
                    entity.polyline.material = highlightMaterial;
                    cesiumHighlightReverts.set(guid, () => { if (entity.polyline) entity.polyline.material = orig; });
                } else if (entity.corridor) {
                    const orig = entity.corridor.material;
                    entity.corridor.material = highlightMaterial;
                    cesiumHighlightReverts.set(guid, () => { if (entity.corridor) entity.corridor.material = orig; });
                } else if (entity.point) {
                    const orig = entity.point.color;
                    entity.point.color = new Cesium.ConstantProperty(SELECTION_HIGHLIGHT_COLOR);
                    cesiumHighlightReverts.set(guid, () => { if (entity.point) entity.point.color = orig; });
                } else if (entity.polygon) {
                    const orig = entity.polygon.material;
                    entity.polygon.material = highlightMaterial;
                    cesiumHighlightReverts.set(guid, () => { if (entity.polygon) entity.polygon.material = orig; });
                }
            }

            if (options?.zoom !== false) {
                zoomToEntity(entity, viewer)
            }
        })
        // requestRenderMode 대응 — 정적 머티리얼 변경은 명시 렌더 요청이 있어야 반영된다.
        if (found) { try { viewer.scene.requestRender(); } catch { /* noop */ } }
        return found;
    }

    /** 선택해제/선택변경 시 정적 강조를 원본 스타일로 되돌린다. */
    function clearCesiumStyleByGuid(guid: string): void {
        const revert = cesiumHighlightReverts.get(guid);
        if (!revert) return;
        try { revert(); } catch { /* noop */ }
        cesiumHighlightReverts.delete(guid);
        try { viewer?.scene.requestRender(); } catch { /* noop */ }
    }

    // 3D 하이라이트(YELLOW) 기준으로 2D 선택 색상 통일
    const SELECTION_COLOR = 'rgba(255,255,0,0.95)';
    const SELECTION_FILL = 'rgba(255,255,0,0.35)';

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
                        // 외곽선만 바뀌지 않도록 채움색도 함께 강조 (fill 이 없는 스타일이면 생성)
                        const fill = s.getFill();
                        if (fill) fill.setColor(SELECTION_FILL);
                        else s.setFill(new Fill({color: SELECTION_FILL}));
                    });
                    return arr;
                });
            } else {
                feature.setStyle(
                    new Style({
                        stroke: new Stroke({color: SELECTION_COLOR, width: 4}),
                        zIndex: 200,
                        fill: new Fill({color: SELECTION_FILL}),
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
