import * as Cesium from "cesium";
import {MapBrowserEvent, Map as OLMap} from "ol";
import {usePropertyStore} from "@stores/usePropertyStore";
import {useSelectionStore} from "@stores/useSelectionStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import Feature, {FeatureLike} from "ol/Feature";
import {Layer} from "ol/layer";
import {isVectorLayer, isWebGLVectorLayer, matchesCustomKeyValue} from "@utils/olLayer";
import {isFeature} from "@utils/feature";
import {StyleFunction} from "ol/style/Style";
import { Icon, RegularShape, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import {propertyFormSchema} from "@schema/propertyFormSchema";
import {useMenuStore} from "@stores/useMenuStore";
import {useNetworkDrawStore} from "@stores/useNetworkDrawStore";
import {
    highlightNetworkPrimitive,
    setNetworkSelectionHighlight,
    clearNetworkSelectionHighlight,
    pickNetworkAtPosition,
    pickLaneAtPosition,
} from "@datasource/NetworkDataSourceLayer";
import { networkPrimitivePropertiesMap } from "@utils/networkPrimitiveShared";
import {
    normalizeCoords,
    parseTileGuid,
    showNetworkHighlight2D,
    clearNetworkHighlight2D,
    showNetworkHoverHighlight2D,
    clearNetworkHoverHighlight2D,
    fetchNetworkFeatureProps,
} from "@utils/networkFeatureLocator";
import { useNetworkStore } from "@stores/useNetworkStore";
import { findNearestNode, findNearestLink, findNearestLane } from "@hooks/useNetworkSelect";
import { getNetworkLodTierByResolution } from "@utils/lodConstants";
import { fromLonLat } from "ol/proj";


const selectedGuid = useSelectionStore.getState().selectedGuid;
const setSelectedProps = usePropertyStore.getState().setSelectedProps;
const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;


let highlightedEntity: Cesium.Entity | null = null;
let highlightedFeature: FeatureLike | undefined = undefined;
const originalFeatureStyles = new WeakMap();

// 선택(클릭/수정) 하이라이트 상태
let selectedFeature: Feature | undefined = undefined;
const originalSelectedStyles = new WeakMap<Feature, ReturnType<Feature['getStyle']>>();
let modifyingGuid: string | null = null;

const HIGHLIGHT_SCALE = 3;

// requestRenderMode 대응 — 엔티티 크기(확대 하이라이트) 변경은 씬 무효화를 자동으로
// 유발하지 않아, 명시적으로 렌더를 요청하지 않으면 다음 렌더 계기(카메라 이동 등)까지
// 화면에 반영되지 않는다 (커서와 하이라이트가 어긋나 보이는 지연의 원인).
// 첫 프레임에 리소스 준비만 되고 드로우가 다음 프레임으로 밀리는 케이스(모델/빌보드)를
// 대비해 다음 rAF 에서 1프레임 더 요청한다.
const requestCesiumRender = (): void => {
    const viewer = useCesiumStore.getState().viewer;
    if (!viewer) return;
    try { viewer.scene.requestRender(); } catch (_) {}
    requestAnimationFrame(() => { try { viewer.scene.requestRender(); } catch (_) {} });
};

// ── 네트워크(타일 모드) 선택/호버 2D·3D 연동 헬퍼 ─────────────────────────
//   선택: 3D 선택 슬롯(setNetworkSelectionHighlight) + 2D 오버레이(showNetworkHighlight2D)를
//   항상 쌍으로 적용/해제해 어느 지도를 클릭해도 두 지도가 같은 강조 상태를 갖게 한다.
//   (2D 링크는 MVT 렌더 피처라 per-feature setStyle 불가 → 오버레이 방식)

/** props(또는 primitive 캐시)에서 경위도 좌표 배열 추출 */
const coordsFromNetworkProps = (props: Record<string, any> | null, guid: string | null): { lng: number; lat: number }[] => {
    const own = normalizeCoords(props?.coordinates);
    if (own.length > 0) return own;
    if (!guid) return [];
    const parsed = parseTileGuid(guid);
    const cached = networkPrimitivePropertiesMap.get(parsed?.parentGuid ?? guid);
    return normalizeCoords(cached?.coordinates);
};

/** 작업셋 __guid 가 path 형(links.links-0…)이어도 하이라이트 키는 항상 타일 guid(T_L/T_N)로 정규화 */
const normalizeNetworkTileSelectionGuid = (props: Record<string, any> | null): string | null => {
    const guid = props?.__guid;
    if (typeof guid === "string" && /^T_[LN]\d/.test(guid)) {
        const parsed = parseTileGuid(guid);
        return parsed?.parentGuid ?? guid;
    }
    if (props?.featureType === "nodes" && props?.id != null) return `T_N${props.id}`;
    if (props?.featureType === "links" && props?.id != null) return `T_L${props.id}`;
    if (props?.featureType === "lanes" && props?.linkRef != null) return `T_L${props.linkRef}`;
    return null;
};

/** 링크/레인 선택 강조를 두 지도에 동시 적용 (3D 선택 슬롯 + 2D 오버레이) */
const applyMapSelectionHighlight = (guid: string | null, laneIdx: number | undefined, props: Record<string, any> | null): void => {
    if (!guid) { clearMapSelectionHighlight(); return; }
    setNetworkSelectionHighlight?.(guid, laneIdx);
    const olMap = useOpenLayersStore.getState().map;
    if (olMap) {
        const coords = coordsFromNetworkProps(props, guid);
        if (coords.length > 0) showNetworkHighlight2D(olMap, coords);
        else clearNetworkHighlight2D();
    }
};

/** 네트워크 선택 강조를 두 지도에서 동시 해제 */
const clearMapSelectionHighlight = (): void => {
    clearNetworkSelectionHighlight?.();
    clearNetworkHighlight2D();
};

/** 2D 네트워크 호버 오버레이의 현재 대상 키 — mousemove 마다 호출되므로
 *  같은 대상이면 좌표 계산·지오메트리 재생성·OL 리렌더를 전부 생략한다
 *  (매 이동마다 재빌드하면 3D 호버 중에도 OL 맵 전체 렌더가 돌아 지연 발생). */
let networkHover2DKey: string | null = null;

const updateNetworkHover2D = (guid: string | null, laneIdx: number | undefined, props: Record<string, any> | null): void => {
    const key = guid == null ? null : (laneIdx != null ? `${guid}#${laneIdx}` : guid);
    if (key === networkHover2DKey) return; // 같은 대상 — no-op
    networkHover2DKey = key;
    if (!guid) { clearNetworkHoverHighlight2D(); return; }
    const olMap = useOpenLayersStore.getState().map;
    if (!olMap) { clearNetworkHoverHighlight2D(); return; }
    const coords = coordsFromNetworkProps(props, guid);
    if (coords.length > 0) showNetworkHoverHighlight2D(olMap, coords);
    else clearNetworkHoverHighlight2D();
};

/** guid 로 OL 벡터 피처 탐색 (시설물 레이어 — 호버/선택 확대 미러용) */
const findOlFeatureByGuid = (guid: string): { feature: Feature; layer: any } | null => {
    const olMap = useOpenLayersStore.getState().map;
    if (!olMap) return null;
    for (const layer of olMap.getAllLayers()) {
        if (!isVectorLayer(layer) || !layer.getVisible()) continue;
        const source = layer.getSource();
        const feature = source?.getFeatures?.()?.find((f: Feature) => f.get("__guid") === guid);
        if (feature) return { feature, layer };
    }
    return null;
};

/** guid 로 Cesium 엔티티 탐색 (전 DataSource — 호버/선택 확대 미러용) */
const findCesiumEntityByGuid = (guid: string): Cesium.Entity | null => {
    const viewer = useCesiumStore.getState().viewer;
    if (!viewer) return null;
    for (let i = 0; i < viewer.dataSources.length; i++) {
        const ds = viewer.dataSources.get(i);
        if (!ds.show) continue;
        const entity = ds.entities.getById(guid);
        if (entity) return entity;
    }
    return null;
};

type Network2DHit = {
    props: Record<string, any>;
    laneIdx?: number;
    /** MVT 렌더 피처 히트 (최소 props — 단건 조회로 보강 필요) */
    fromMvt?: boolean;
    linkId?: string;
};

/**
 * 2D 픽셀 위치의 네트워크 객체 픽.
 * 1) 작업셋(currentJsonData) 최근접 탐색 — 클릭/줌 규칙은 useNetworkSelect 와 동일
 * 2) 작업셋 미스 → MVT 렌더 피처 픽 (뷰포트 동기화 전 링크도 픽 가능,
 *    detail tier 레인 폴리곤은 getId() = linkId*100+laneIdx 로 디코드)
 */
const pickNetwork2DAt = (olMap: OLMap, pixel: number[]): Network2DHit | null => {
    const network: any = useNetworkStore.getState().currentJsonData;
    const coord = olMap.getCoordinateFromPixel(pixel as [number, number]);
    const res = olMap.getView().getResolution() ?? 1;
    const isDetail = getNetworkLodTierByResolution(res) === "detail";

    if (network && coord) {
        // 노드는 마커 직접 클릭(res*8)만 즉시 선택 — 절대 우선(res*20)이면 교차로 부근
        // 레인/링크 클릭이 전부 노드로 가로채임
        const nodeCand = findNearestNode(network.nodes ?? [], coord, res * 20);
        let nodeDist = Infinity;
        if (nodeCand) {
            const p = fromLonLat([nodeCand.coordinates.lng, nodeCand.coordinates.lat]);
            nodeDist = Math.hypot(p[0]! - coord[0]!, p[1]! - coord[1]!);
        }
        const directNode = nodeCand && nodeDist <= res * 8 ? nodeCand : null;
        const lane = !directNode && isDetail ? findNearestLane(network.links ?? [], coord, res * 8) : null;
        const link = (!directNode && !lane) ? findNearestLink(network.links ?? [], coord, res * 15) : null;
        const node = directNode ?? ((!lane && !link) ? nodeCand : null);
        if (node) return { props: { ...node, featureType: "nodes" } };
        if (lane) {
            const l0 = (network.links ?? []).find((l: any) => String(l.id) === lane.linkId);
            const laneObj = l0?.lanes?.[lane.laneIdx];
            if (laneObj) {
                return {
                    props: { ...laneObj, featureType: "lanes", linkRef: lane.linkId, laneRef: lane.laneIdx },
                    laneIdx: lane.laneIdx,
                    linkId: String(lane.linkId),
                };
            }
        }
        if (link) return { props: { ...link, featureType: "links" }, linkId: String(link.id) };
    }

    let mvtHit: Network2DHit | null = null;
    olMap.forEachFeatureAtPixel(pixel as [number, number], (feature: any) => {
        const rawId = feature?.getId?.();
        const idNum = Number(rawId);
        if (!Number.isFinite(idNum)) return undefined;
        const linkId = isDetail ? Math.floor(idNum / 100) : idNum;
        const laneIdx = isDetail ? idNum % 100 : undefined;
        const guid = laneIdx != null ? `T_L${linkId}_lane${laneIdx}` : `T_L${linkId}`;
        mvtHit = {
            props: laneIdx != null
                ? { __guid: guid, featureType: "lanes", linkRef: String(linkId), laneRef: laneIdx }
                : { __guid: guid, featureType: "links", id: String(linkId) },
            laneIdx,
            fromMvt: true,
            linkId: String(linkId),
        };
        return true;
    }, {
        hitTolerance: 6,
        layerFilter: (layer) => matchesCustomKeyValue(layer, "layer", "network-mvt"),
    });
    return mvtHit;
};

export const defaultEventHandlers ={


    handleCesiumSelect : (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        // 도로 그리기 / 커넥션 그리기 / 선택편집 / 시설물 배치 모드 중에는 속성조회 이벤트 무시
        const drawStore = useNetworkDrawStore.getState();
        if (drawStore.isActive || drawStore.isConnectionActive || drawStore.isSelectActive || drawStore.placementMode !== 'none') return;
        if (useMenuStore.getState().activeSubmenu) return;

        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;

        // 클릭 = 호버 상태 리셋 — 양쪽 지도의 호버 미러(확대/오버레이)를 먼저 정리해
        // 이전 호버 객체가 확대된 채 남는 생명주기 꼬임을 방지한다.
        clearCesiumHighlight();
        if (highlightedFeature) clearOlHighlight(highlightedFeature);
        updateNetworkHover2D(null, undefined, null);

        // Cesium 이벤트 객체/Cartesian2 재사용 대비 — 클릭 좌표도 로컬 복사본으로 통일
        const clickPos = new Cesium.Cartesian2(e.position.x, e.position.y);

        // 줌 중 LOD tier 전환으로 GroundPrimitive 가 비동기 재생성되는 순간과 겹치면
        // Cesium 내부 픽 오브젝트 매핑이 일시적으로 비어 scene.pick() 자체가 예외를 던질 수 있다
        // (앱 코드가 아니라 Cesium 내부 — 다음 프레임엔 정상화되므로 이번 클릭만 무시하면 된다).
        let picked: any;
        try {
            picked = viewer.scene.pick(clickPos);
        } catch (_) {
            return;
        }

        const props: Record<string, any> = {};
        const cartesian = viewer.scene.camera.pickEllipsoid(clickPos, viewer.scene.globe.ellipsoid);
        if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            props.longitude = Cesium.Math.toDegrees(cartographic.longitude);
            props.latitude = Cesium.Math.toDegrees(cartographic.latitude);
            props.height = cartographic.height;
        }

        if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity && picked.id.properties) {
            // Entity 피킹 (노드, 포트, 커넥션, 버스정류장 등)
            // 밀집 구역: 확대된 이웃이 가리면 커서에 중심이 가장 가까운 엔티티로 보정
            const entity = pickBestEntityAt(viewer.scene, clickPos, picked.id);
            const flat = entity.properties?.getValue(Cesium.JulianDate.now()) ?? {};
            Object.assign(props, flat);
            setSelectedProps(props);
            setSelectedGuid([props.__guid]);
            selectEntity(entity);                 // 3D 엔티티 선택 하이라이트
            highlightNetworkPrimitive?.(null);    // 링크 하이라이트 해제
            clearNetworkSelectionHighlight?.();   // 이전 링크 선택 강조 해제 (3D 슬롯)
            // 2D 미러: 같은 guid 의 OL 피처 확대 + 좌표가 있으면 선택 오버레이 표시
            mirrorSelectToOl(props.__guid);
            const olMapForEntity = useOpenLayersStore.getState().map;
            const entityCoords = normalizeCoords(flat?.coordinates);
            if (olMapForEntity && entityCoords.length > 0) showNetworkHighlight2D(olMapForEntity, entityCoords);
            else clearNetworkHighlight2D();
        } else if (Cesium.defined(picked) && picked.id && typeof picked.id === 'object' && !(picked.id instanceof Cesium.Entity)) {
            // PointPrimitive / Billboard 등 — id에 plain object가 설정된 경우 (버스정류장 마커, 신호 램프 등)
            Object.assign(props, picked.id);
            if (props.__guid || props.featureType) {
                setSelectedProps(props);
                setSelectedGuid(props.__guid ? [props.__guid] : []);
                mirrorSelectToOl(props.__guid);   // 2D 미러: 같은 guid 의 OL 피처 확대
            } else {
                setSelectedProps(null);
            }
            clearSelectedEntity();                // 프리미티브는 엔티티 하이라이트 대상 아님
            highlightNetworkPrimitive?.(null);
            clearMapSelectionHighlight();
        } else {
            // 링크/레인: 분류볼륨 scene.pick 은 "보이는 것과 선택되는 것"이 어긋난다
            // → 커서 지면점에서 렌더 규칙과 동일한 기하 탐색 (보이는 도로 = 선택되는 도로)
            const hit = pickNetworkAtPosition(viewer.scene, clickPos);
            let primitiveProps = hit?.props ?? null;
            const linkGuidForHighlight: string | null = primitiveProps?.__guid ?? null; // 하이라이트용 링크 guid
            let laneIdxForHighlight: number | undefined = undefined;
            // 도로 몸체 클릭 → 클릭 지점의 레인으로 해석
            // (레인 채움면이 렌더에 없어 직접 pick 불가 → 측방향 오프셋 역산으로 레인 클릭 지원)
            if (primitiveProps?.featureType === 'links') {
                const lane = pickLaneAtPosition(viewer.scene, clickPos, primitiveProps);
                if (lane?.__guid) {
                    laneIdxForHighlight = lane._laneIdx; // 그 레인만 하이라이트
                    primitiveProps = { ...lane, featureType: 'lanes', linkRef: primitiveProps.id, laneRef: lane._laneIdx };
                }
            }
            clearSelectedEntity(); // 링크/레인 선택 시 엔티티 하이라이트 해제
            if (selectedFeature) clearSelectionHighlight(selectedFeature); // 2D 확대 미러 해제
            if (primitiveProps) {
                Object.assign(props, primitiveProps);
                setSelectedProps(props);
                setSelectedGuid([primitiveProps.__guid]);
                // 선택 슬롯(hover 와 별개, 자동 만료) + 2D 오버레이 동시 적용
                applyMapSelectionHighlight(linkGuidForHighlight, laneIdxForHighlight, primitiveProps);
            } else {
                setSelectedProps(null);
                highlightNetworkPrimitive?.(null);
                clearMapSelectionHighlight();
            }
        }
    },

    handleOLSelect : (e: MapBrowserEvent<UIEvent>) => {
        // 선택편집 / 시설물 배치 모드 중에는 속성조회 이벤트 무시
        const drawState = useNetworkDrawStore.getState();
        if (drawState.isSelectActive || drawState.placementMode !== 'none') return;
        if (useMenuStore.getState().activeSubmenu) return;
        const olMap = useOpenLayersStore.getState().map;

        if (!olMap) {
            setSelectedProps(null);
            setSelectedGuid([]);
            return;
        }

        // 클릭 = 호버 상태 리셋 — 2D 호버뿐 아니라 3D 미러(엔티티 확대·프리미티브·오버레이)까지
        // 함께 정리한다. 여기서 안 지우면 "빈 화면 클릭 시 이전 호버 객체가 3D 에서
        // 확대된 채 나타나는" 생명주기 문제가 생긴다 (확대는 이미 적용돼 있었지만
        // requestRender 계기가 없어 클릭 시점의 렌더에서야 드러나는 형태).
        if (highlightedFeature) {
            clearOlHighlight(highlightedFeature);
            highlightedFeature = undefined;
        }
        clearCesiumHighlight();
        updateNetworkHover2D(null, undefined, null);
        highlightNetworkPrimitive?.(null);

        let isFeatureExist = false;
        olMap.forEachFeatureAtPixel(e.pixel, function (feature, layer) {
            const guid = feature.get("__guid");
            if (guid) {
                isFeatureExist = true;
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
                // 3D 미러: 같은 guid 의 Cesium 엔티티 확대, 이전 네트워크 선택 강조 해제
                clearMapSelectionHighlight();
                mirrorSelectToCesium(guid);
                return true;
            }
        }, {
            // disableHitDetection: true 인 WebGLVectorLayer(TrailFeatureLayer 등)에서
            // forEachFeatureAtPixel 호출 시 throw 발생 → 해당 레이어 제외
            layerFilter: (layer) => !isWebGLVectorLayer(layer) && !layer.get("excludeFromHit"),
        });
        if (!isFeatureExist) {
            // OL 벡터 피처 히트 실패 → MVT 로 렌더되는 링크/레인은 __guid 피처가 없어 여기로 온다.
            //   작업셋 최근접 → MVT 렌더 피처 순으로 픽 (pickNetwork2DAt)
            const hit = pickNetwork2DAt(olMap, e.pixel);
            if (hit) {
                setSelectedProps(hit.props);
                setSelectedGuid(hit.props.__guid ? [hit.props.__guid] : []);
                if (hit.props.featureType === 'nodes') {
                    // 노드: 3D 는 엔티티 확대 미러, 2D 는 선택 오버레이 점 표시
                    clearMapSelectionHighlight();
                    mirrorSelectToCesium(hit.props.__guid);
                    const nodeCoords = normalizeCoords(hit.props.coordinates);
                    if (nodeCoords.length > 0) showNetworkHighlight2D(olMap, nodeCoords);
                } else {
                    // 링크/레인: 3D 선택 슬롯 + 2D 오버레이 동시 적용
                    clearSelectedEntity();
                    applyMapSelectionHighlight(normalizeNetworkTileSelectionGuid(hit.props), hit.laneIdx, hit.props);
                }
                // MVT 최소 props 는 단건 조회로 속성 보강 (같은 객체가 계속 선택돼 있을 때만 반영)
                if (hit.fromMvt && hit.linkId != null) {
                    const wantGuid = hit.props.__guid;
                    fetchNetworkFeatureProps('links', hit.linkId).then((full) => {
                        if (!full) return;
                        if (usePropertyStore.getState().selectedProps?.__guid !== wantGuid) return;
                        if (hit.props.featureType === 'lanes' && hit.laneIdx != null) {
                            const laneObj = (full as any).lanes?.[hit.laneIdx];
                            if (laneObj) setSelectedProps({ ...laneObj, ...hit.props });
                        } else {
                            setSelectedProps({ ...full, ...hit.props });
                        }
                    });
                }
            } else {
                setSelectedProps(null);
                setSelectedGuid([]);
                clearMapSelectionHighlight();
                clearSelectedEntity(); // 3D 확대 미러 해제
            }
            if (selectedFeature) {
                clearSelectionHighlight(selectedFeature);
            }
        }
    },

    handleCesiumHover : (e: any) => {
        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;
        const scene = viewer.scene;
        // Cesium 이벤트 객체/Cartesian2 는 재사용·변이되므로 항상 로컬 복사본으로 처리
        // (이후의 scene.pick / pickBestEntityAt / pickNetworkAtPosition 이 전부 같은 좌표를 봄)
        const raw = e?.endPosition ?? e?.position;
        if (!raw || !isFinite(raw.x) || !isFinite(raw.y)) return;
        const position = new Cesium.Cartesian2(raw.x, raw.y);

        // 줌 중 LOD tier 전환으로 GroundPrimitive 가 비동기 재생성되는 순간과 겹치면
        // Cesium 내부 픽 오브젝트 매핑이 일시적으로 비어 scene.pick() 자체가 예외를 던질 수 있다
        // (16ms throttle 로 계속 재시도되므로 이번 프레임만 건너뛰면 충분).
        // 픽 윈도우 확장: 기본 3x3 은 얇은 폴리라인(커넥션)이 픽에서 아예 빠진다.
        let pickedObject: any;
        try {
            pickedObject = scene.pick(position, ENTITY_PICK_WINDOW_PX, ENTITY_PICK_WINDOW_PX);
        } catch (_) {
            return;
        }

        if (pickedObject?.id instanceof Cesium.Entity) {
            // Entity 호버 (노드, 포트, 커넥션 등)
            // 밀집 구역: 확대된 이웃이 가리면 커서에 중심이 가장 가까운 엔티티로 보정
            const entity = pickBestEntityAt(scene, position, pickedObject.id);
            highlightNetworkPrimitive?.(null);
            updateNetworkHover2D(null, undefined, null);
            if (highlightedEntity !== entity && selectedEntity !== entity) {
                highlightEntity(entity);
                // 2D 미러: 같은 guid 의 OL 피처도 확대 (hover 크기 연동)
                mirrorHoverToOl(entity.id);
            }
            return;
        }

        // 링크: 분류볼륨 scene.pick 은 "보이는 것과 하이라이트되는 것"이 어긋난다
        // → 커서 지면점에서 렌더 규칙과 동일한 기하 탐색 (보이는 도로 = 하이라이트되는 도로)
        clearCesiumHighlight();
        if (highlightedFeature) clearOlHighlight(highlightedFeature); // 2D 확대 미러 해제
        const hit = pickNetworkAtPosition(scene, position);
        highlightNetworkPrimitive?.(hit?.guid ?? null); // 동일 대상이면 내부에서 no-op
        // 2D 호버 미러 — 대상이 바뀔 때만 오버레이 재생성 (updateNetworkHover2D 키 가드)
        updateNetworkHover2D(hit?.guid ?? null, undefined, hit?.props ?? null);
    },

    handleOlHover : (e: MapBrowserEvent<UIEvent>) => {
        const olMap = useOpenLayersStore.getState().map;
        const activeSubmenu = useMenuStore.getState().activeSubmenu

        const hoverLayerName = activeSubmenu?.menuCode ? propertyFormSchema[activeSubmenu.menuCode]?.layer : undefined;

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
                    const guid = feature.get("__guid");
                    // 현재 선택(하이라이트)된 피처 자체는 hover 제외
                    if (selectedFeature === feature) {
                        return undefined;
                    }
                    // 수정 중인 피처는 hover 제외
                    if (modifyingGuid && guid === modifyingGuid) {
                        return undefined;
                    }
                    return {feature, layer};
                }
                return undefined;
            },
            {
                hitTolerance: 10,
                layerFilter: (layer) => !isWebGLVectorLayer(layer) && !layer.get("excludeFromHit"),
            }
        );

        if (!featureInfo) {
            if (highlightedFeature) {
                clearOlHighlight(highlightedFeature);
            }
            highlightedFeature = undefined;
            clearCesiumHighlight(); // 3D 확대 미러 해제
            // 네트워크(작업셋/MVT) 호버 — 2D 호버 오버레이 + 3D 프리미티브 미러
            const hoverHit = pickNetwork2DAt(olMap, e.pixel);
            if (hoverHit) {
                const hoverGuid = normalizeNetworkTileSelectionGuid(hoverHit.props);
                updateNetworkHover2D(hoverGuid, hoverHit.laneIdx, hoverHit.props);
                // 3D 미러: 화면에 로드된 링크만 (노드는 프리미티브 슬롯 대상 아님)
                const parsed = hoverGuid ? parseTileGuid(hoverGuid) : null;
                if (parsed?.featureType === 'links' && networkPrimitivePropertiesMap.has(parsed.parentGuid)) {
                    highlightNetworkPrimitive?.(parsed.parentGuid, hoverHit.laneIdx);
                } else {
                    highlightNetworkPrimitive?.(null);
                }
            } else {
                updateNetworkHover2D(null, undefined, null);
                highlightNetworkPrimitive?.(null);
            }
            return;
        }

        const {feature, layer} = featureInfo;
        const layerStyleFunction = layer.getStyleFunction();

        // 네트워크 호버 잔상 해제 (벡터 피처 위로 이동한 경우)
        updateNetworkHover2D(null, undefined, null);
        highlightNetworkPrimitive?.(null);

        if (highlightedFeature === feature) return;

        if (highlightedFeature) {
            clearOlHighlight(highlightedFeature);
        }

        if (feature && layerStyleFunction) {
            highlightFeature(feature, layerStyleFunction);
            // 3D 미러: 같은 guid 의 Cesium 엔티티도 확대 (hover 크기 연동)
            mirrorHoverToCesium(feature.get("__guid"));
        } else {
            highlightedFeature = undefined;
        }
    },


};

// ── 엔티티 스케일 상태 관리 (base 기준 절대 적용) ─────────────────────────
//   "현재값 저장 → 배율 → 복원" 상대 방식은 hover/select 가 겹치는 순간 이미 확대된
//   값이 원본으로 캡처되어 3x→9x→27x 로 기하급수 확대되는 버그를 만든다 (복원이 한 번
//   스킵되면 잘못된 크기가 영구화). 엔티티당 진짜 원본(base)을 최초 접근 시 1회만
//   캡처하고, 모든 상태 전환을 base×factor 절대값으로 적용해 중첩·순서 문제를 없앤다.
const entityBaseScaleMap = new WeakMap<Cesium.Entity, Record<string, number>>();

const captureEntityBase = (entity: Cesium.Entity): Record<string, number> => {
    const cached = entityBaseScaleMap.get(entity);
    if (cached) return cached;
    const now = Cesium.JulianDate.now();
    const base: Record<string, number> = {};
    if (entity.point) base.pixelSize = entity.point.pixelSize?.getValue(now) ?? 10;
    if (entity.model) base.scale = entity.model.scale?.getValue(now) ?? 1.0;
    if (entity.polyline) base.width = entity.polyline.width?.getValue(now) ?? 3.0;
    if (entity.billboard) base.bbScale = entity.billboard.scale?.getValue(now) ?? 1.0;
    if (entity.corridor) base.corridorWidth = entity.corridor.width?.getValue(now) ?? 3.0;
    if (entity.ellipse) {
        base.semiMajorAxis = entity.ellipse.semiMajorAxis?.getValue(now) ?? 1.0;
        base.semiMinorAxis = entity.ellipse.semiMinorAxis?.getValue(now) ?? 1.0;
    }
    if (entity.cylinder) {
        base.length = entity.cylinder.length?.getValue(now) ?? 1.0;
        base.topRadius = entity.cylinder.topRadius?.getValue(now) ?? 0.5;
        base.bottomRadius = entity.cylinder.bottomRadius?.getValue(now) ?? 0.5;
    }
    entityBaseScaleMap.set(entity, base);
    return base;
};

/** clampToGround 폴리라인 엔티티(커넥션 등) 여부 — width 변이 대신 오버레이로 강조해야 하는 대상 */
const isClampedPolylineEntity = (entity: Cesium.Entity): boolean => {
    if (!entity.polyline) return false;
    const now = Cesium.JulianDate.now();
    if (!entity.polyline.clampToGround?.getValue(now)) return false;
    const positions = entity.polyline.positions?.getValue(now);
    return Array.isArray(positions) && positions.length >= 2;
};

/** base×factor 절대 적용 — factor 1 이면 원복. 면형(corridor/ellipse/cylinder)은 절반 배율.
 *  ⚠️ clampToGround 폴리라인의 width 는 변이하지 않는다 — StaticGroundPolylinePerMaterialBatch
 *  지오메트리 재빌드(비동기)를 유발해 requestRenderMode 에서 "다음 이벤트의 렌더에서야
 *  이전 상태가 드러나는" 정확히 한 단계 지연을 만든다. 해당 엔티티는 오버레이로 강조. */
const setEntityScaleFactor = (entity: Cesium.Entity, factor: number): void => {
    const base = captureEntityBase(entity);
    const half = factor === 1 ? 1 : factor * 0.5;
    if (entity.point && base.pixelSize !== undefined)
        entity.point.pixelSize = new Cesium.ConstantProperty(base.pixelSize * factor);
    if (entity.model && base.scale !== undefined)
        entity.model.scale = new Cesium.ConstantProperty(base.scale * factor);
    if (entity.polyline && base.width !== undefined && !isClampedPolylineEntity(entity))
        entity.polyline.width = new Cesium.ConstantProperty(base.width * factor);
    if (entity.billboard && base.bbScale !== undefined)
        entity.billboard.scale = new Cesium.ConstantProperty(base.bbScale * factor);
    if (entity.corridor && base.corridorWidth !== undefined)
        entity.corridor.width = new Cesium.ConstantProperty(base.corridorWidth * half);
    // polygon 은 변이하지 않음 — 노면표시 폴리곤은 extrudedHeight 가 없어(base 0) 시각 효과가
    // 없었고, 지오메트리/재질 변이는 비동기 재빌드 지연을 유발 → 오버레이 경로에서 처리
    if (entity.ellipse) {
        if (base.semiMajorAxis !== undefined)
            entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(base.semiMajorAxis * half);
        if (base.semiMinorAxis !== undefined)
            entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(base.semiMinorAxis * half);
    }
    if (entity.cylinder) {
        if (base.length !== undefined)
            entity.cylinder.length = new Cesium.ConstantProperty(base.length * half);
        if (base.topRadius !== undefined)
            entity.cylinder.topRadius = new Cesium.ConstantProperty(base.topRadius * half);
        if (base.bottomRadius !== undefined)
            entity.cylinder.bottomRadius = new Cesium.ConstantProperty(base.bottomRadius * half);
    }
    requestCesiumRender();
};

// ── 오버레이형 엔티티 hover/select 강조 (clampToGround 폴리라인 + 폴리곤) ────
//   width/extrudedHeight/재질 변이는 지오메트리 재빌드(비동기·수 프레임)라
//   requestRenderMode 에서 즉시 표시되지 않으므로, 전용 Ground(Polyline)Primitive 를
//   동기 생성해 위에 얹는다 (NetworkDataSourceLayer 링크 hover corridor 와 동일 패턴).
//   재질은 엔티티 원 재질을 복제해 원래 색/모양을 유지한 채 굵기/크기만 3배로 보인다.
//   hover/select 슬롯을 분리해 hover 해제가 선택 강조를 지우지 않는다.
type EntityOverlaySlot = { prim: Cesium.GroundPolylinePrimitive | Cesium.GroundPrimitive | null };
const hoverEntityOverlay: EntityOverlaySlot = { prim: null };
const selectEntityOverlay: EntityOverlaySlot = { prim: null };

/** 오버레이 대상 폴리곤 엔티티(노면표시 등) 여부 */
const isOverlayPolygonEntity = (entity: Cesium.Entity): boolean => {
    if (!entity.polygon) return false;
    const h = entity.polygon.hierarchy?.getValue(Cesium.JulianDate.now());
    const positions = Array.isArray(h) ? h : h?.positions;
    return Array.isArray(positions) && positions.length >= 3;
};

/** primitive 추가 후 ready + 여유 2프레임까지 렌더 펌프 (상한 10프레임) —
 *  asynchronous:false 여도 첫 프레임엔 리소스 준비만 되고 드로우가 밀릴 수 있다. */
const pumpEntityOverlayRender = (prim: Cesium.GroundPolylinePrimitive | Cesium.GroundPrimitive): void => {
    try { useCesiumStore.getState().viewer?.scene.requestRender(); } catch (_) {}
    let extra = 2, frames = 0;
    const step = () => {
        try { if ((prim as any).isDestroyed?.()) return; } catch (_) { return; }
        try { useCesiumStore.getState().viewer?.scene.requestRender(); } catch (_) {}
        if (++frames >= 10) return;
        if (prim.ready && --extra < 0) return;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
};

const clearEntityOverlay = (slot: EntityOverlaySlot): void => {
    if (!slot.prim) return;
    const viewer = useCesiumStore.getState().viewer;
    try { viewer?.scene.groundPrimitives.remove(slot.prim); } catch (_) {}
    slot.prim = null;
    requestCesiumRender();
};

/** 엔티티 폴리라인 재질 복제 — 화살표(커넥션)는 화살표 모양/색 유지, 그 외는 색 추출 */
const clonePolylineMaterial = (entity: Cesium.Entity, now: Cesium.JulianDate): Cesium.Material => {
    const matProp: any = entity.polyline?.material;
    const color: Cesium.Color = matProp?.color?.getValue?.(now) ?? Cesium.Color.WHITE;
    if (matProp instanceof Cesium.PolylineArrowMaterialProperty) {
        return Cesium.Material.fromType("PolylineArrow", { color });
    }
    return Cesium.Material.fromType("Color", { color });
};

const showPolylineOverlay = (slot: EntityOverlaySlot, entity: Cesium.Entity): boolean => {
    clearEntityOverlay(slot);
    const viewer = useCesiumStore.getState().viewer;
    if (!viewer) return false;
    const now = Cesium.JulianDate.now();
    const positions: Cesium.Cartesian3[] | undefined = entity.polyline?.positions?.getValue(now);
    if (!positions || positions.length < 2) return false;
    const baseWidth = entity.polyline?.width?.getValue(now) ?? 3;
    try {
        const prim = new Cesium.GroundPolylinePrimitive({
            geometryInstances: new Cesium.GeometryInstance({
                id: `__entityPolylineOverlay_${String(entity.id)}`,
                geometry: new Cesium.GroundPolylineGeometry({
                    positions,
                    width: baseWidth * HIGHLIGHT_SCALE,
                }),
            }),
            // 원 재질 유지 — 노란 단색으로 덮지 않고 화살표/색을 그대로 3배 굵기로
            appearance: new Cesium.PolylineMaterialAppearance({
                material: clonePolylineMaterial(entity, now),
            }),
            asynchronous: false,   // 동기 빌드 — hover 즉시 표시
            allowPicking: false,   // 오버레이가 픽을 훔치면 hover 판정이 다시 왜곡됨
        });
        viewer.scene.groundPrimitives.add(prim);
        slot.prim = prim;
        pumpEntityOverlayRender(prim);
        return true;
    } catch (_) {
        return false;
    }
};

/** 엔티티 폴리곤 재질 복제 — 노면표시 이미지 재질은 이미지 유지, 그 외는 색 추출 */
const clonePolygonMaterial = (entity: Cesium.Entity, now: Cesium.JulianDate): Cesium.Material => {
    const matProp: any = entity.polygon?.material;
    if (matProp instanceof Cesium.ImageMaterialProperty) {
        const image = matProp.image?.getValue?.(now);
        if (image) return Cesium.Material.fromType("Image", { image });
    }
    const color: Cesium.Color = matProp?.color?.getValue?.(now) ?? Cesium.Color.WHITE;
    return Cesium.Material.fromType("Color", { color });
};

const showPolygonOverlay = (slot: EntityOverlaySlot, entity: Cesium.Entity): boolean => {
    clearEntityOverlay(slot);
    const viewer = useCesiumStore.getState().viewer;
    if (!viewer) return false;
    const now = Cesium.JulianDate.now();
    const h = entity.polygon?.hierarchy?.getValue(now);
    const positions: Cesium.Cartesian3[] | undefined = Array.isArray(h) ? h : h?.positions;
    if (!positions || positions.length < 3) return false;

    // 무게중심 기준 HIGHLIGHT_SCALE 배 확대 — "hover 시 커지는" 효과를 원 색/이미지 그대로 재현
    const center = positions.reduce(
        (acc, p) => Cesium.Cartesian3.add(acc, p, acc),
        new Cesium.Cartesian3(0, 0, 0),
    );
    Cesium.Cartesian3.divideByScalar(center, positions.length, center);
    const scaled = positions.map((p) => {
        const offset = Cesium.Cartesian3.subtract(p, center, new Cesium.Cartesian3());
        Cesium.Cartesian3.multiplyByScalar(offset, HIGHLIGHT_SCALE, offset);
        return Cesium.Cartesian3.add(center, offset, new Cesium.Cartesian3());
    });

    try {
        const prim = new Cesium.GroundPrimitive({
            geometryInstances: new Cesium.GeometryInstance({
                id: `__entityPolygonOverlay_${String(entity.id)}`,
                geometry: new Cesium.PolygonGeometry({
                    polygonHierarchy: new Cesium.PolygonHierarchy(scaled),
                    vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
                }),
            }),
            appearance: new Cesium.EllipsoidSurfaceAppearance({
                material: clonePolygonMaterial(entity, now),
            }),
            asynchronous: false,
            allowPicking: false,
            classificationType: Cesium.ClassificationType.TERRAIN,
        });
        viewer.scene.groundPrimitives.add(prim);
        slot.prim = prim;
        pumpEntityOverlayRender(prim);
        return true;
    } catch (_) {
        return false;
    }
};

const highlightEntity = (entity: Cesium.Entity) => {
    if (entity === selectedEntity) return; // 선택 확대 유지 — hover 중첩 확대 금지
    clearCesiumHighlight();
    if (isClampedPolylineEntity(entity)) {
        // 커넥션 등: width 변이 대신 오버레이 (한 단계 늦는 표시 지연 방지)
        if (showPolylineOverlay(hoverEntityOverlay, entity)) {
            highlightedEntity = entity;
            return;
        }
    }
    if (isOverlayPolygonEntity(entity)) {
        // 노면표시 등 폴리곤: 원 재질 유지한 3배 확대 오버레이
        if (showPolygonOverlay(hoverEntityOverlay, entity)) {
            highlightedEntity = entity;
            return;
        }
    }
    setEntityScaleFactor(entity, HIGHLIGHT_SCALE);
    highlightedEntity = entity;
};

// hover 픽 윈도우 (px) — 기본(3x3)은 얇은 폴리라인(커넥션)에 불리해 8~10px 로 확장.
// 너무 키우면 이웃 오검출이 늘어나므로 보수적으로 9px.
const ENTITY_PICK_WINDOW_PX = 9;

/** world 좌표 → 화면(window) 좌표 (투영 실패 시 undefined) */
const worldToWindow = (scene: Cesium.Scene, world: Cesium.Cartesian3): Cesium.Cartesian2 | undefined => {
    try {
        const st: any = Cesium.SceneTransforms;
        const win = (st.worldToWindowCoordinates ?? st.wgs84ToWindowCoordinates)?.call(st, scene, world);
        if (!win || !isFinite(win.x) || !isFinite(win.y)) return undefined;
        return win;
    } catch (_) { return undefined; }
};

/** 2D 점-세그먼트 최소거리 */
const distancePointToSegment2D = (p: Cesium.Cartesian2, a: Cesium.Cartesian2, b: Cesium.Cartesian2): number => {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
};

/** 엔티티와 커서 사이의 화면좌표 거리 — position 단일점 또는 polyline 세그먼트 최소거리.
 *  점수화 불가(투영 실패/기하 없음)면 Infinity. */
const getEntityScreenDistance = (
    scene: Cesium.Scene,
    ent: Cesium.Entity,
    position: Cesium.Cartesian2,
    now: Cesium.JulianDate,
): number => {
    const world = ent.position?.getValue(now);
    if (world) {
        const win = worldToWindow(scene, world);
        return win ? Math.hypot(win.x - position.x, win.y - position.y) : Infinity;
    }
    // 커넥션 등 polyline 엔티티: 정점들을 투영해 커서-세그먼트 최소거리로 점수화
    const positions: Cesium.Cartesian3[] | undefined = ent.polyline?.positions?.getValue(now);
    if (!positions || positions.length === 0) return Infinity;
    let prev: Cesium.Cartesian2 | undefined;
    let best = Infinity;
    for (const world3 of positions) {
        const win = worldToWindow(scene, world3);
        if (!win) { prev = undefined; continue; } // 비가시/투영 실패 정점은 건너뜀
        const d = prev ? distancePointToSegment2D(position, prev, win) : Math.hypot(win.x - position.x, win.y - position.y);
        if (d < best) best = d;
        prev = win;
    }
    return best;
};

/**
 * 밀집 구역 픽 보정 — 확대(3x)된 이전 hover 엔티티의 픽 영역이 커서 아래 객체를 가리면
 * scene.pick/drillPick 첫 결과가 계속 그 엔티티로 남아 "hover 가 한 차례 늦는" 체감을
 * 만든다. drillPick(넓힌 픽 윈도우)으로 커서 아래 엔티티를 모두 모아, 커서와의
 * 화면좌표 거리(점 엔티티는 중심, 폴리라인 커넥션은 세그먼트 최소거리)가 가장 가까운
 * 것을 고른다 — 폴리라인도 점수화에 참여하므로 커넥션 hover 가 확대 객체에 가로채이지 않는다.
 */
const pickBestEntityAt = (scene: Cesium.Scene, position: Cesium.Cartesian2, fallback: Cesium.Entity): Cesium.Entity => {
    let picks: any[] = [];
    try {
        picks = scene.drillPick(position, 8, ENTITY_PICK_WINDOW_PX, ENTITY_PICK_WINDOW_PX) ?? [];
    } catch (_) { return fallback; }
    const entities: Cesium.Entity[] = [];
    for (const p of picks) {
        if (p?.id instanceof Cesium.Entity && !entities.includes(p.id)) entities.push(p.id);
    }
    if (entities.length <= 1) return fallback;
    const now = Cesium.JulianDate.now();
    let best = fallback;
    let bestD = Infinity;
    for (const ent of entities) {
        const d = getEntityScreenDistance(scene, ent, position, now);
        if (d < bestD) { bestD = d; best = ent; }
    }
    return best; // 모든 후보가 점수화 불가(Infinity)면 fallback 유지
};

// ── 3D 엔티티 select 하이라이트 (hover 와 별개 상태) ─────────────────
//   hover(highlightEntity/highlightedEntity)는 크기 확대. select 는 별도 selectedEntity 로
//   관리해 hover 가 지나가도 유지된다. 스케일은 항상 base×factor 절대 적용이므로
//   hover/select 가 어떤 순서로 겹쳐도 중첩 확대가 생기지 않는다.
let selectedEntity: Cesium.Entity | null = null;

const clearSelectedEntity = () => {
    clearEntityOverlay(selectEntityOverlay); // select 슬롯만 — hover 오버레이는 별개
    if (!selectedEntity) return;
    if (!isClampedPolylineEntity(selectedEntity) && !isOverlayPolygonEntity(selectedEntity)) {
        setEntityScaleFactor(selectedEntity, 1);
    }
    selectedEntity = null;
};

const selectEntity = (entity: Cesium.Entity | null) => {
    if (selectedEntity === entity) return;
    clearSelectedEntity();
    if (!entity) return;
    // hover 상태였다면 소유권만 이관 (절대 적용이라 별도 원복 불필요; 오버레이는 hover 슬롯 제거)
    if (highlightedEntity === entity) {
        highlightedEntity = null;
        clearEntityOverlay(hoverEntityOverlay);
    }
    if (isClampedPolylineEntity(entity)) {
        // 커넥션 등: width 변이 대신 select 슬롯 오버레이
        if (showPolylineOverlay(selectEntityOverlay, entity)) {
            selectedEntity = entity;
            return;
        }
    }
    if (isOverlayPolygonEntity(entity)) {
        if (showPolygonOverlay(selectEntityOverlay, entity)) {
            selectedEntity = entity;
            return;
        }
    }
    setEntityScaleFactor(entity, HIGHLIGHT_SCALE);
    selectedEntity = entity;
};

// ── 지도 간 확대(스케일) 미러 — 한쪽 지도의 hover/select 확대를 반대 지도의
//    같은 guid 객체에도 동일하게 적용해 두 지도의 강조 상태를 일치시킨다 ─────
// 마지막으로 미러를 시도한 guid — OL 트윈이 없는 엔티티(타일 모드 노드 등)에서
// 같은 대상에 대해 전 레이어 피처 스캔이 반복되는 것을 방지 (clearOlHighlight 가 리셋)
let mirrorHoverOlAttemptKey: string | null = null;

const mirrorHoverToOl = (guid: string | undefined) => {
    if (!guid) return;
    if (guid === mirrorHoverOlAttemptKey) return;
    if (highlightedFeature && isFeature(highlightedFeature) && highlightedFeature.get("__guid") === guid) return;
    if (highlightedFeature) clearOlHighlight(highlightedFeature);
    mirrorHoverOlAttemptKey = guid;
    const found = findOlFeatureByGuid(guid);
    if (!found || found.feature === selectedFeature) return;
    const styleFn = found.layer.getStyleFunction?.();
    if (styleFn) highlightFeature(found.feature, styleFn);
};

const mirrorHoverToCesium = (guid: string | undefined) => {
    if (!guid) return;
    const entity = findCesiumEntityByGuid(guid);
    if (!entity || entity === highlightedEntity || entity === selectedEntity) return;
    highlightEntity(entity);
};

const mirrorSelectToOl = (guid: string | undefined) => {
    if (!guid) return;
    if (selectedFeature?.get("__guid") === guid) return;
    if (selectedFeature) clearSelectionHighlight(selectedFeature);
    const found = findOlFeatureByGuid(guid);
    if (!found) return;
    const styleFn = found.layer.getStyleFunction?.();
    if (styleFn) applySelectionHighlight(found.feature, styleFn);
};

const mirrorSelectToCesium = (guid: string | undefined) => {
    if (!guid) { clearSelectedEntity(); return; }
    const entity = findCesiumEntityByGuid(guid);
    if (!entity) { clearSelectedEntity(); return; }
    selectEntity(entity);
};

const clearCesiumHighlight = () => {
    const entity = highlightedEntity;
    highlightedEntity = null;
    clearEntityOverlay(hoverEntityOverlay); // hover 슬롯만 — select 오버레이는 유지
    if (!entity) return;
    // select 된 엔티티는 hover 해제 대상에서 제외 (select 확대 유지)
    if (entity === selectedEntity) return;
    if (isClampedPolylineEntity(entity) || isOverlayPolygonEntity(entity)) return; // 오버레이 방식 — 원복할 변이 없음
    setEntityScaleFactor(entity, 1);
};

const clearOlHighlight = (feature: FeatureLike | Feature | undefined) => {
    mirrorHoverOlAttemptKey = null; // 호버 해제 → 다음 미러 시도는 다시 스캔
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
        return getHighlightedOlStyle(baseStyle, HIGHLIGHT_SCALE);
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