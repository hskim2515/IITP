import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Icon, Style } from "ol/style";
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

const CLUSTER_ZOOM_BREAKS = [12, 14, 16];
const CLUSTER_CELL_SIZES = [0.02, 0.006, 0.002, 0];

function clusterLevelFromZoom(zoom: number): number {
    if (zoom >= CLUSTER_ZOOM_BREAKS[2]!) return 3;
    if (zoom >= CLUSTER_ZOOM_BREAKS[1]!) return 2;
    if (zoom >= CLUSTER_ZOOM_BREAKS[0]!) return 1;
    return 0;
}

function drawBadge(count: number, colors: string[], bucket: number, isCluster: boolean): HTMLCanvasElement {
    const size = isCluster ? 58 : 48;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 3;
    const bgColor = bucket > 0 ? (colors[bucket - 1] ?? "#e53935") : "#2a3a5c";

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = isCluster ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (isCluster) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.stroke();
    }

    const fontSize = count >= 1000 ? 11 : count >= 100 ? 13 : count >= 10 ? 15 : 18;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(count), cx, cy);

    return canvas;
}

function linkMidpoint(link: Link): { lng: number; lat: number } {
    const coords = link.coordinates;
    if (!coords || coords.length === 0) return { lng: 0, lat: 0 };
    if (coords.length === 1) return coords[0]!;
    const mid = (coords.length - 1) / 2;
    const lo = Math.floor(mid);
    const hi = Math.ceil(mid);
    if (lo === hi) return coords[lo]!;
    const t = mid - lo;
    return {
        lng: coords[lo]!.lng + (coords[hi]!.lng - coords[lo]!.lng) * t,
        lat: coords[lo]!.lat + (coords[hi]!.lat - coords[lo]!.lat) * t,
    };
}

interface ClusterItem {
    lng: number;
    lat: number;
    count: number;
    maxBucket: number;
    isCluster: boolean;
}

type IconBubbleVehicleType = 'ALL' | 'CAR' | 'TAXI' | 'BUS' | 'TRUCK' | 'MOTO';

export default class LinkBubbleFeatureLayer extends VectorLayer<VectorSource> {
    private bubbleSource: VectorSource;
    private map: OLMap | null;
    private links: Link[] = [];
    private linkSegments: LinkSegment[] = [];
    private emaByLink = new Map<number, number>();
    private frameCount = 0;
    private dirty = true;
    private lastClusterLevel = -1;
    private styleCache = new Map<string, Style>();
    private settingsUnsubscribe: (() => void) | null = null;
    private filterUnsubscribe: (() => void) | null = null;
    private moveEndHandler?: () => void;
    private vehicleTypeFilter: IconBubbleVehicleType = useAnalysisSettingStore.getState().iconBubble.vehicleType;

    constructor(map?: OLMap) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 700,
            declutter: true,
            updateWhileAnimating: false,
            updateWhileInteracting: false,
        });
        this.bubbleSource = source;
        this.map = map ?? null;
        this.buildFromStore();

        this.settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors],
            () => {
                this.styleCache.clear();
                this.dirty = true;
                this.rebuildFeatures();
            },
        );
        this.filterUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.iconBubble.vehicleType,
            (vehicleType: IconBubbleVehicleType) => {
                this.setVehicleTypeFilter(vehicleType);
            },
        );

        if (this.map) {
            this.moveEndHandler = () => {
                const zoom = this.map?.getView().getZoom() ?? 0;
                const level = clusterLevelFromZoom(zoom);
                if (level !== this.lastClusterLevel) {
                    this.dirty = true;
                    this.rebuildFeatures();
                }
            };
            this.map.on("moveend", this.moveEndHandler);
        }
    }

    private buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this.links = network.links as Link[];
        this.linkSegments = buildLinkSegments(this.links);
        this.emaByLink.clear();
        this.links.forEach((link) => this.emaByLink.set(link.id, 0));
        this.dirty = true;
        this.rebuildFeatures();
    }

    private ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84,
            );
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch {
            return null;
        }
    }

    private buildClusterItems(level: number): ClusterItem[] {
        const cellSize = CLUSTER_CELL_SIZES[level] ?? 0;
        if (cellSize === 0) {
            return this.links
                .map((link) => {
                    const ema = this.emaByLink.get(link.id) ?? 0;
                    const bucket = emaToBucket(ema);
                    if (bucket === 0) return null;
                    const mid = linkMidpoint(link);
                    return {
                        lng: mid.lng,
                        lat: mid.lat,
                        count: Math.max(1, Math.round(ema)),
                        maxBucket: bucket,
                        isCluster: false,
                    } satisfies ClusterItem;
                })
                .filter(Boolean) as ClusterItem[];
        }

        type Cell = { lngSum: number; latSum: number; n: number; count: number; maxBucket: number };
        const grid = new Map<string, Cell>();
        for (const link of this.links) {
            const ema = this.emaByLink.get(link.id) ?? 0;
            const bucket = emaToBucket(ema);
            if (bucket === 0) continue;
            const mid = linkMidpoint(link);
            const key = `${Math.floor(mid.lng / cellSize)},${Math.floor(mid.lat / cellSize)}`;
            if (!grid.has(key)) {
                grid.set(key, { lngSum: 0, latSum: 0, n: 0, count: 0, maxBucket: 0 });
            }
            const cell = grid.get(key)!;
            cell.lngSum += mid.lng;
            cell.latSum += mid.lat;
            cell.n += 1;
            cell.count += Math.max(1, Math.round(ema));
            cell.maxBucket = Math.max(cell.maxBucket, bucket);
        }

        return Array.from(grid.values()).map((cell) => ({
            lng: cell.lngSum / cell.n,
            lat: cell.latSum / cell.n,
            count: cell.count,
            maxBucket: cell.maxBucket,
            isCluster: cell.n > 1,
        }));
    }

    private getStyle(count: number, bucket: number, isCluster: boolean): Style {
        const cacheKey = `${count}:${bucket}:${isCluster ? 1 : 0}`;
        const cached = this.styleCache.get(cacheKey);
        if (cached) return cached;

        const { colors } = useHeatmapSettingStore.getState();
        const style = new Style({
            image: new Icon({
                img: drawBadge(count, colors, bucket, isCluster),
                imgSize: isCluster ? [58, 58] : [48, 48],
                anchor: [0.5, 0.5],
                anchorXUnits: "fraction",
                anchorYUnits: "fraction",
            }),
        });
        this.styleCache.set(cacheKey, style);
        return style;
    }

    private rebuildFeatures() {
        if (!this.dirty) return;
        const zoom = this.map?.getView().getZoom() ?? 0;
        const level = clusterLevelFromZoom(zoom);
        this.lastClusterLevel = level;
        this.bubbleSource.clear();

        const features = this.buildClusterItems(level).map((item, idx) => {
            const feature = new Feature(new Point(fromLonLat([item.lng, item.lat])));
            feature.setId(`bubble-${level}-${idx}`);
            feature.setStyle(this.getStyle(item.count, item.maxBucket, item.isCluster));
            return feature;
        });
        this.bubbleSource.addFeatures(features);
        this.dirty = false;
    }

    public setLatestPositions(data: { positions: (number[] | null)[]; types?: string[] }) {
        if (!this.getVisible()) return;
        if (this.linkSegments.length === 0) {
            this.buildFromStore();
            return;
        }
        if (!data?.positions) return;
        this.frameCount++;
        if (this.frameCount % TRAFFIC_UPDATE_INTERVAL !== 0) return;

        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();
        for (let i = 0; i < data.positions.length; i++) {
            const pos = data.positions[i];
            if (!pos) continue;
            const vehicleType = String(data.types?.[i] ?? 'CAR').toUpperCase();
            if (this.vehicleTypeFilter !== 'ALL' && vehicleType !== this.vehicleTypeFilter) continue;
            const ol = this.ecefToOl(pos);
            if (!ol) continue;
            const id = findNearestLink(ol[0]!, ol[1]!, this.linkSegments, snapDist2);
            if (id < 0) continue;
            countByLink.set(id, (countByLink.get(id) ?? 0) + 1);
        }

        for (const [linkId] of this.emaByLink) {
            const count = countByLink.get(linkId) ?? 0;
            const prev = this.emaByLink.get(linkId) ?? 0;
            this.emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY));
        }

        this.dirty = true;
        this.rebuildFeatures();
    }

    public setVehicleTypeFilter(vehicleType: IconBubbleVehicleType) {
        this.vehicleTypeFilter = vehicleType;
        this.emaByLink.forEach((_v, key) => this.emaByLink.set(key, 0));
        this.frameCount = 0;
        this.dirty = true;
        this.rebuildFeatures();
    }

    public setSpeed(_v: number) {}
    public setStatus(_v: any) {}

    public destroy() {
        this.settingsUnsubscribe?.();
        this.filterUnsubscribe?.();
        if (this.map && this.moveEndHandler) {
            this.map.un("moveend", this.moveEndHandler);
        }
        this.styleCache.clear();
        this.emaByLink.clear();
        this.linkSegments = [];
        this.links = [];
        this.bubbleSource.clear();
    }
}
