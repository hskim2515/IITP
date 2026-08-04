import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { Feature } from "ol";
import { LineString, Point, Polygon } from "ol/geom";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import type OLMap from "ol/Map";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { LINK_METRICS } from "@utils/lodConstants";
import { losGradeColor } from "@utils/losScale";
import { normalizeSimType } from "@utils/simType";
import { computeLaneCenterlineOl } from "@utils/interpolateByOffset";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

const BOUNDARY_COLOR = "#22d3ee";

/** MesoLaneMetricLayer(3D)의 2D 대응 — 동일 데이터(/analytics/lane-traffic)를 OL 폴리곤/라인으로 그린다. */
export default class MesoLaneMetricOlLayer {
    private readonly _map: OLMap;
    private readonly _source = new VectorSource();
    private readonly _layer: VectorLayer;
    private destroyed = false;

    private _lastFetchAt = 0;
    private _moveUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(map: OLMap) {
        this._map = map;
        this._layer = new VectorLayer({
            source: this._source,
            zIndex: 135, // blockedSegLayer(130) 위, 선택 하이라이트(350) 아래
            style: (f) => this._styleFor(f as Feature),
        });
        map.addLayer(this._layer);

        const onMove = () => this._schedule();
        map.on("moveend", onMove);
        this._moveUnsub = () => map.un("moveend", onMove);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        this._schedule();
    }

    private _styleFor(f: Feature): Style {
        const kind = f.get("kind");
        const color = f.get("color") as string;
        if (kind === "lane") {
            return new Style({ fill: new Fill({ color: color + "cc" }), stroke: new Stroke({ color, width: 1 }) });
        }
        if (kind === "boundary") {
            return new Style({ image: new CircleStyle({
                radius: 6, fill: new Fill({ color }), stroke: new Stroke({ color: "#fff", width: 2 }),
            }) });
        }
        return new Style({ stroke: new Stroke({ color, width: 3 }) });
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._update(); }
            catch (e) { console.warn("[MesoLaneMetricOlLayer] 갱신 실패 (무시):", e); }
        }, 250);
    }

    private _update(): void {
        if (this.destroyed) return;
        const view = this._map.getView();
        const size = this._map.getSize();
        if (!size) return;
        const extent = view.calculateExtent(size);
        const [w, s] = toLonLat([extent[0]!, extent[1]!]);
        const [e, n] = toLonLat([extent[2]!, extent[3]!]);

        const now = performance.now();
        if (now - this._lastFetchAt < LINK_METRICS.THROTTLE_MS) return;
        this._lastFetchAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const { fromTime, toTime } = this._timeWindow();
        axiosInstance.get(`/analytics/lane-traffic/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            this._render((res.data as any)?.lanes ?? []);
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn("[MesoLaneMetricOlLayer] 집계 호출 실패", err);
        });
    }

    private _render(lanes: any[]): void {
        const network: any = useNetworkStore.getState().currentJsonData;
        const links: any[] = network?.links ?? [];
        this._source.clear();
        if (links.length === 0) return;

        const metricByLane = new Map<string, any>();
        for (const l of lanes) metricByLane.set(`${l.linkId}_${l.laneId}`, l);

        const linkById = new Map<string, any>(links.map((l: any) => [String(l.id), l]));
        const mesoLinkIds = new Set(
            links.filter((l: any) => normalizeSimType(l.simType) === "Meso").map((l: any) => String(l.id)));

        const buf: Feature[] = [];
        for (const link of links) {
            if (!mesoLinkIds.has(String(link.id))) continue;
            const laneCount = link.lanes?.length ?? 0;
            const laneWidth = (link.width ?? 7) / Math.max(1, laneCount);
            const half = laneWidth * 0.45;
            for (let i = 0; i < laneCount; i++) {
                const centerline = computeLaneCenterlineOl(link, i);
                if (!centerline || centerline.length < 2) continue;
                const left: number[][] = [], right: number[][] = [];
                for (let j = 0; j < centerline.length; j++) {
                    const prev = centerline[Math.max(0, j - 1)]!;
                    const next = centerline[Math.min(centerline.length - 1, j + 1)]!;
                    const dx = next[0]! - prev[0]!, dy = next[1]! - prev[1]!;
                    const len = Math.hypot(dx, dy) || 1;
                    const nx = dy / len, ny = -dx / len;
                    const p = centerline[j]!;
                    left.push([p[0]! + nx * half, p[1]! + ny * half]);
                    right.push([p[0]! - nx * half, p[1]! - ny * half]);
                }
                const ring = [...left, ...[...right].reverse(), left[0]!];
                const metric = metricByLane.get(`${link.id}_${i}`);
                const f = new Feature(new Polygon([ring]));
                f.setProperties({ kind: "lane", color: losGradeColor(metric?.losGrade) });
                buf.push(f);
            }
        }

        for (const node of network?.nodes ?? []) {
            for (const conn of node?.connections ?? []) {
                const fromLink = linkById.get(String(conn.fromLink));
                const toLink = linkById.get(String(conn.toLink));
                if (!fromLink) continue;
                const fromIsMeso = normalizeSimType(fromLink.simType) === "Meso";
                const toIsMeso = toLink ? normalizeSimType(toLink.simType) === "Meso" : fromIsMeso;
                if (!fromIsMeso) continue;

                const coords = conn.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) continue;
                const pts = coords
                    .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                    .map((c: any) => fromLonLat([c.lng, c.lat]));
                if (pts.length < 2) continue;

                const metric = metricByLane.get(`${conn.fromLink}_${conn.fromLane}`);
                const f = new Feature(new LineString(pts));
                f.setProperties({ kind: "connection", color: losGradeColor(metric?.losGrade) });
                buf.push(f);

                if (fromIsMeso !== toIsMeso) {
                    const mid = pts[Math.floor(pts.length / 2)];
                    if (mid) {
                        const bf = new Feature(new Point(mid));
                        bf.setProperties({ kind: "boundary", color: BOUNDARY_COLOR });
                        buf.push(bf);
                    }
                }
            }
        }

        if (buf.length > 0) this._source.addFeatures(buf);
    }

    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        const half = LINK_METRICS.TIME_WINDOW_SEC;
        if (!cur || !start) return { fromTime: 0, toTime: half * 2 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: half * 2 };
        }
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this._moveUnsub?.();
        this._simUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        try { this._map.removeLayer(this._layer); } catch (_) {}
        this._source.clear();
    }
}
