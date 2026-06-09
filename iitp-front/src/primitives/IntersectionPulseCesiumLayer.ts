import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";
import { Link, Node } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

const NODE_DECAY = 0.86;
const MAX_NODE_SCORE = 14;
const BASE_HEIGHT = 2.2;
const REBUILD_INTERVAL = 2;
const NEAR_SCALE = new Cesium.NearFarScalar(300, 1.18, 6000, 0.44);
const WAITING_SPEED_THRESHOLD_MPS = 2.0;

type PulseMetric = 'incoming' | 'waiting' | 'outgoing';
type VehicleState = {
    lastPos: number[] | null;
    lastTs: number;
};

type PulseNode = {
    id: number;
    lng: number;
    lat: number;
};

type PulseBillboards = {
    glow: Cesium.PointPrimitive;
    outerRing: Cesium.PointPrimitive;
    ring: Cesium.PointPrimitive;
    core: Cesium.PointPrimitive;
    nodeId: number;
};

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function pulseColor(score: number): [number, number, number] {
    const t = Math.max(0, Math.min(1, score / MAX_NODE_SCORE));
    const c0: [number, number, number] = [42, 122, 255];
    const c1: [number, number, number] = [77, 220, 255];
    const c2: [number, number, number] = [255, 224, 92];
    const c3: [number, number, number] = [255, 188, 72];
    if (t < 0.34) {
        const k = t / 0.34;
        return [
            Math.round(lerp(c0[0], c1[0], k)),
            Math.round(lerp(c0[1], c1[1], k)),
            Math.round(lerp(c0[2], c1[2], k)),
        ];
    }
    if (t < 0.68) {
        const k = (t - 0.34) / 0.34;
        return [
            Math.round(lerp(c1[0], c2[0], k)),
            Math.round(lerp(c1[1], c2[1], k)),
            Math.round(lerp(c1[2], c2[2], k)),
        ];
    }
    const k = (t - 0.68) / 0.32;
    return [
        Math.round(lerp(c2[0], c3[0], k)),
        Math.round(lerp(c2[1], c3[1], k)),
        Math.round(lerp(c2[2], c3[2], k)),
    ];
}

export default class IntersectionPulseCesiumLayer {
    layer = "intersectionPulse";
    layerGroup = "";
    destroyed = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _linkSegments: LinkSegment[] = [];
    private _emaByLink = new Map<number, number>();
    private _incomingLinks = new Map<number, number[]>();
    private _outgoingLinks = new Map<number, number[]>();
    private _incidentLinks = new Map<number, number[]>();
    private _nodeScore = new Map<number, number>();
    private _nodes: PulseNode[] = [];
    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount = 0;
    private _points: Cesium.PointPrimitiveCollection;
    private _nodeBillboards: PulseBillboards[] = [];
    private _vehicleStates: VehicleState[] = [];
    private _metric: PulseMetric = useAnalysisSettingStore.getState().intersectionPulse.metric;
    private _metricUnsubscribe: (() => void) | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        this._points.show = val;
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._points = new Cesium.PointPrimitiveCollection();
        this._points.show = false;
        this._scene.primitives.add(this._points);
        this._buildFromStore();
        this._rebuildBillboards();
        this._metricUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.intersectionPulse.metric,
            (metric: PulseMetric) => this.setPulseMetric(metric),
        );
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links || !network?.nodes) return;

        const links = network.links as Link[];
        const nodes = network.nodes as Node[];
        this._linkSegments = buildLinkSegments(links);
        this._emaByLink.clear();
        this._incomingLinks.clear();
        this._outgoingLinks.clear();
        this._incidentLinks.clear();
        this._nodeScore.clear();
        this._nodes = [];

        for (const link of links) {
            this._emaByLink.set(link.id, 0);
            const fromList = this._outgoingLinks.get(link.fromNode) ?? [];
            fromList.push(link.id);
            this._outgoingLinks.set(link.fromNode, fromList);
            const toList = this._incomingLinks.get(link.toNode) ?? [];
            toList.push(link.id);
            this._incomingLinks.set(link.toNode, toList);
            const incidentFrom = this._incidentLinks.get(link.fromNode) ?? [];
            incidentFrom.push(link.id);
            this._incidentLinks.set(link.fromNode, incidentFrom);
            const incidentTo = this._incidentLinks.get(link.toNode) ?? [];
            incidentTo.push(link.id);
            this._incidentLinks.set(link.toNode, incidentTo);
        }

        for (const node of nodes) {
            const nodeId = Number(node.id);
            this._nodes.push({
                id: nodeId,
                lng: node.coordinates.lng,
                lat: node.coordinates.lat,
            });
            this._nodeScore.set(nodeId, 0);
        }
    }

    private _rebuildBillboards() {
        this._points.removeAll();
        this._nodeBillboards = [];

        for (const node of this._nodes) {
            const position = Cesium.Cartesian3.fromDegrees(node.lng, node.lat, BASE_HEIGHT);
            const glow = this._points.add({
                position,
                color: Cesium.Color.WHITE.withAlpha(0.0),
                pixelSize: 34,
                scaleByDistance: NEAR_SCALE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.0),
                outlineWidth: 0,
                show: false,
            });
            const outerRing = this._points.add({
                position,
                color: Cesium.Color.WHITE.withAlpha(0.0),
                pixelSize: 26,
                scaleByDistance: NEAR_SCALE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.0),
                outlineWidth: 0,
                show: false,
            });
            const ring = this._points.add({
                position,
                color: Cesium.Color.WHITE.withAlpha(0.0),
                pixelSize: 18,
                scaleByDistance: NEAR_SCALE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.0),
                outlineWidth: 0,
                show: false,
            });
            const core = this._points.add({
                position,
                color: Cesium.Color.WHITE.withAlpha(0.0),
                pixelSize: 10,
                scaleByDistance: NEAR_SCALE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.0),
                outlineWidth: 0,
                show: false,
            });
            this._nodeBillboards.push({ glow, outerRing, ring, core, nodeId: node.id });
        }
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
        this._emaByLink.forEach((_v, key) => this._emaByLink.set(key, 0));
        this._nodeScore.forEach((_v, key) => this._nodeScore.set(key, 0));
    }

    private _aggregateNodeScores(linkCounts: Map<number, number>, nodeMap: Map<number, number[]>) {
        for (const [linkId] of this._emaByLink) {
            const count = linkCounts.get(linkId) ?? 0;
            const prev = this._emaByLink.get(linkId) ?? 0;
            this._emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY));
        }

        for (const [nodeId, links] of nodeMap) {
            let sum = 0;
            for (const linkId of links) sum += this._emaByLink.get(linkId) ?? 0;
            const prev = this._nodeScore.get(nodeId) ?? 0;
            const target = sum / Math.max(1, Math.sqrt(links.length));
            this._nodeScore.set(nodeId, prev * NODE_DECAY + target * (1 - NODE_DECAY));
        }
    }

    private _updateScores(positions: (number[] | null)[]) {
        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();
        const now = Date.now();
        while (this._vehicleStates.length < positions.length) {
            this._vehicleStates.push({ lastPos: null, lastTs: now });
        }
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            if (!pos) continue;
            const state = this._vehicleStates[i]!;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const linkId = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (linkId < 0) continue;
            if (this._metric === 'incoming' || this._metric === 'outgoing') {
                countByLink.set(linkId, (countByLink.get(linkId) ?? 0) + 1);
            } else {
                const dt = Math.max(0.03, Math.min(0.35, (now - state.lastTs) / 1000));
                if (state.lastPos) {
                    const dx = pos[0] - state.lastPos[0]!;
                    const dy = pos[1] - state.lastPos[1]!;
                    const dz = pos[2] - state.lastPos[2]!;
                    const speedMps = Math.hypot(dx, dy, dz) / dt;
                    if (speedMps <= WAITING_SPEED_THRESHOLD_MPS) {
                        countByLink.set(linkId, (countByLink.get(linkId) ?? 0) + 1);
                    }
                }
                state.lastPos = pos;
                state.lastTs = now;
            }
        }

        if (this._metric === 'incoming') {
            this._aggregateNodeScores(countByLink, this._incomingLinks);
        } else if (this._metric === 'outgoing') {
            this._aggregateNodeScores(countByLink, this._outgoingLinks);
        } else {
            this._aggregateNodeScores(countByLink, this._incidentLinks);
        }
    }

    private _animateBillboards() {
        const now = Date.now();
        for (const item of this._nodeBillboards) {
            const score = this._nodeScore.get(item.nodeId) ?? 0;
            const norm = Math.max(0, Math.min(1, score / MAX_NODE_SCORE));
            const visible = this._show && score >= 0.15;
            item.glow.show = visible;
            item.outerRing.show = visible;
            item.ring.show = visible;
            item.core.show = visible;
            if (!visible) continue;

            const [r, g, b] = pulseColor(score);
            const pulse = now * 0.0026 + item.nodeId * 0.31;
            const breath = 0.82 + 0.36 * (0.5 + 0.5 * Math.sin(pulse));
            const ringPulse = 0.78 + 0.44 * (0.5 + 0.5 * Math.sin(pulse * 0.82));
            const outerPulse = 0.76 + 0.52 * (0.5 + 0.5 * Math.sin(pulse * 0.56 + 0.9));
            const corePulse = 0.84 + 0.30 * (0.5 + 0.5 * Math.sin(pulse * 1.18 + 0.45));

            item.glow.color = Cesium.Color.fromBytes(r, g, b, Math.round((0.15 + norm * 0.16) * 255));
            item.glow.pixelSize = (26 + norm * 30) * outerPulse;

            item.outerRing.color = Cesium.Color.fromBytes(r, g, b, Math.round((0.14 + norm * 0.10) * 255));
            item.outerRing.pixelSize = (20 + norm * 24) * outerPulse;

            item.ring.color = Cesium.Color.fromBytes(r, g, b, Math.round((0.30 + norm * 0.18) * 255));
            item.ring.pixelSize = (13 + norm * 18) * ringPulse;

            item.core.color = Cesium.Color.fromBytes(
                Math.min(r + 36, 255),
                Math.min(g + 36, 255),
                Math.min(b + 36, 255),
                Math.round((0.58 + norm * 0.24) * 255),
            );
            item.core.pixelSize = (7 + norm * 10) * corePulse;
        }
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        if (!this._show) return;
        this._pendingPositions = data.positions;
    }

    public setPulseMetric(metric: PulseMetric) {
        this._metric = metric;
        this._resetRuntimeState();
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    update(_frameState: any) {
        if (this.destroyed) return;
        if (!this._show) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            this._rebuildBillboards();
            return;
        }

        this._frameCount++;
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateScores(this._pendingPositions);
        }

        if (this._frameCount % REBUILD_INTERVAL === 0) {
            this._animateBillboards();
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._metricUnsubscribe?.();
        if (!this._points.isDestroyed()) this._scene.primitives.remove(this._points);
        this._emaByLink.clear();
        this._incomingLinks.clear();
        this._outgoingLinks.clear();
        this._incidentLinks.clear();
        this._nodeScore.clear();
        this._nodes = [];
        this._nodeBillboards = [];
    }
}
