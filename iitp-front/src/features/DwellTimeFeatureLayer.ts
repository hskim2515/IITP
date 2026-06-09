import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_SNAP_DIST_M,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

const DWELL_SPEED_THRESHOLD_MPS = 2.0;
const DWELL_MIN_DT_SEC = 0.03;
const DWELL_MAX_DT_SEC = 0.35;
const DWELL_DECAY_PER_SEC = 0.986;
const DWELL_UPDATE_INTERVAL = 2;
const DWELL_GRACE_SEC = 10;
const DWELL_ACCUM_FACTOR = 0.35;
const STOPPED_SPEED_THRESHOLD_MPS = 0.6;
const RESUME_SPEED_THRESHOLD_MPS = 2.8;
const STOP_GO_MIN_STOP_SEC = 2.5;
const SLOW_COUNT_ACCUM_FACTOR = 1.1;
const STOP_GO_SCORE = 7.5;
const DWELL_BUCKET_WIDTHS = [1.2, 3, 5, 7, 9];
const METRIC_REPLAY_WINDOW_MS = 8000;
const METRIC_REPLAY_MAX_FRAMES = 120;

type DwellMetric = 'dwell' | 'slowCount' | 'stopGo';
type PositionSnapshot = {
    positions: (number[] | null)[];
    capturedAt: number;
};

type VehicleState = {
    lastPos: number[] | null;
    lastTs: number;
    currentLinkId: number;
    slowAccumSec: number;
    stoppedAccumSec: number;
    pendingStopGo: boolean;
};

function dwellToBucket(score: number): number {
    if (score < 4) return 0;
    if (score < 12) return 1;
    if (score < 28) return 2;
    if (score < 52) return 3;
    return 4;
}

function hexToRgb(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

export default class DwellTimeFeatureLayer extends VectorLayer<VectorSource> {
    private readonly _source: VectorSource;
    private _linkSegments: LinkSegment[] = [];
    private _lineFeatureByLink = new Map<number, Feature<LineString>>();
    private _scoreByLink = new Map<number, number>();
    private _vehicleStates: VehicleState[] = [];
    private _frameCount = 0;
    private _settingsUnsubscribe: (() => void) | null = null;
    private _metricUnsubscribe: (() => void) | null = null;
    private _recentSnapshots: PositionSnapshot[] = [];

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 118,
            style: (feature) => this._styleForFeature(feature as Feature<any>),
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this._source = source;
        this._buildFromStore();

        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors, s.exaggeration],
            () => this._source.changed(),
        );
        this._metricUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.dwellTime.metric,
            () => {
                this._resetRuntimeState();
                this._replayRecentSnapshots();
                this._source.changed();
            },
        );
    }

    private _styleForFeature(feature: Feature<any>): Style | null {
        const linkId = feature.get("linkId") as number;
        const score = this._scoreByLink.get(linkId) ?? 0;
        const bucket = dwellToBucket(score);
        const { colors, exaggeration } = useHeatmapSettingStore.getState();
        if (bucket === 0) {
            return new Style({
                stroke: new Stroke({ color: "rgba(150,150,150,0.18)", width: 1.2 }),
            });
        }

        const hex = colors[Math.min(bucket - 1, colors.length - 1)] ?? "#ff2200";
        const [r, g, b] = hexToRgb(hex);
        const width = (DWELL_BUCKET_WIDTHS[bucket] ?? 3) * exaggeration;
        const norm = Math.max(0, Math.min(1, score / 52));

        return new Style({
            renderer: (pixelCoordinates: any, state: any) => {
                const coords = pixelCoordinates as number[][];
                const ctx = state.context as CanvasRenderingContext2D | undefined;
                if (!ctx || !Array.isArray(coords) || coords.length < 2) return;

                const drift = Date.now() * 0.0012 + linkId * 0.11;
                const swell = 0.94 + 0.08 * (0.5 + 0.5 * Math.sin(drift));
                const glowWidth = (width * (2.8 + norm * 1.8)) * swell;
                const midWidth = width * (1.7 + norm * 0.8);
                const coreWidth = width * (0.9 + norm * 0.35);

                const drawPath = () => {
                    ctx.beginPath();
                    ctx.moveTo(coords[0]![0]!, coords[0]![1]!);
                    for (let i = 1; i < coords.length; i++) {
                        ctx.lineTo(coords[i]![0]!, coords[i]![1]!);
                    }
                };

                ctx.save();
                ctx.globalCompositeOperation = "screen";
                ctx.lineCap = "round";
                ctx.lineJoin = "round";

                drawPath();
                ctx.strokeStyle = `rgba(${r},${g},${b},${0.08 + norm * 0.07})`;
                ctx.lineWidth = glowWidth;
                ctx.stroke();

                drawPath();
                ctx.strokeStyle = `rgba(${r},${g},${b},${0.16 + norm * 0.12})`;
                ctx.lineWidth = midWidth;
                ctx.stroke();

                drawPath();
                ctx.strokeStyle = `rgba(${Math.min(r + 22, 255)},${Math.min(g + 22, 255)},${Math.min(b + 22, 255)},${0.52 + norm * 0.16})`;
                ctx.lineWidth = coreWidth;
                ctx.stroke();

                ctx.restore();
            },
        });
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._buildLinks(network.links as Link[]);
    }

    private _buildLinks(links: Link[]) {
        this._source.clear();
        this._linkSegments = buildLinkSegments(links);
        this._lineFeatureByLink.clear();
        this._scoreByLink.clear();

        const features: Feature<any>[] = [];
        for (const seg of this._linkSegments) {
            const lineFeature = new Feature<LineString>(new LineString(seg.coords));
            lineFeature.setId(`dwell-${seg.linkId}`);
            lineFeature.set("linkId", seg.linkId);
            lineFeature.set("featureType", "line");

            this._lineFeatureByLink.set(seg.linkId, lineFeature);
            this._scoreByLink.set(seg.linkId, 0);
            features.push(lineFeature);
        }
        this._source.addFeatures(features);
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

    private _resetRuntimeState() {
        this._frameCount = 0;
        this._vehicleStates = [];
        for (const [linkId] of this._scoreByLink) {
            this._scoreByLink.set(linkId, 0);
        }
    }

    private _pushSnapshot(positions: (number[] | null)[], capturedAt: number) {
        this._recentSnapshots.push({
            positions: positions.map((pos) => (pos ? [...pos] : null)),
            capturedAt,
        });
        const cutoff = capturedAt - METRIC_REPLAY_WINDOW_MS;
        this._recentSnapshots = this._recentSnapshots.filter((snapshot) => snapshot.capturedAt >= cutoff);
        if (this._recentSnapshots.length > METRIC_REPLAY_MAX_FRAMES) {
            this._recentSnapshots.splice(0, this._recentSnapshots.length - METRIC_REPLAY_MAX_FRAMES);
        }
    }

    private _replayRecentSnapshots() {
        if (this._recentSnapshots.length === 0) return;
        const metric = useAnalysisSettingStore.getState().dwellTime.metric as DwellMetric;
        for (const snapshot of this._recentSnapshots) {
            this._applySnapshot(snapshot.positions, snapshot.capturedAt, metric);
        }
    }

    private _applySnapshot(positions: (number[] | null)[], now: number, metric: DwellMetric) {
        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;

        while (this._vehicleStates.length < positions.length) {
            this._vehicleStates.push({
                lastPos: null,
                lastTs: now,
                currentLinkId: -1,
                slowAccumSec: 0,
                stoppedAccumSec: 0,
                pendingStopGo: false,
            });
        }

        for (const [linkId, prev] of this._scoreByLink) {
            this._scoreByLink.set(linkId, prev * DWELL_DECAY_PER_SEC);
        }

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const state = this._vehicleStates[i]!;

            if (!pos) {
                state.lastPos = null;
                state.lastTs = now;
                state.currentLinkId = -1;
                state.slowAccumSec = 0;
                state.stoppedAccumSec = 0;
                state.pendingStopGo = false;
                continue;
            }

            const dt = Math.max(DWELL_MIN_DT_SEC, Math.min(DWELL_MAX_DT_SEC, (now - state.lastTs) / 1000));
            const ol = this._ecefToOl(pos);
            if (!ol) {
                state.lastPos = pos;
                state.lastTs = now;
                state.currentLinkId = -1;
                state.slowAccumSec = 0;
                state.stoppedAccumSec = 0;
                state.pendingStopGo = false;
                continue;
            }

            const linkId = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (linkId < 0 || linkId !== state.currentLinkId) {
                state.slowAccumSec = 0;
                state.stoppedAccumSec = 0;
                state.pendingStopGo = false;
            }

            if (state.lastPos && linkId >= 0 && linkId === state.currentLinkId) {
                const dx = pos[0] - state.lastPos[0]!;
                const dy = pos[1] - state.lastPos[1]!;
                const dz = pos[2] - state.lastPos[2]!;
                const speedMps = Math.hypot(dx, dy, dz) / dt;
                if (metric === 'dwell') {
                    if (speedMps <= DWELL_SPEED_THRESHOLD_MPS) {
                        state.slowAccumSec += dt;
                        if (state.slowAccumSec > DWELL_GRACE_SEC) {
                            const effectiveDt = Math.min(dt, state.slowAccumSec - DWELL_GRACE_SEC);
                            this._scoreByLink.set(
                                linkId,
                                (this._scoreByLink.get(linkId) ?? 0) + effectiveDt * DWELL_ACCUM_FACTOR,
                            );
                        }
                    } else {
                        state.slowAccumSec = Math.max(0, state.slowAccumSec - dt * 2.5);
                    }
                } else if (metric === 'slowCount') {
                    if (speedMps <= DWELL_SPEED_THRESHOLD_MPS) {
                        this._scoreByLink.set(
                            linkId,
                            (this._scoreByLink.get(linkId) ?? 0) + dt * SLOW_COUNT_ACCUM_FACTOR,
                        );
                    }
                } else if (metric === 'stopGo') {
                    if (speedMps <= STOPPED_SPEED_THRESHOLD_MPS) {
                        state.stoppedAccumSec += dt;
                        if (state.stoppedAccumSec >= STOP_GO_MIN_STOP_SEC) {
                            state.pendingStopGo = true;
                        }
                    } else if (speedMps >= RESUME_SPEED_THRESHOLD_MPS) {
                        if (state.pendingStopGo) {
                            this._scoreByLink.set(
                                linkId,
                                (this._scoreByLink.get(linkId) ?? 0) + STOP_GO_SCORE,
                            );
                        }
                        state.stoppedAccumSec = 0;
                        state.pendingStopGo = false;
                    }
                }
            }

            state.lastPos = pos;
            state.lastTs = now;
            state.currentLinkId = linkId;
        }
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        if (!this.getVisible()) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }
        if (!data?.positions) return;

        this._frameCount++;
        if (this._frameCount % DWELL_UPDATE_INTERVAL !== 0) return;

        const now = Date.now();
        const metric = useAnalysisSettingStore.getState().dwellTime.metric as DwellMetric;
        this._pushSnapshot(data.positions, now);
        this._applySnapshot(data.positions, now, metric);
        this._source.changed();
    }

    public setSpeed(_s: number) {}
    public setStatus(_s: any) {}

    public destroy() {
        this._settingsUnsubscribe?.();
        this._metricUnsubscribe?.();
        this._source.clear();
        this._linkSegments = [];
        this._lineFeatureByLink.clear();
        this._scoreByLink.clear();
        this._vehicleStates = [];
        this._recentSnapshots = [];
    }
}
