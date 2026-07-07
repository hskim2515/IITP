import VectorLayer from "ol/layer/Vector";
import { getActiveVersionId } from "@utils/versionId";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { Link } from "@type/Network";
import { VEHICLE_AGGREGATION } from "@utils/lodConstants";
import { useSimulationStore } from "@stores/useSimulationStore";
import axiosInstance from "@api/axiosInstance";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type OLMap from "ol/Map";
import { JulianDate } from "cesium";

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

    // ── 차량 백엔드 집계 모드 (VEHICLE_AGGREGATION.ENABLED, overview/mid) ──
    private moveEndKey: EventsKey | null = null;
    private aggregationActive = false;     // 현재 집계 모드인지(멀리) — true면 개별 차량 무시
    private lastAggregateAt = 0;
    private aggSimUnsub: (() => void) | null = null;

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
        // 집계 모드(멀리)에서는 개별 차량 위치를 무시 — 백엔드 집계가 히트맵을 담당.
        if (VEHICLE_AGGREGATION.ENABLED && this.aggregationActive) return;
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

    // ─────────────── 차량 백엔드 집계 모드 ───────────────

    override setMapInternal(map: OLMap | null): void {
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        super.setMapInternal(map);
        if (map && VEHICLE_AGGREGATION.ENABLED) {
            this.moveEndKey = map.on('moveend', () => this.updateAggregation(map));
            // 재생 시각 변화에도 집계 갱신 (시간창 이동)
            if (!this.aggSimUnsub) {
                this.aggSimUnsub = (useSimulationStore as any).subscribe(
                    (s: any) => s.currentTime,
                    () => { const m = this.getMapInternal(); if (m) this.updateAggregation(m as OLMap); },
                );
            }
            this.updateAggregation(map);
        }
    }

    /** viewport + 재생 시간창으로 백엔드 집계 호출 → emaByLink 주입 (overview/mid에서만) */
    private updateAggregation(map: OLMap): void {
        if (!VEHICLE_AGGREGATION.ENABLED) return;
        const view = map.getView();
        const size = map.getSize();
        const resolution = view.getResolution();
        if (!size || resolution == null) return;

        // near(확대)에서는 집계 비활성 → 개별 차량 경로 복귀.
        // 단 denseViewport(viewport 차량 상한 초과)면 줌 무관 집계 유지 — 개별 차량 대체 가시화.
        const dense = (useVehicleStore.getState() as any).denseViewport === true;
        this.aggregationActive = dense || resolution >= VEHICLE_AGGREGATION.MIN_RESOLUTION;
        if (!this.aggregationActive) return;

        const now = performance.now();
        if (now - this.lastAggregateAt < VEHICLE_AGGREGATION.THROTTLE_MS) return;
        this.lastAggregateAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;
        if (this.linkSegments.length === 0) this._buildFromStore();

        const ext = view.calculateExtent(size);
        const sw = toLonLat([ext[0]!, ext[1]!]);
        const ne = toLonLat([ext[2]!, ext[3]!]);
        const w = sw[0] ?? 0, s = sw[1] ?? 0, e = ne[0] ?? 0, n = ne[1] ?? 0;

        // 재생 현재 시각 → 시뮬 시작 기준 초 → ± 시간창
        const { fromTime, toTime } = this._timeWindow();

        axiosInstance.get(`/analytics/link-traffic/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime },
        }).then((res) => {
            const links = res.data?.links ?? [];
            // 미감지 링크는 0으로 (이전 잔상 제거)
            for (const [id] of this.emaByLink) this.emaByLink.set(id, 0);
            for (const lt of links) {
                const id = Number(lt.linkId);
                if (this.emaByLink.has(id)) {
                    this.emaByLink.set(id, lt.volume ?? 0);
                } else if (Array.isArray(lt.coordinates) && lt.coordinates.length >= 2) {
                    // 네트워크 타일 모드: 스토어에 링크 지오메트리가 없음 → 집계 응답의 좌표로 feature 생성
                    this.emaByLink.set(id, lt.volume ?? 0);
                    const coords = lt.coordinates.map((c: any) => fromLonLat([c.lng, c.lat]));
                    const feature = new Feature<LineString>(new LineString(coords));
                    feature.setId(`traf-${id}`);
                    feature.set("linkId", id);
                    this.featureByLink.set(id, feature);
                    this.trafficSource.addFeature(feature);
                }
            }
            this.trafficSource.changed();
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn('[TrafficHeatmap] 집계 호출 실패', err);
        });
    }

    /** 재생 현재 시각 기준 ± TIME_WINDOW_SEC (시뮬 시작 기준 초). 전체면 0,0 */
    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return { fromTime: 0, toTime: 0 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            const half = VEHICLE_AGGREGATION.TIME_WINDOW_SEC;
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: 0 };
        }
    }

    public destroy() {
        this._settingsUnsubscribe?.();
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        this.aggSimUnsub?.();
        this.featureByLink.clear();
        this.emaByLink.clear();
        this.linkSegments = [];
        this.trafficSource.clear();
    }
}
