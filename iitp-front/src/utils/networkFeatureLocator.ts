import * as Cesium from "cesium";
import type { Viewer } from "cesium";
import type { Map as OLMap } from "ol";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import { fromLonLat, transformExtent } from "ol/proj";
import axiosInstance from "@api/axiosInstance";
import { useScenarioStore } from "@stores/useScenarioStore";
import { useSelectionStore } from "@stores/useSelectionStore";
// ⚠️ @datasource/NetworkDataSourceLayer 를 import 하지 말 것 — UI 유틸 경유로
// LayerManager eager glob 과 모듈 평가 사이클이 생겨 3D 레이어가 조용히 죽는다.
import { networkPrimitivePropertiesMap, NETWORK_HIGHLIGHT_DURATION_MS } from "@utils/networkPrimitiveShared";

/**
 * 네트워크 feature 위치 조회/이동/2D 하이라이트 유틸 (타일 모드).
 *
 * - 이동: 그리드 row 선택마다 두 지도(Cesium/OL)를 해당 feature 로 fly/fit.
 *   좌표는 이미 로드된 3D primitive 캐시(networkPrimitivePropertiesMap)를 우선 사용하고,
 *   오프스크린이면 GET /network/{versionId}/feature 로 조회한다.
 * - 2D 하이라이트: 타일 모드 2D 는 MVT(VectorTile render feature) 경로라 per-feature
 *   setStyle 이 동작하지 않는다 — 3D 오버레이 primitive 와 같은 방식으로, 전용 최상단
 *   VectorLayer 에 임시 geometry 를 그려 강조한다. 색상은 3D 기준(YELLOW) 통일,
 *   선택 오버레이는 자동 만료하지 않고 다음 선택/선택해제 전까지 유지한다(3D 선택 슬롯과 동일).
 */

export { NETWORK_HIGHLIGHT_DURATION_MS };

// 3D 기준 색상(Cesium.Color.YELLOW 계열)에 맞춘 2D 하이라이트 색
const HIGHLIGHT_COLOR = "rgba(255,255,0,0.95)";
const HIGHLIGHT_FILL = "rgba(255,255,0,0.35)";
const HOVER_COLOR = "rgba(255,220,0,0.95)";
const HOVER_FILL = "rgba(255,220,0,0.45)";

export interface ParsedTileGuid {
    featureType: "links" | "nodes";
    id: string;
    /** 루트 링크/노드 guid (T_L{id} / T_N{id}) — primitive/entity 하이라이트 대상 */
    parentGuid: string;
    /** T_L{id}_lane{i} 계열이면 해당 lane index */
    laneIdx?: number;
}

/** 타일 모드 합성 guid 파싱 — 루트 링크/노드 id 추출 (lane/cell/port 등 하위 guid 도 부모로 귀속) */
export function parseTileGuid(guid: string): ParsedTileGuid | null {
    if (typeof guid !== "string") return null;
    const linkId = /^T_L(\d+)/.exec(guid)?.[1];
    if (linkId) {
        const laneIdxStr = /_lane(\d+)/.exec(guid)?.[1];
        return {
            featureType: "links",
            id: linkId,
            parentGuid: `T_L${linkId}`,
            laneIdx: laneIdxStr != null ? Number(laneIdxStr) : undefined,
        };
    }
    const nodeId = /^T_N(\d+)/.exec(guid)?.[1];
    if (nodeId) return { featureType: "nodes", id: nodeId, parentGuid: `T_N${nodeId}` };
    return null;
}

/** link coordinates 배열 또는 node 단일 좌표 객체 → {lng,lat}[] 정규화 */
export function normalizeCoords(raw: any): { lng: number; lat: number }[] {
    if (Array.isArray(raw)) {
        return raw.filter((c: any) => c && typeof c.lng === "number" && typeof c.lat === "number");
    }
    if (raw && typeof raw.lng === "number" && typeof raw.lat === "number") return [raw];
    return [];
}

/** 두 지도(OL fit + Cesium flyToBoundingSphere)를 좌표 범위로 이동 */
export function fitMapsToCoords(coords: { lng: number; lat: number }[], viewer?: Viewer | null, olMap?: OLMap | null): void {
    if (coords.length === 0) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of coords) {
        minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng);
        minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
    }

    // OL: 여백을 두고 extent fit — 단일 노드도 pad 로 적정 줌 확보. 이동(moveend) 후
    // NetworkFeatureLayer 의 기존 타일 업데이트가 해당 위치 데이터를 로드한다.
    if (olMap) {
        const pad = 0.0015; // 약 150m
        const extent3857 = transformExtent(
            [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad],
            "EPSG:4326", "EPSG:3857",
        );
        olMap.getView().fit(extent3857, { duration: 800, padding: [60, 60, 60, 60], maxZoom: 19 });
    }

    if (viewer) {
        const pts = coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
        const sphere = Cesium.BoundingSphere.fromPoints(pts);
        const radius = Math.max(sphere.radius, 100);
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(sphere.center, radius), {
            duration: 2.0,
            offset: new Cesium.HeadingPitchRange(0, -0.7, radius * 3.0),
        });
    }
}

// ── 2D 선택 하이라이트 오버레이 ──────────────────────────────────
// MVT 렌더 피처에는 setStyle 이 불가하므로 전용 VectorLayer 에 임시 feature 를 그린다.
let highlight2DLayer: VectorLayer<VectorSource> | null = null;
// 3D 선택 슬롯과 동일하게 일정 시간 후 자동 해제 — 재표시 시 타이머 리셋
let highlight2DClearTimer: ReturnType<typeof setTimeout> | null = null;

function ensureHighlight2DLayer(olMap: OLMap): VectorLayer<VectorSource> {
    // 지도 재생성 등으로 레이어가 map 에서 빠졌으면 재부착
    if (highlight2DLayer && !olMap.getLayers().getArray().includes(highlight2DLayer)) {
        olMap.addLayer(highlight2DLayer);
    }
    if (highlight2DLayer) return highlight2DLayer;
    highlight2DLayer = new VectorLayer({
        source: new VectorSource(),
        zIndex: 500, // 네트워크 계열 최고 zIndex(350) 위
        style: new Style({
            stroke: new Stroke({ color: HIGHLIGHT_COLOR, width: 6 }),
            fill: new Fill({ color: HIGHLIGHT_FILL }),
            image: new CircleStyle({
                radius: 9,
                fill: new Fill({ color: HIGHLIGHT_COLOR }),
                stroke: new Stroke({ color: "white", width: 3 }),
            }),
        }),
    });
    highlight2DLayer.set("layer", "networkSelectHighlight");
    olMap.addLayer(highlight2DLayer);
    return highlight2DLayer;
}

/** 선택 좌표를 2D 하이라이트 오버레이에 표시 (기존 표시는 교체).
 *  자동 만료 없음 — 다른 객체 선택/빈 곳 클릭/그리드 선택해제(clearNetworkHighlight2D) 전까지 유지. */
export function showNetworkHighlight2D(olMap: OLMap, coords: { lng: number; lat: number }[]): void {
    const first = coords[0];
    if (!first) return;
    const layer = ensureHighlight2DLayer(olMap);
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    const geometry = coords.length === 1
        ? new Point(fromLonLat([first.lng, first.lat]))
        : new LineString(coords.map((c) => fromLonLat([c.lng, c.lat])));
    source.addFeature(new Feature({ geometry }));

    // 이전에 걸려 있던 만료 타이머가 있으면 취소(선택을 지우지 않도록)
    if (highlight2DClearTimer) { clearTimeout(highlight2DClearTimer); highlight2DClearTimer = null; }
}

/** 2D 하이라이트 오버레이 제거 (자동 해제 타이머 포함) */
export function clearNetworkHighlight2D(): void {
    if (highlight2DClearTimer) { clearTimeout(highlight2DClearTimer); highlight2DClearTimer = null; }
    highlight2DLayer?.getSource()?.clear();
}

// ── 2D 호버 하이라이트 오버레이 ──────────────────────────────────
// 선택 오버레이와 별도 레이어/소스 — hover 가 선택 강조를 지우지 않도록 분리.
let hover2DLayer: VectorLayer<VectorSource> | null = null;

function ensureHover2DLayer(olMap: OLMap): VectorLayer<VectorSource> {
    if (hover2DLayer && !olMap.getLayers().getArray().includes(hover2DLayer)) {
        olMap.addLayer(hover2DLayer);
    }
    if (hover2DLayer) return hover2DLayer;
    hover2DLayer = new VectorLayer({
        source: new VectorSource(),
        zIndex: 490, // 선택 오버레이(500) 바로 아래
        style: new Style({
            // 폴리곤(레인 hover)은 fill 로 채워지고, 라인(링크 hover)은 stroke 만 적용된다.
            fill: new Fill({ color: HOVER_FILL }),
            stroke: new Stroke({ color: HOVER_COLOR, width: 3 }),
            image: new CircleStyle({
                radius: 7,
                fill: new Fill({ color: HOVER_COLOR }),
                stroke: new Stroke({ color: "white", width: 2 }),
            }),
        }),
    });
    hover2DLayer.set("layer", "networkHoverHighlight");
    hover2DLayer.set("excludeFromHit", true); // 호버 오버레이 자체가 픽에 잡히지 않게
    olMap.addLayer(hover2DLayer);
    return hover2DLayer;
}

/** 호버 좌표(경위도)를 2D 호버 오버레이에 표시 */
export function showNetworkHoverHighlight2D(olMap: OLMap, coords: { lng: number; lat: number }[]): void {
    showNetworkHoverHighlight2DProjected(olMap, coords.map((c) => fromLonLat([c.lng, c.lat])));
}

/** 호버 좌표(EPSG:3857 — MVT render feature 등)를 2D 호버 오버레이에 표시 */
export function showNetworkHoverHighlight2DProjected(olMap: OLMap, coords3857: number[][]): void {
    const first = coords3857[0];
    if (!first) return;
    const layer = ensureHover2DLayer(olMap);
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    const geometry = coords3857.length === 1 ? new Point(first) : new LineString(coords3857);
    source.addFeature(new Feature({ geometry }));
}

/** 레인 폴리곤 링(EPSG:3857)을 2D 호버 오버레이에 표시 — 선택(클릭) 하이라이트와 동일한
 *  buildLaneRing3857 링을 쓰므로 hover 가 "화면에 보이는 차선"과 정확히 겹친다. */
export function showNetworkHoverHighlightPolygon2D(olMap: OLMap, ring3857: number[][]): void {
    if (!ring3857 || ring3857.length < 3) return;
    const layer = ensureHover2DLayer(olMap);
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    source.addFeature(new Feature({ geometry: new Polygon([ring3857]) }));
    try { olMap.render(); } catch (_) {}
}

/** 2D 호버 오버레이 제거 — 비어 있으면 no-op (mousemove 마다 호출돼도 OL 리렌더 미유발) */
export function clearNetworkHoverHighlight2D(): void {
    const source = hover2DLayer?.getSource();
    if (!source || source.isEmpty()) return;
    source.clear();
}

/**
 * feature 단건 조회로 속성/좌표 확보 — MVT 렌더 피처(속성 없음)나 오프스크린 대상용.
 * 응답에 타일 guid 규칙(T_L{id}/T_N{id})의 __guid 와 featureType 을 부여해
 * 선택/하이라이트 흐름과 guid 가 일치하게 한다. 실패 시 null.
 */
export async function fetchNetworkFeatureProps(
    featureType: "links" | "nodes",
    id: string | number,
): Promise<Record<string, any> | null> {
    const versionKey = useScenarioStore.getState().selectedScenarioVersion?.key;
    if (versionKey == null || id == null) return null;
    try {
        const res = await axiosInstance.get(`/network/${versionKey}/feature`, {
            params: { featureType, id: String(id) },
        });
        const data = res?.data;
        if (!data || typeof data !== "object") return null;
        const prefix = featureType === "links" ? "T_L" : "T_N";
        return { ...data, featureType, __guid: `${prefix}${String(id)}` };
    } catch (_) {
        return null;
    }
}

/**
 * await 후에도 이 guid 가 아직 선택 상태인지 확인한다.
 *
 * 오프스크린 대상은 `/network/{v}/feature` 응답을 기다리는데, 그 사이 사용자가 그리드에서
 * 다른 행을 선택하면 늦게 도착한 이전 응답이 `showNetworkHighlight2D` 로 소스를 clear 하고
 * **이전 객체에 선택 오버레이를 다시 그린다**(선택 상태와 어긋난 잔상). stale 응답은 버린다.
 */
function isStillSelected(guid: string): boolean {
    const current = useSelectionStore.getState().selectedGuid;
    return Array.isArray(current) && current.some((g) => String(g) === guid);
}

/** guid 로 좌표 획득 — 로드된 primitive 캐시 우선, 없으면 /feature API. 실패 시 빈 배열. */
async function resolveCoordsByGuid(parsed: ParsedTileGuid): Promise<{ lng: number; lat: number }[]> {
    // 1) 캐시 우선: 이미 렌더된 링크는 API 없이 즉시 좌표 확보
    const cached = networkPrimitivePropertiesMap.get(parsed.parentGuid);
    const cachedCoords = normalizeCoords(cached?.coordinates);
    if (cachedCoords.length > 0) return cachedCoords;

    // 2) 오프스크린: 단건 조회 API
    const full = await fetchNetworkFeatureProps(parsed.featureType, parsed.id);
    return normalizeCoords(full?.coordinates);
}

/**
 * guid 의 feature 로 두 지도 이동 + 2D 선택 하이라이트 표시.
 * 매 선택마다 호출해도 안전 (캐시 히트 시 API 호출 없음).
 * 실패(파싱 불가/좌표 없음)하면 false — 호출측은 조용히 기존 경로만 유지한다.
 * ⚠️ 카메라를 이동시키므로 그리드 행 선택 등 "명시적 이동" 경로에서만 사용할 것 —
 *    지도 단순 클릭 선택에는 highlightNetworkFeature2DByGuid 를 사용한다.
 */
export async function flyToNetworkFeatureByGuid(
    guid: string,
    viewer?: Viewer | null,
    olMap?: OLMap | null,
): Promise<boolean> {
    const parsed = parseTileGuid(guid);
    if (!parsed) return false;
    const coords = await resolveCoordsByGuid(parsed);
    if (coords.length === 0) return false;
    if (!isStillSelected(guid)) return false; // 응답 대기 중 선택이 바뀜 — 이전 대상으로 이동/강조 금지
    fitMapsToCoords(coords, viewer, olMap);
    if (olMap) showNetworkHighlight2D(olMap, coords);
    return true;
}

/**
 * flyToNetworkFeatureByGuid 의 카메라 고정 버전 — 2D 선택 오버레이만 표시하고
 * Cesium/OL 카메라는 절대 움직이지 않는다 (지도 단순 클릭 선택용).
 */
export async function highlightNetworkFeature2DByGuid(
    guid: string,
    olMap?: OLMap | null,
): Promise<boolean> {
    const parsed = parseTileGuid(guid);
    if (!parsed || !olMap) return false;
    const coords = await resolveCoordsByGuid(parsed);
    if (coords.length === 0) return false;
    if (!isStillSelected(guid)) return false; // 응답 대기 중 선택이 바뀜 — 이전 대상 강조 금지
    showNetworkHighlight2D(olMap, coords);
    return true;
}
