import * as Cesium from "cesium";
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
const REBUILD_MIN_MS = 1400;
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

function cesiumColorForBucket(bucket: number, colors: string[]): Cesium.Color {
    if (bucket === 0) return Cesium.Color.fromCssColorString("#aaaaaa").withAlpha(0.15);
    const hex = colors[Math.min(bucket - 1, colors.length - 1)] ?? "#ff2200";
    return Cesium.Color.fromCssColorString(hex).withAlpha(0.92);
}

export default class DwellTimeCesiumLayer {
    layer = "";
    layerGroup = "";
    destroyed = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private _linkSegments: LinkSegment[] = [];
    private _scoreByLink = new Map<number, number>();
    private _vehicleStates: VehicleState[] = [];
    private _bucketPrimitives: (Cesium.GroundPolylinePrimitive | null)[] = new Array(5).fill(null);
    private _glowPrimitives: (Cesium.GroundPolylinePrimitive | null)[] = new Array(5).fill(null);
    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount = 0;
    private _needsRebuild = false;
    private _lastRebuildTime = 0;
    private _settingsUnsubscribe: (() => void) | null = null;
    private _metricUnsubscribe: (() => void) | null = null;
    private _recentSnapshots: PositionSnapshot[] = [];

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        for (const p of this._bucketPrimitives) {
            if (p) p.show = val;
        }
        for (const p of this._glowPrimitives) {
            if (p) p.show = val;
        }
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._buildFromStore();
        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors, s.exaggeration],
            () => {
                this._needsRebuild = true;
                this._lastRebuildTime = 0;
            },
        );
        this._metricUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.dwellTime.metric,
            () => {
                this._resetRuntimeState();
                this._replayRecentSnapshots();
                this._needsRebuild = true;
                this._lastRebuildTime = 0;
            },
        );
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._links = network.links as Link[];
        this._linkSegments = buildLinkSegments(this._links);
        this._scoreByLink.clear();
        this._links.forEach((l) => this._scoreByLink.set(l.id, 0));
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

    private _rebuildPrimitives() {
        const { colors, exaggeration } = useHeatmapSettingStore.getState();
        const bucketPositions: Cesium.Cartesian3[][][] = Array.from({ length: 5 }, () => []);
        const glowPositions: Cesium.Cartesian3[][][] = Array.from({ length: 5 }, () => []);

        for (const link of this._links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const score = this._scoreByLink.get(link.id) ?? 0;
            const bucket = dwellToBucket(score);
            if (bucket === 0) continue;
            const positions = link.coordinates.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            bucketPositions[bucket]!.push(positions);
            if (bucket >= 2) {
                glowPositions[bucket]!.push(positions);
            }
        }

        for (let b = 1; b < 5; b++) {
            const old = this._bucketPrimitives[b];
            if (old && !old.isDestroyed()) this._scene.primitives.remove(old);
            this._bucketPrimitives[b] = null;
            const oldGlow = this._glowPrimitives[b];
            if (oldGlow && !oldGlow.isDestroyed()) this._scene.primitives.remove(oldGlow);
            this._glowPrimitives[b] = null;

            const list = bucketPositions[b]!;
            if (list.length === 0) continue;

            const width = (DWELL_BUCKET_WIDTHS[b] ?? 3) * exaggeration;
            const color = cesiumColorForBucket(b, colors);
            const instances = list.map((positions) => new Cesium.GeometryInstance({
                geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
            }));

            const primitive = new Cesium.GroundPolylinePrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PolylineMaterialAppearance({
                    material: Cesium.Material.fromType("Color", { color }),
                }),
                show: this._show,
            });
            this._scene.primitives.add(primitive);
            this._bucketPrimitives[b] = primitive;

            const glowList = glowPositions[b]!;
            if (glowList.length > 0) {
                const glowColor = color.withAlpha(0.12 + b * 0.03);
                const glowInstances = glowList.map((positions) => new Cesium.GeometryInstance({
                    geometry: new Cesium.GroundPolylineGeometry({
                        positions,
                        width: width * (2.4 + b * 0.12),
                    }),
                }));
                const glowPrimitive = new Cesium.GroundPolylinePrimitive({
                    geometryInstances: glowInstances,
                    appearance: new Cesium.PolylineMaterialAppearance({
                        material: Cesium.Material.fromType("Color", { color: glowColor }),
                    }),
                    show: this._show,
                });
                this._scene.primitives.add(glowPrimitive);
                this._glowPrimitives[b] = glowPrimitive;
            }
        }
    }

    private _updateScores(positions: (number[] | null)[]) {
        const now = Date.now();
        const metric = useAnalysisSettingStore.getState().dwellTime.metric as DwellMetric;
        this._pushSnapshot(positions, now);
        this._applySnapshot(positions, now, metric);
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        if (!this._show) return;
        this._pendingPositions = data.positions;
    }

    public setSpeed(_v: number) {}
    public setStatus(_v: any) {}

    update(_frameState: any) {
        if (this.destroyed) return;
        if (!this._show) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }

        this._frameCount++;
        if (this._frameCount % DWELL_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateScores(this._pendingPositions);
            this._needsRebuild = true;
        }

        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            this._rebuildPrimitives();
            this._lastRebuildTime = now;
            this._needsRebuild = false;
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._settingsUnsubscribe?.();
        this._metricUnsubscribe?.();
        for (let b = 0; b < 5; b++) {
            const p = this._bucketPrimitives[b];
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
            const glow = this._glowPrimitives[b];
            if (glow && !glow.isDestroyed()) this._scene.primitives.remove(glow);
        }
        this._bucketPrimitives = new Array(5).fill(null);
        this._glowPrimitives = new Array(5).fill(null);
        this._scoreByLink.clear();
        this._vehicleStates = [];
        this._recentSnapshots = [];
    }
}
