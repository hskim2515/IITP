import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import { Link } from "@type/Network";

// ── 공통 상수 (CesiumTrafficHeatmapLayer와 동일하게 유지) ──
export const TRAFFIC_EMA_DECAY    = 0.85;
export const TRAFFIC_MAX_TRAFFIC  = 8;
export const TRAFFIC_SNAP_DIST_M  = 150; // EPSG:3857 ≈ m
export const TRAFFIC_UPDATE_INTERVAL = 3;

/** 교통량 0~MAX_TRAFFIC → 색상 문자열 (green→yellow→red, 0이면 반투명 회색) */
export function trafficColor(ema: number): string {
    if (ema < 0.3) return "rgba(128,128,128,0.25)"; // 차량 없음: 흐린 회색
    const t = Math.min(ema / TRAFFIC_MAX_TRAFFIC, 1);
    let r: number, g: number;
    if (t < 0.5) { r = Math.round(255 * t * 2); g = 200; }
    else         { r = 255; g = Math.round(200 * (1 - (t - 0.5) * 2)); }
    return `rgba(${r},${g},0,0.85)`;
}

/** 도로 링크 중심 좌표(WGS84) → EPSG:3857 쌍 캐시 */
export interface LinkSegment {
    linkId: number;
    coords: number[][];
}

/** 네트워크 스토어에서 링크 세그먼트 목록 빌드 */
export function buildLinkSegments(links: Link[]): LinkSegment[] {
    const out: LinkSegment[] = [];
    for (const link of links) {
        if (!link.coordinates || link.coordinates.length < 2) continue;
        out.push({
            linkId: link.id,
            coords: link.coordinates.map(c => fromLonLat([c.lng, c.lat])),
        });
    }
    return out;
}

/** 점(px,py)에서 선분 A→B 까지 최단거리² */
export function pointToSegDist2(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number
): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
}

/** 차량 OL 좌표 → 가장 가까운 link id (-1: 매칭 없음) */
export function findNearestLink(
    x: number, y: number,
    segments: LinkSegment[],
    snapDist2: number
): number {
    let bestId = -1, bestD2 = Infinity;
    for (const { linkId, coords } of segments) {
        for (let i = 0; i < coords.length - 1; i++) {
            const [ax, ay] = coords[i]!, [bx, by] = coords[i + 1]!;
            const d2 = pointToSegDist2(x, y, ax!, ay!, bx!, by!);
            if (d2 < bestD2) { bestD2 = d2; bestId = linkId; }
        }
    }
    return bestD2 <= snapDist2 ? bestId : -1;
}

// ──────────────────────────────────────────────────────────────
// OL VectorLayer (2D)
// ──────────────────────────────────────────────────────────────
export default class TrafficHeatmapFeatureLayer extends VectorLayer {
    private trafficSource: VectorSource;
    private linkSegments: LinkSegment[] = [];
    private emaByLink   = new Map<number, number>();
    private featureByLink = new Map<number, Feature<LineString>>();
    private frameCount  = 0;

    constructor() {
        const source = new VectorSource();
        super({ source, visible: false, zIndex: 120 });
        this.trafficSource = source;
        this._buildFromStore();
    }

    private _buildFromStore() {
        const network = useNetworkStore.getState().currentJsonData
                     ?? useNetworkStore.getState().originData as any;
        if (!network?.links) return;
        this._buildLinks(network.links as Link[]);
    }

    private _buildLinks(links: Link[]) {
        this.trafficSource.clear();
        this.linkSegments = buildLinkSegments(links);
        this.featureByLink.clear();
        this.emaByLink.clear();

        for (const seg of this.linkSegments) {
            this.emaByLink.set(seg.linkId, 0);
            const feature = new Feature(new LineString(seg.coords));
            feature.setId(`traf-${seg.linkId}`);
            feature.setStyle(new Style({ stroke: new Stroke({ color: trafficColor(0), width: 3 }) }));
            this.featureByLink.set(seg.linkId, feature);
        }
        this.trafficSource.addFeatures([...this.featureByLink.values()]);
    }

    // ECEF → EPSG:3857
    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch { return null; }
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        // 네트워크 데이터가 아직 없으면 재시도
        if (this.linkSegments.length === 0) { this._buildFromStore(); return; }
        this.frameCount++;
        if (!data?.positions) return;
        if (this.frameCount % TRAFFIC_UPDATE_INTERVAL !== 0) return;

        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();

        for (const pos of data.positions) {
            if (!pos) continue;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const id = findNearestLink(ol[0]!, ol[1]!, this.linkSegments, snapDist2);
            if (id < 0) continue;
            countByLink.set(id, (countByLink.get(id) ?? 0) + 1);
        }

        for (const [linkId, feature] of this.featureByLink) {
            const count = countByLink.get(linkId) ?? 0;
            const prev  = this.emaByLink.get(linkId) ?? 0;
            const ema   = prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY);
            this.emaByLink.set(linkId, ema);
            const width = ema < 0.3 ? 3 : 3 + Math.min(ema / TRAFFIC_MAX_TRAFFIC, 1) * 6;
            feature.setStyle(new Style({ stroke: new Stroke({ color: trafficColor(ema), width }) }));
        }
    }

    public setSpeed(_s: number) {}
    public setStatus(_s: any) {}

    public destroy() {
        this.featureByLink.clear();
        this.emaByLink.clear();
        this.linkSegments = [];
        this.trafficSource.clear();
    }
}
