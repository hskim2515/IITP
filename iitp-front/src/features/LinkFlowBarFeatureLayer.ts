import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { Map as OLMap } from "ol";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    emaToBucket,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

// ── 시각 상수 ────────────────────────────────────────────────────────
const CORRIDOR_WIDTH = 10;    // CSS px — 도로 배경 두께
const FLOW_LINE_W = 4;        // CSS px — 중심 스트로크 두께
const FLOW_CYCLE_MS = 1800;   // 3D와 비슷한 한 주기 애니메이션 속도
const FLOW_ARROW_WIDTH = 0.05;// 링크 길이 대비 화살촉 폭
const CHEVRON_SIZE = 7;       // CSS px — V자 팔 반길이
const FLOW_SCALE_FULL_ZOOM = 15;
const FLOW_SCALE_MIN_ZOOM = 11;
const FLOW_SCALE_MIN = 0.11;
const DWELL_SPEED_THRESHOLD_MPS = 2.0;
const DWELL_GRACE_SEC = 8;
const DWELL_ACCUM_FACTOR = 0.4;

type FlowMetric = 'volume' | 'avgSpeed' | 'dwell';
type VehicleState = {
    lastPos: number[] | null;
    lastTs: number;
    currentLinkId: number;
    slowAccumSec: number;
};

type PathSample = { x: number; y: number; angle: number; };

function getPathLength(pixels: number[][]): number {
    let total = 0;
    for (let i = 0; i < pixels.length - 1; i++) {
        const ax = pixels[i]![0]!, ay = pixels[i]![1]!;
        const bx = pixels[i + 1]![0]!, by = pixels[i + 1]![1]!;
        total += Math.hypot(bx - ax, by - ay);
    }
    return total;
}

function samplePathAt(pixels: number[][], dist: number): PathSample | null {
    if (pixels.length < 2) return null;

    let walked = 0;
    for (let i = 0; i < pixels.length - 1; i++) {
        const ax = pixels[i]![0]!, ay = pixels[i]![1]!;
        const bx = pixels[i + 1]![0]!, by = pixels[i + 1]![1]!;
        const dx = bx - ax, dy = by - ay;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;

        if (dist <= walked + segLen) {
            const t = Math.max(0, Math.min(1, (dist - walked) / segLen));
            return {
                x: ax + dx * t,
                y: ay + dy * t,
                angle: Math.atan2(dy, dx),
            };
        }
        walked += segLen;
    }

    const last = pixels[pixels.length - 1]!;
    const prev = pixels[pixels.length - 2]!;
    return {
        x: last[0]!,
        y: last[1]!,
        angle: Math.atan2(last[1]! - prev[1]!, last[0]! - prev[0]!),
    };
}

function buildPathSlice(pixels: number[][], startDist: number, endDist: number): number[][] {
    if (pixels.length < 2 || endDist <= startDist) return [];

    const totalLength = getPathLength(pixels);
    const clampedStart = Math.max(0, Math.min(totalLength, startDist));
    const clampedEnd = Math.max(0, Math.min(totalLength, endDist));
    if (clampedEnd <= clampedStart) return [];

    const points: number[][] = [];
    let walked = 0;

    for (let i = 0; i < pixels.length - 1; i++) {
        const a = pixels[i]!;
        const b = pixels[i + 1]!;
        const dx = b[0]! - a[0]!;
        const dy = b[1]! - a[1]!;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;

        const segStart = walked;
        const segEnd = walked + segLen;
        const from = Math.max(clampedStart, segStart);
        const to = Math.min(clampedEnd, segEnd);

        if (to > from) {
            const fromT = (from - segStart) / segLen;
            const toT = (to - segStart) / segLen;
            const fromPt = [a[0]! + dx * fromT, a[1]! + dy * fromT];
            const toPt = [a[0]! + dx * toT, a[1]! + dy * toT];

            if (points.length === 0) {
                points.push(fromPt);
            } else {
                const prev = points[points.length - 1]!;
                if (prev[0] !== fromPt[0] || prev[1] !== fromPt[1]) points.push(fromPt);
            }
            points.push(toPt);
        }

        walked = segEnd;
        if (walked >= clampedEnd) break;
    }

    return points;
}

// ── canvas context에 단일 chevron 그리기 ────────────────────────────
function drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, angle: number,
    strokeStyle: string,
    lineWidth: number,
    size: number = CHEVRON_SIZE,
): void {
    const s = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.55);
    ctx.lineTo( s * 0.45,  0);
    ctx.lineTo(-s * 0.55,  s * 0.55);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * OL 2D — 링크 플로우바 레이어.
 * postrender 이벤트 + Canvas 2D API로 Cesium의 흐르는 화살표 효과를 재현.
 *  - 배경 복도 (semi-transparent corridor)
 *  - 애니메이션 대시 (lineDashOffset)
 *  - 이동하는 V자 chevron 화살표
 */
export default class LinkFlowBarFeatureLayer extends VectorLayer<VectorSource> {
    private readonly _flowSource: VectorSource;
    private readonly _map: OLMap | null;

    private _links: Link[]           = [];
    private _linkSegments: LinkSegment[] = [];
    private _emaByLink  = new Map<number, number>();
    private _vehicleStates: VehicleState[] = [];
    private _frameCount = 0;
    private _metric: FlowMetric = useAnalysisSettingStore.getState().flowBar.metric;

    private _settingsUnsubscribe: (() => void) | null = null;
    private _metricUnsubscribe: (() => void) | null = null;

    constructor(map?: OLMap) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 950,
            style: (feature) => this._styleForFeature(feature as Feature<LineString>),
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this._flowSource = source;
        this._map = map ?? null;
        this._buildFromStore();

        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors],
            () => {},
        );
        this._metricUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.flowBar.metric,
            (metric: FlowMetric) => this.setFlowMetric(metric),
        );

        this.on("postrender", this._onPostRender);
    }

    // ── 네트워크 데이터 로드 ─────────────────────────────────────────
    private _buildFromStore(): void {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;

        this._links = network.links as Link[];
        this._linkSegments = buildLinkSegments(this._links);
        this._emaByLink.clear();

        const features: Feature<LineString>[] = [];
        for (const link of this._links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const coords = link.coordinates.map(c => fromLonLat([c.lng, c.lat]));
            this._emaByLink.set(link.id, 0);
            const feat = new Feature<LineString>(new LineString(coords));
            feat.setId(`flow2d-${link.id}`);
            feat.set("linkId", link.id);
            features.push(feat);
        }
        this._flowSource.clear();
        this._flowSource.addFeatures(features);
    }

    private _styleForFeature(feature: Feature<LineString>): Style | null {
        const linkId = feature.get("linkId") as number | undefined;
        if (linkId == null) return null;

        return new Style({
            renderer: (pixelCoordinates: any, state: any) => {
                const ema = this._emaByLink.get(linkId) ?? 0;
                const bucket = this._metricValueToBucket(ema);
                if (bucket === 0) return;

                const pixels = Array.isArray(pixelCoordinates?.[0]?.[0])
                    ? pixelCoordinates[0] as number[][]
                    : pixelCoordinates as number[][];
                if (!Array.isArray(pixels) || pixels.length < 2) return;

                const ctx = state.context as CanvasRenderingContext2D | undefined;
                if (!ctx || typeof ctx.setLineDash !== "function") return;

                const { colors } = useHeatmapSettingStore.getState();
                const hex = colors[bucket - 1] ?? "#ff2200";
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);

                const totalLength = getPathLength(pixels);
                if (totalLength <= 0) return;

                const cycleT = (Date.now() % FLOW_CYCLE_MS) / FLOW_CYCLE_MS;
                const easedT = cycleT * cycleT;
                const zoom = this._map?.getView().getZoom() ?? FLOW_SCALE_FULL_ZOOM;
                const visualScale = clamp(
                    FLOW_SCALE_MIN + ((zoom - FLOW_SCALE_MIN_ZOOM) / (FLOW_SCALE_FULL_ZOOM - FLOW_SCALE_MIN_ZOOM)) * (1 - FLOW_SCALE_MIN),
                    FLOW_SCALE_MIN,
                    1,
                );
                const corridorWidth = CORRIDOR_WIDTH * visualScale;
                const flowLineWidth = FLOW_LINE_W * visualScale;
                const chevronSize = CHEVRON_SIZE * visualScale;
                const headLength = Math.max(14 * visualScale, Math.min(40 * visualScale, totalLength * FLOW_ARROW_WIDTH));
                const headDist = totalLength * easedT;
                const trailEnd = Math.max(0, headDist - headLength);
                const head = samplePathAt(pixels, headDist);
                const trailPixels = buildPathSlice(pixels, 0, trailEnd);

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) {
                    ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                }
                ctx.strokeStyle = `rgba(${r},${g},${b},0.20)`;
                ctx.lineWidth = corridorWidth;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.setLineDash([]);
                ctx.stroke();

                if (trailPixels.length >= 2) {
                    ctx.beginPath();
                    ctx.moveTo(trailPixels[0]![0]!, trailPixels[0]![1]!);
                    for (let i = 1; i < trailPixels.length; i++) {
                        ctx.lineTo(trailPixels[i]![0]!, trailPixels[i]![1]!);
                    }
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.32)`;
                    ctx.lineWidth = flowLineWidth + visualScale;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.setLineDash([]);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(trailPixels[0]![0]!, trailPixels[0]![1]!);
                    for (let i = 1; i < trailPixels.length; i++) {
                        ctx.lineTo(trailPixels[i]![0]!, trailPixels[i]![1]!);
                    }
                    ctx.strokeStyle = `rgba(${r},${g},${b},0.60)`;
                    ctx.lineWidth = flowLineWidth * 0.62;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.stroke();
                }

                if (head) {
                    drawChevron(ctx, head.x, head.y, head.angle, `rgba(${r},${g},${b},0.58)`, 3.0 * visualScale, chevronSize);
                    drawChevron(ctx, head.x, head.y, head.angle, "rgba(255,255,255,0.42)", 1.1 * visualScale, chevronSize);
                }
            },
        });
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any,
                Ellipsoid.WGS84,
            );
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch {
            return null;
        }
    }

    private _metricValueToBucket(value: number): number {
        if (this._metric === 'volume') return emaToBucket(value);
        if (this._metric === 'avgSpeed') {
            if (value <= 0) return 0;
            if (value < 20) return 4;
            if (value < 40) return 3;
            if (value < 60) return 2;
            if (value < 80) return 1;
            return 0;
        }
        if (value < 0.8) return 0;
        if (value < 2.2) return 1;
        if (value < 4.2) return 2;
        if (value < 7.0) return 3;
        return 4;
    }

    private _resetRuntimeState(): void {
        this._frameCount = 0;
        this._vehicleStates = [];
        this._emaByLink.forEach((_v, key) => this._emaByLink.set(key, 0));
        if (this.getVisible()) this._map?.render();
    }

    // ── postrender: 매 프레임 canvas에 직접 그리기 ──────────────────
    private readonly _onPostRender = (event: any): void => {
        let anyActive = false;
        for (const ema of this._emaByLink.values()) {
            if (emaToBucket(ema) > 0) {
                anyActive = true;
                break;
            }
        }

        // 활성 트래픽이 있을 때만 연속 렌더 요청 → 애니메이션 루프
        if (anyActive && this.getVisible()) {
            this._map?.render();
        }
    };

    // ── EMA 업데이트 (시뮬레이션 루프에서 호출) ─────────────────────
    public setLatestPositions(data: { positions: (number[] | null)[] }): void {
        if (!this.getVisible()) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }
        if (!data?.positions) return;

        this._frameCount++;
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL !== 0) return;

        const snapDist2   = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const now = Date.now();
        while (this._vehicleStates.length < data.positions.length) {
            this._vehicleStates.push({ lastPos: null, lastTs: now, currentLinkId: -1, slowAccumSec: 0 });
        }

        const countByLink = new Map<number, number>();
        const speedSumByLink = new Map<number, number>();
        const speedCountByLink = new Map<number, number>();
        const dwellByLink = new Map<number, number>();
        for (let i = 0; i < data.positions.length; i++) {
            const pos = data.positions[i];
            if (!pos) continue;
            const state = this._vehicleStates[i]!;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const id = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (id < 0) continue;
            countByLink.set(id, (countByLink.get(id) ?? 0) + 1);
            if (state.lastPos) {
                const dt = Math.max(0.03, Math.min(0.35, (now - state.lastTs) / 1000));
                const dx = pos[0] - state.lastPos[0]!;
                const dy = pos[1] - state.lastPos[1]!;
                const dz = pos[2] - state.lastPos[2]!;
                const kmh = Math.hypot(dx, dy, dz) / dt * 3.6;
                if (kmh > 0 && kmh < 200) {
                    speedSumByLink.set(id, (speedSumByLink.get(id) ?? 0) + kmh);
                    speedCountByLink.set(id, (speedCountByLink.get(id) ?? 0) + 1);
                    if (id !== state.currentLinkId) {
                        state.slowAccumSec = 0;
                    }
                    if (kmh / 3.6 <= DWELL_SPEED_THRESHOLD_MPS) {
                        state.slowAccumSec += dt;
                        if (state.slowAccumSec > DWELL_GRACE_SEC) {
                            const effectiveDt = Math.min(dt, state.slowAccumSec - DWELL_GRACE_SEC);
                            dwellByLink.set(id, (dwellByLink.get(id) ?? 0) + effectiveDt * DWELL_ACCUM_FACTOR);
                        }
                    } else {
                        state.slowAccumSec = Math.max(0, state.slowAccumSec - dt * 2.5);
                    }
                }
            }
            state.lastPos = pos;
            state.lastTs = now;
            state.currentLinkId = id;
        }

        for (const [linkId] of this._emaByLink) {
            let metricValue = 0;
            if (this._metric === 'volume') {
                metricValue = countByLink.get(linkId) ?? 0;
            } else if (this._metric === 'avgSpeed') {
                const speedCount = speedCountByLink.get(linkId) ?? 0;
                metricValue = speedCount > 0 ? (speedSumByLink.get(linkId) ?? 0) / speedCount : 0;
            } else {
                metricValue = dwellByLink.get(linkId) ?? 0;
            }
            const prev  = this._emaByLink.get(linkId) ?? 0;
            this._emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + metricValue * (1 - TRAFFIC_EMA_DECAY));
        }

        // 트래픽 갱신 시 첫 프레임 강제 렌더 (애니메이션 루프 시작)
        if (this.getVisible()) this._map?.render();
    }

    public setSpeed(_v: number) {}
    public setStatus(_v: any) {}
    public setFlowMetric(metric: FlowMetric): void {
        this._metric = metric;
        this._resetRuntimeState();
    }

    public destroy(): void {
        this._settingsUnsubscribe?.();
        this._metricUnsubscribe?.();
        this.un("postrender", this._onPostRender);
        this._emaByLink.clear();
        this._vehicleStates = [];
        this._linkSegments = [];
        this._links = [];
        this._flowSource.clear();
    }
}
