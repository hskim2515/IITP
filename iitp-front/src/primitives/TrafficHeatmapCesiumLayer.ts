import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_MAX_TRAFFIC,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

// 교통량 비율(0~1) → Cesium.Color (green → yellow → red)
function cesiumTrafficColor(ema: number): Cesium.Color {
    if (ema < 0.3) return new Cesium.Color(0.5, 0.5, 0.5, 0.25); // 미감지: 흐린 회색
    const t = Math.min(ema / TRAFFIC_MAX_TRAFFIC, 1);
    let r: number, g: number;
    if (t < 0.5) { r = t * 2; g = 0.78; }
    else          { r = 1.0;  g = 0.78 * (1 - (t - 0.5) * 2); }
    return new Cesium.Color(r, g, 0, 0.85);
}

// 교통량에 따른 최대 벽 높이 (m)
const MAX_WALL_HEIGHT = 80;
// 벽 재빌드 주기 (프레임 수)
const REBUILD_INTERVAL = 90;

/**
 * 교통량 히트맵 Cesium 3D 레이어
 * - 도로 링크마다 WallGeometry로 수직 벽을 생성
 * - 벽 높이 = EMA 교통량 × MAX_WALL_HEIGHT
 * - 색상 = 초록(적음) → 노랑 → 빨강(많음)
 */
export default class TrafficHeatmapCesiumLayer {
    layer      = "";
    layerGroup = "";

    private _show    = false;
    private _scene   : Cesium.Scene;
    private _links   : Link[] = [];
    private linkSegments: LinkSegment[] = [];
    private emaByLink    = new Map<number, number>();

    // 현재 표시 중인 WallPrimitive
    private _wallPrimitive: Cesium.Primitive | null = null;
    // 비동기 빌드 중인 WallPrimitive
    private _pendingPrimitive: Cesium.Primitive | null = null;

    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount   = 0;
    private _needsRebuild = false;

    // ── show getter/setter ───────────────────────────────────────
    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        if (this._wallPrimitive) this._wallPrimitive.show = val;
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._buildFromStore();
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
                      ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._links        = network.links as Link[];
        this.linkSegments  = buildLinkSegments(this._links);
        this._links.forEach(l => this.emaByLink.set(l.id, 0));
    }

    // ── ECEF → EPSG:3857 (nearest-link 매칭) ────────────────────
    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch { return null; }
    }

    // ── EMA 업데이트 ─────────────────────────────────────────────
    private _updateEMA(positions: (number[] | null)[]) {
        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();

        for (const pos of positions) {
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
    }

    // ── WallGeometry 재빌드 ──────────────────────────────────────
    private _rebuildWalls() {
        const instances: Cesium.GeometryInstance[] = [];

        for (const link of this._links) {
            const ema    = this.emaByLink.get(link.id) ?? 0;
            const height = Math.max(1, Math.min(ema / TRAFFIC_MAX_TRAFFIC, 1) * MAX_WALL_HEIGHT);
            const color  = cesiumTrafficColor(ema);

            if (!link.coordinates || link.coordinates.length < 2) continue;

            const positions = link.coordinates.map(c =>
                Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0));
            const n = positions.length;

            try {
                const wall = new Cesium.WallGeometry({
                    positions,
                    minimumHeights : new Array(n).fill(0),
                    maximumHeights : new Array(n).fill(height),
                    granularity    : Cesium.Math.toRadians(0.1),
                });
                const geom = Cesium.WallGeometry.createGeometry(wall);
                if (!geom) continue;

                instances.push(new Cesium.GeometryInstance({
                    geometry  : geom,
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
                    },
                }));
            } catch { /* skip degenerate geometry */ }
        }

        if (instances.length === 0) return;

        // 이전 비동기 빌드 중인 primitive 정리
        if (this._pendingPrimitive && !this._pendingPrimitive.isDestroyed()) {
            this._scene.primitives.remove(this._pendingPrimitive);
        }

        this._pendingPrimitive = new Cesium.Primitive({
            geometryInstances : instances,
            appearance        : new Cesium.PerInstanceColorAppearance({
                flat       : true,   // 조명 없이 flat shading (성능, 선명한 색)
                translucent: true,
            }),
            asynchronous: false,     // WallGeometry 이미 계산 완료 → worker 불필요
        });
        this._pendingPrimitive.show = this._show;
        this._scene.primitives.add(this._pendingPrimitive);
    }

    // ── update (PrimitiveCollection이 매 프레임 호출) ────────────
    update(_frameState: any) {
        if (this.linkSegments.length === 0) { this._buildFromStore(); return; }

        this._frameCount++;

        // EMA 업데이트
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions);
            this._needsRebuild = true;
        }

        // 비동기 pending primitive 완료 확인 → 교체
        if (this._pendingPrimitive?.ready) {
            if (this._wallPrimitive && !this._wallPrimitive.isDestroyed()) {
                this._scene.primitives.remove(this._wallPrimitive);
            }
            this._wallPrimitive    = this._pendingPrimitive;
            this._pendingPrimitive = null;
            this._wallPrimitive.show = this._show;
        }

        // 주기적 재빌드
        if (this._needsRebuild && this._frameCount % REBUILD_INTERVAL === 0) {
            this._rebuildWalls();
            this._needsRebuild = false;
        }
    }

    // ── 외부 인터페이스 ─────────────────────────────────────────
    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        this._pendingPositions = data.positions;
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    public destroy() {
        if (this._wallPrimitive && !this._wallPrimitive.isDestroyed()) {
            this._scene.primitives.remove(this._wallPrimitive);
        }
        if (this._pendingPrimitive && !this._pendingPrimitive.isDestroyed()) {
            this._scene.primitives.remove(this._pendingPrimitive);
        }
        this._wallPrimitive    = null;
        this._pendingPrimitive = null;
    }
}
