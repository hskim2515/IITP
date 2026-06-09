import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { Map as OLMap } from "ol";
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
const WAITING_SPEED_THRESHOLD_MPS = 2.0;

type PulseMetric = 'incoming' | 'waiting' | 'outgoing';
type VehicleState = {
    lastPos: number[] | null;
    lastTs: number;
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

export default class IntersectionPulseFeatureLayer extends VectorLayer<VectorSource> {
    private readonly _source: VectorSource;
    private readonly _map: OLMap | null;
    private _frameCount = 0;
    private _linkSegments: LinkSegment[] = [];
    private _emaByLink = new Map<number, number>();
    private _incomingLinks = new Map<number, number[]>();
    private _outgoingLinks = new Map<number, number[]>();
    private _incidentLinks = new Map<number, number[]>();
    private _nodeScore = new Map<number, number>();
    private _vehicleStates: VehicleState[] = [];
    private _metric: PulseMetric = useAnalysisSettingStore.getState().intersectionPulse.metric;
    private _metricUnsubscribe: (() => void) | null = null;

    constructor(map?: OLMap) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 720,
            style: (feature) => this._styleForFeature(feature as Feature<Point>),
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this._source = source;
        this._map = map ?? null;
        this._buildFromStore();
        this.on("postrender", this._onPostRender);
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

        this._source.clear();
        const features: Feature<Point>[] = [];
        for (const node of nodes) {
            const coord = fromLonLat([node.coordinates.lng, node.coordinates.lat]);
            const nodeId = Number(node.id);
            const feature = new Feature<Point>(new Point(coord));
            feature.setId(`pulse-node-${nodeId}`);
            feature.set("nodeId", nodeId);
            features.push(feature);
            this._nodeScore.set(nodeId, 0);
        }
        this._source.addFeatures(features);
    }

    private _styleForFeature(feature: Feature<Point>): Style | null {
        const nodeId = feature.get("nodeId") as number | undefined;
        if (nodeId == null) return null;

        return new Style({
            renderer: (pixelCoordinates: any, state: any) => {
                const point = Array.isArray(pixelCoordinates?.[0]) ? pixelCoordinates[0] : pixelCoordinates;
                if (!Array.isArray(point) || point.length < 2) return;

                const ctx = state.context as CanvasRenderingContext2D | undefined;
                if (!ctx) return;

                const score = this._nodeScore.get(nodeId) ?? 0;
                if (score < 0.15) return;

                const [r, g, b] = pulseColor(score);
                const zoom = this._map?.getView().getZoom() ?? 0;
                const zoomScale = Math.max(0.72, Math.min(1.3, 0.78 + (zoom - 12) * 0.08));
                const pulse = Date.now() * 0.0026 + nodeId * 0.31;
                const breath = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(pulse));
                const norm = Math.max(0, Math.min(1, score / MAX_NODE_SCORE));
                const coreR = (2.9 + norm * 4.4) * zoomScale * breath;
                const ringR = coreR + 4.1 + norm * 8.2 + Math.sin(pulse * 0.8) * 0.9;
                const outerR = ringR + 3.3 + norm * 5.6;
                const x = point[0]!;
                const y = point[1]!;

                ctx.save();
                ctx.globalCompositeOperation = "screen";

                ctx.beginPath();
                ctx.fillStyle = `rgba(${r},${g},${b},${0.10 + norm * 0.10})`;
                ctx.arc(x, y, outerR, 0, Math.PI * 2);
                ctx.fill();

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${r},${g},${b},${0.18 + norm * 0.16})`;
                ctx.lineWidth = 1.5;
                ctx.arc(x, y, ringR, 0, Math.PI * 2);
                ctx.stroke();

                ctx.beginPath();
                ctx.strokeStyle = `rgba(255,255,255,${0.12 + norm * 0.12})`;
                ctx.lineWidth = 1.0;
                ctx.arc(x, y, outerR - 2.2, 0, Math.PI * 2);
                ctx.stroke();

                ctx.beginPath();
                ctx.fillStyle = `rgba(${Math.min(r + 36, 255)},${Math.min(g + 36, 255)},${Math.min(b + 36, 255)},${0.50 + norm * 0.34})`;
                ctx.arc(x, y, coreR, 0, Math.PI * 2);
                ctx.fill();

                ctx.beginPath();
                ctx.strokeStyle = `rgba(255,255,255,${0.20 + norm * 0.20})`;
                ctx.lineWidth = 1.0;
                ctx.arc(x, y, coreR + 1.1, 0, Math.PI * 2);
                ctx.stroke();

                ctx.restore();
            },
        });
    }

    private readonly _onPostRender = () => {
        if (this.getVisible()) this._map?.render();
    };

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
        this._source.changed();
        if (this.getVisible()) this._map?.render();
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

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        if (!this.getVisible()) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }
        if (!data?.positions) return;

        this._frameCount++;
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL !== 0) return;

        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();
        const now = Date.now();
        while (this._vehicleStates.length < data.positions.length) {
            this._vehicleStates.push({ lastPos: null, lastTs: now });
        }

        for (let i = 0; i < data.positions.length; i++) {
            const pos = data.positions[i];
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

        this._source.changed();
        if (this.getVisible()) this._map?.render();
    }

    public setPulseMetric(metric: PulseMetric) {
        this._metric = metric;
        this._resetRuntimeState();
    }

    public setSpeed(_v: number) {}
    public setStatus(_v: any) {}

    public destroy() {
        this._metricUnsubscribe?.();
        this.un("postrender", this._onPostRender);
        this._source.clear();
        this._linkSegments = [];
        this._emaByLink.clear();
        this._incomingLinks.clear();
        this._outgoingLinks.clear();
        this._incidentLinks.clear();
        this._nodeScore.clear();
    }
}
