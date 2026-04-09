import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { Link } from "@type/Network";

// ── 공통 상수 (TrafficHeatmapCesiumLayer와 동일하게 유지) ──
export const TRAFFIC_EMA_DECAY       = 0.75;  // 0.85 → 0.75 (더 빠른 반응)
export const TRAFFIC_MAX_TRAFFIC     = 6;     // 8 → 6 (중간 교통량 민감도 ↑)
export const TRAFFIC_SNAP_DIST_M     = 200;   // 150 → 200 (매칭 커버리지 ↑)
export const TRAFFIC_UPDATE_INTERVAL = 3;

/* 버킷: 0=미감지, 1=낮음, 2=중간, 3=높음, 4=혼잡 */
export const NUM_TRAFFIC_BUCKETS = 5;

export function emaToBucket(ema: number): number {
    if (ema < 0.3) return 0;
    return 1 + Math.min(Math.floor(Math.min(ema / TRAFFIC_MAX_TRAFFIC, 1) * 4), 3);
}

/** 도로 링크 중심 좌표(WGS84) → EPSG:3857 쌍 캐시 */
export interface LinkSegment {
    linkId: number;
    coords: number[][];
}

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

export function pointToSegDist2(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
}

export function findNearestLink(
    x: number, y: number,
    segments: LinkSegment[],
    snapDist2: number,
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

/* 버킷 인덱스 기준 선 두께 (exaggeration 1.0 기준) */
const BUCKET_BASE_WIDTHS = [1.5, 3, 5, 7, 10];

function buildBucketStyles(colors: string[], exaggeration: number): Style[] {
    return Array.from({ length: NUM_TRAFFIC_BUCKETS }, (_, b) => {
        if (b === 0) return new Style({ stroke: new Stroke({ color: "rgba(160,160,160,0.25)", width: 1.5 }) });
        const color = colors[b - 1] ?? "#ff2200";
        const width = (BUCKET_BASE_WIDTHS[b] ?? 3) * exaggeration;
        return new Style({ stroke: new Stroke({ color, width }) });
    });
}

// ──────────────────────────────────────────────────────────────
// OL VectorLayer (2D)
// ──────────────────────────────────────────────────────────────
export default class TrafficHeatmapFeatureLayer extends VectorLayer<VectorSource> {
    private trafficSource: VectorSource;
    private linkSegments: LinkSegment[] = [];
    private emaByLink    = new Map<number, number>();
    private featureByLink = new Map<number, Feature<LineString>>();
    private frameCount   = 0;

    /* 버킷별 캐시된 스타일 (settings 변경 시 재생성) */
    private _styleCache: Style[] = [];
    private _settingsUnsubscribe: (() => void) | null = null;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 120,
            style: (feature) => this._styleForFeature(feature as Feature<LineString>),
        });
        this.trafficSource = source;
        this._rebuildStyleCache();
        this._buildFromStore();

        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors, s.exaggeration],
            () => this._rebuildStyleCache(),
        );
    }

    private _rebuildStyleCache(): void {
        const { colors, exaggeration } = useHeatmapSettingStore.getState();
        this._styleCache = buildBucketStyles(colors, exaggeration);
    }

    private _styleForFeature(feature: Feature<LineString>): Style {
        const linkId = feature.get("linkId") as number;
        const ema    = this.emaByLink.get(linkId) ?? 0;
        const bucket = emaToBucket(ema);
        return this._styleCache[bucket] ?? this._styleCache[0]!;
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

        const features: Feature<LineString>[] = [];
        for (const seg of this.linkSegments) {
            this.emaByLink.set(seg.linkId, 0);
            const feature = new Feature<LineString>(new LineString(seg.coords));
            feature.setId(`traf-${seg.linkId}`);
            feature.set("linkId", seg.linkId);
            this.featureByLink.set(seg.linkId, feature);
            features.push(feature);
        }
        this.trafficSource.addFeatures(features);
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch { return null; }
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
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

        for (const [linkId] of this.emaByLink) {
            const count = countByLink.get(linkId) ?? 0;
            const prev  = this.emaByLink.get(linkId) ?? 0;
            this.emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY));
        }

        /* 전체 레이어 1번 재렌더 (feature별 setStyle 대신) */
        this.trafficSource.changed();
    }

    public setSpeed(_s: number) {}
    public setStatus(_s: any) {}

    public destroy() {
        this._settingsUnsubscribe?.();
        this.featureByLink.clear();
        this.emaByLink.clear();
        this.linkSegments = [];
        this.trafficSource.clear();
    }
}
