import * as Cesium from "cesium";
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
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";

const BADGE_SIZE_IND  = 54;
const BADGE_SIZE_CLU  = 64;
const BADGE_HEIGHT_ABOVE = 14;
const BUBBLE_FLOAT_AMP   = 4; // 부유 진폭 (px)
const REBUILD_MIN_MS     = 1200;

// ── 클러스터 레벨 (카메라 높이 기준) ──────────────────────────
// level 0 = 개별, 1~3 = 격자 클러스터
const CLUSTER_HEIGHT_BREAKS = [2500, 7000, 18000]; // m
const CLUSTER_CELL_SIZES    = [0, 0.002, 0.006, 0.02]; // degrees

function clusterLevelFromHeight(height: number): number {
    for (let i = 0; i < CLUSTER_HEIGHT_BREAKS.length; i++) {
        if (height < CLUSTER_HEIGHT_BREAKS[i]!) return i;
    }
    return CLUSTER_HEIGHT_BREAKS.length;
}

function drawBadge(
    count: number,
    colors: string[],
    bucket: number,
    isCluster: boolean,
): string {
    const size = isCluster ? BADGE_SIZE_CLU : BADGE_SIZE_IND;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 2;
    const bgColor = bucket > 0 ? (colors[bucket - 1] ?? "#e53935") : "#2a3a5c";

    ctx.shadowColor = "rgba(0,0,0,0.52)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx - size * 0.12, cy - size * 0.14, r * 0.46, 0, Math.PI * 2);
    ctx.fill();

    if (isCluster) {
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r - 0.8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.24)";
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3.8, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeStyle = "rgba(255,255,255,0.78)";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
        ctx.stroke();
    }

    const fontSize = count >= 1000 ? 12 : count >= 100 ? 14 : count >= 10 ? 17 : 20;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(count), cx, cy);

    return canvas.toDataURL();
}

// ── 링크 중간점 보간 ────────────────────────────────────────
function linkMidpoint(link: Link): { lng: number; lat: number } {
    const coords = link.coordinates;
    if (!coords || coords.length === 0) return { lng: 0, lat: 0 };
    if (coords.length === 1) return coords[0]!;
    const mid = (coords.length - 1) / 2;
    const lo  = Math.floor(mid);
    const hi  = Math.ceil(mid);
    if (lo === hi) return coords[lo]!;
    const t = mid - lo;
    return {
        lng: coords[lo]!.lng + (coords[hi]!.lng - coords[lo]!.lng) * t,
        lat: coords[lo]!.lat + (coords[hi]!.lat - coords[lo]!.lat) * t,
    };
}

// ── 클러스터 집계 결과 타입 ──────────────────────────────────
interface ClusterItem {
    lng: number;
    lat: number;
    count: number;
    maxBucket: number;
    isCluster: boolean;
}

type IconBubbleVehicleType = 'ALL' | 'CAR' | 'TAXI' | 'BUS' | 'TRUCK' | 'MOTO';

type BubblePrimitiveSet = {
    badge: Cesium.Billboard;
};

/**
 * 링크별 차량 대수 배지 레이어.
 * 줌 아웃 시 격자 클러스터링, 줌 인 시 개별 링크 표시.
 */
export default class LinkBubbleCesiumLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private _linkSegments: LinkSegment[] = [];
    private _emaByLink    = new Map<number, number>();
    private _billboardCollection: Cesium.BillboardCollection | null = null;
    private _allBubbles: BubblePrimitiveSet[] = [];
    private _badgeCanvasCache = new Map<string, string>();
    private _pendingPositions: (number[] | null)[] | null = null;
    private _pendingTypes: string[] | undefined;
    private _frameCount     = 0;
    private _needsRebuild   = false;
    private _lastRebuildTime = 0;
    private _lastClusterLevel = -1;
    private _settingsUnsubscribe: (() => void) | null = null;
    private _filterUnsubscribe: (() => void) | null = null;
    private _hasBuiltOnce = false;
    private _vehicleTypeFilter: IconBubbleVehicleType = useAnalysisSettingStore.getState().iconBubble.vehicleType;

    get show() { return this._show; }
    set show(val: boolean) {
        const wasHidden = !this._show && val;
        this._show = val;
        if (this._billboardCollection) this._billboardCollection.show = val;
        if (wasHidden && this._linkSegments.length > 0) {
            this._needsRebuild = true;
            this._lastRebuildTime = 0;
            this._rebuildBillboards();
            this._needsRebuild = false;
            this._hasBuiltOnce = true;
        }
        try { this._scene.requestRender(); } catch (_) {}
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._billboardCollection = new Cesium.BillboardCollection({ scene: viewer.scene });
        this._billboardCollection.show = false;
        this._scene.primitives.add(this._billboardCollection);
        this._buildFromStore();

        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors],
            () => { this._needsRebuild = true; this._lastRebuildTime = 0; },
        );
        this._filterUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.iconBubble.vehicleType,
            (vehicleType: IconBubbleVehicleType) => {
                this.setVehicleTypeFilter(vehicleType);
            },
        );
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
                      ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._links        = network.links as Link[];
        this._linkSegments = buildLinkSegments(this._links);
        this._emaByLink.clear();
        this._links.forEach(l => this._emaByLink.set(l.id, 0));
        this._needsRebuild = true;
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84,
            );
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch { return null; }
    }

    private _updateEMA(positions: (number[] | null)[], types?: string[]) {
        const snapDist2   = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            if (!pos) continue;
            const vehicleType = String(types?.[i] ?? 'CAR').toUpperCase();
            if (this._vehicleTypeFilter !== 'ALL' && vehicleType !== this._vehicleTypeFilter) continue;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const id = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (id < 0) continue;
            countByLink.set(id, (countByLink.get(id) ?? 0) + 1);
        }
        for (const [linkId] of this._emaByLink) {
            const count = countByLink.get(linkId) ?? 0;
            const prev  = this._emaByLink.get(linkId) ?? 0;
            this._emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY));
        }
    }

    // ── 클러스터/개별 집계 ────────────────────────────────────
    private _buildClusterItems(level: number): ClusterItem[] {
        const cellSize = CLUSTER_CELL_SIZES[level] ?? 0;

        if (cellSize === 0) {
            // 개별 모드
            const items: ClusterItem[] = [];
            for (const link of this._links) {
                const ema    = this._emaByLink.get(link.id) ?? 0;
                const bucket = emaToBucket(ema);
                if (bucket === 0) continue;
                const mid = linkMidpoint(link);
                items.push({
                    lng: mid.lng, lat: mid.lat,
                    count: Math.max(1, Math.round(ema)),
                    maxBucket: bucket,
                    isCluster: false,
                });
            }
            return items;
        }

        // 격자 클러스터 모드
        type Cell = { lngSum: number; latSum: number; n: number; count: number; maxBucket: number };
        const grid = new Map<string, Cell>();

        for (const link of this._links) {
            const ema    = this._emaByLink.get(link.id) ?? 0;
            const bucket = emaToBucket(ema);
            if (bucket === 0) continue;
            const mid = linkMidpoint(link);
            const key = `${Math.floor(mid.lng / cellSize)},${Math.floor(mid.lat / cellSize)}`;
            if (!grid.has(key)) {
                grid.set(key, { lngSum: 0, latSum: 0, n: 0, count: 0, maxBucket: 0 });
            }
            const cell = grid.get(key)!;
            cell.lngSum   += mid.lng;
            cell.latSum   += mid.lat;
            cell.n        += 1;
            cell.count    += Math.max(1, Math.round(ema));
            cell.maxBucket = Math.max(cell.maxBucket, bucket);
        }

        return Array.from(grid.values()).map(c => ({
            lng:       c.lngSum / c.n,
            lat:       c.latSum / c.n,
            count:     c.count,
            maxBucket: c.maxBucket,
            isCluster: c.n > 1,
        }));
    }

    private _rebuildBillboards() {
        if (!this._billboardCollection) return;
        const { colors } = useHeatmapSettingStore.getState();
        const height = this._scene.camera.positionCartographic.height;
        const level  = clusterLevelFromHeight(height);
        this._lastClusterLevel = level;

        const items = this._buildClusterItems(level);

        while (this._allBubbles.length < items.length) {
            const badge = this._billboardCollection.add({
                position:         Cesium.Cartesian3.fromDegrees(0, 0, BADGE_HEIGHT_ABOVE),
                image:            drawBadge(1, colors, 1, false),
                heightReference:  Cesium.HeightReference.RELATIVE_TO_GROUND,
                verticalOrigin:   Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                scaleByDistance:  new Cesium.NearFarScalar(300, 1.12, 4500, 0.62),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                pixelOffset:      Cesium.Cartesian2.ZERO,
                show: false,
            });
            this._allBubbles.push({ badge });
        }

        for (let i = 0; i < this._allBubbles.length; i++) {
            const bubble = this._allBubbles[i]!;
            const item = items[i];
            if (!item) {
                bubble.badge.show = false;
                continue;
            }

            const pos = Cesium.Cartesian3.fromDegrees(item.lng, item.lat, BADGE_HEIGHT_ABOVE);

            bubble.badge.show = this._show;

            bubble.badge.position = pos;
            bubble.badge.image = this._getBadgeCanvas(item.count, colors, item.maxBucket, item.isCluster);
            bubble.badge.scale = item.isCluster ? 1.06 : 1.0;
            bubble.badge.pixelOffset = Cesium.Cartesian2.ZERO;
        }
        this._hasBuiltOnce = true;
        try { this._scene.requestRender(); } catch (_) {}
    }

    private _getBadgeCanvas(count: number, colors: string[], bucket: number, isCluster: boolean): string {
        const cacheKey = `${count}:${bucket}:${isCluster ? 1 : 0}:${colors.join(",")}`;
        const cached = this._badgeCanvasCache.get(cacheKey);
        if (cached) return cached;
        const canvas = drawBadge(count, colors, bucket, isCluster);
        this._badgeCanvasCache.set(cacheKey, canvas);
        return canvas;
    }

    public setLatestPositions(data: { positions: (number[] | null)[]; types?: string[] }) {
        if (!this._show) return;
        this._pendingPositions = data.positions;
        this._pendingTypes = data.types;
    }

    public setVehicleTypeFilter(vehicleType: IconBubbleVehicleType) {
        this._vehicleTypeFilter = vehicleType;
        this._emaByLink.forEach((_v, key) => this._emaByLink.set(key, 0));
        this._frameCount = 0;
        this._needsRebuild = true;
        this._lastRebuildTime = 0;
        this._hasBuiltOnce = false;
        if (this._show) {
            this._rebuildBillboards();
            this._needsRebuild = false;
        }
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    update(_frameState: any) {
        if (this.destroyed) return;
        if (!this._show) return;
        if (this._linkSegments.length === 0) { this._buildFromStore(); return; }

        this._frameCount++;

        // EMA 갱신
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions, this._pendingTypes);
            this._needsRebuild = true;
            if (this._show && !this._hasBuiltOnce) {
                this._rebuildBillboards();
                this._needsRebuild = false;
            }
        }

        // 클러스터 레벨 변경 감지 → 즉시 재빌드
        const height = this._scene.camera.positionCartographic.height;
        const level  = clusterLevelFromHeight(height);
        if (level !== this._lastClusterLevel) {
            this._needsRebuild   = true;
            this._lastRebuildTime = 0;
        }

        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            this._rebuildBillboards();
            this._lastRebuildTime = now;
            this._needsRebuild    = false;
        }

        // 부유 애니메이션 (4프레임마다)
        if (this._frameCount % 4 === 0 && this._allBubbles.length > 0) {
            const floatY = Math.sin(Date.now() * 0.0022) * BUBBLE_FLOAT_AMP;
            const offset = new Cesium.Cartesian2(0, floatY);
            for (const bubble of this._allBubbles) {
                bubble.badge.pixelOffset = offset;
            }
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._settingsUnsubscribe?.();
        this._filterUnsubscribe?.();
        this._badgeCanvasCache.clear();
        if (this._billboardCollection && !this._billboardCollection.isDestroyed()) {
            this._scene.primitives.remove(this._billboardCollection);
        }
        this._billboardCollection = null;
        this._allBubbles = [];
    }
}
