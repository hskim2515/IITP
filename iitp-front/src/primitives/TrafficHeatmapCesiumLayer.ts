import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_MAX_TRAFFIC,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    NUM_TRAFFIC_BUCKETS,
    emaToBucket,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

/* 버킷별 기본 선 두께 (exaggeration 1.0 기준, px) */
const BUCKET_BASE_WIDTHS = [1.5, 3, 5, 7, 10];

/* 재빌드 최소 간격 (ms) */
const REBUILD_MIN_MS = 2000;

function cesiumColorForBucket(bucket: number, colors: string[]): Cesium.Color {
    if (bucket === 0) return Cesium.Color.fromCssColorString("#aaaaaa").withAlpha(0.25);
    const hex = colors[bucket - 1] ?? "#ff2200";
    return Cesium.Color.fromCssColorString(hex).withAlpha(0.9);
}

/**
 * 교통량 히트맵 Cesium 3D 레이어
 * - WallGeometry 대신 GroundPolylinePrimitive (버킷별 색상/두께)
 * - 버킷: 0=미감지, 1=낮음, 2=중간, 3=높음, 4=혼잡
 * - useHeatmapSettingStore 연동 (colors, exaggeration)
 * - 시간 기반 재빌드 (2초 간격)
 */
export default class TrafficHeatmapCesiumLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private linkSegments: LinkSegment[] = [];
    private emaByLink = new Map<number, number>();

    /* 버킷별 Primitive (bucket 0은 사용 안 함) */
    private _bucketPrimitives: (Cesium.GroundPolylinePrimitive | null)[] =
        new Array(NUM_TRAFFIC_BUCKETS).fill(null);

    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount   = 0;
    private _needsRebuild = false;
    private _lastRebuildTime = 0;

    private _settingsUnsubscribe: (() => void) | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        for (const p of this._bucketPrimitives) {
            if (p) p.show = val;
        }
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._buildFromStore();

        /* settings 변경 시 즉시 재빌드 */
        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors, s.exaggeration],
            () => {
                this._needsRebuild = true;
                this._lastRebuildTime = 0; // throttle 해제
            },
        );
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
                      ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._links       = network.links as Link[];
        this.linkSegments = buildLinkSegments(this._links);
        this._links.forEach(l => this.emaByLink.set(l.id, 0));
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch { return null; }
    }

    private _updateEMA(positions: (number[] | null)[]) {
        const snapDist2  = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
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

    private _rebuildPrimitives() {
        const { colors, exaggeration } = useHeatmapSettingStore.getState();

        /* 링크를 버킷별로 분류 */
        const bucketPositions: Cesium.Cartesian3[][][] =
            Array.from({ length: NUM_TRAFFIC_BUCKETS }, () => []);

        for (const link of this._links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const ema    = this.emaByLink.get(link.id) ?? 0;
            const bucket = emaToBucket(ema);
            if (bucket === 0) continue; // 미감지 링크는 그리지 않음 (성능)
            bucketPositions[bucket]!.push(
                link.coordinates.map(c => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))
            );
        }

        /* 기존 primitives 제거 후 교체 */
        for (let b = 1; b < NUM_TRAFFIC_BUCKETS; b++) {
            const old = this._bucketPrimitives[b];
            if (old && !old.isDestroyed()) this._scene.primitives.remove(old);
            this._bucketPrimitives[b] = null;

            const linkPosList = bucketPositions[b]!;
            if (linkPosList.length === 0) continue;

            const width = (BUCKET_BASE_WIDTHS[b] ?? 3) * exaggeration;
            const color = cesiumColorForBucket(b, colors);

            const instances = linkPosList.map(positions =>
                new Cesium.GeometryInstance({
                    geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
                })
            );

            const primitive = new Cesium.GroundPolylinePrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PolylineMaterialAppearance({
                    material: Cesium.Material.fromType("Color", { color }),
                }),
                show: this._show,
            });
            this._scene.primitives.add(primitive);
            this._bucketPrimitives[b] = primitive;
        }
    }

    // ── 외부 인터페이스 ─────────────────────────────────────────────
    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        this._pendingPositions = data.positions;
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // ── update (PrimitiveCollection이 매 프레임 호출) ────────────────
    update(_frameState: any) {
        if (this.destroyed) return;
        if (this.linkSegments.length === 0) { this._buildFromStore(); return; }

        this._frameCount++;

        /* EMA 업데이트 */
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions);
            this._needsRebuild = true;
        }

        /* 시간 기반 재빌드 (최대 2초 간격) */
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
        for (let b = 0; b < NUM_TRAFFIC_BUCKETS; b++) {
            const p = this._bucketPrimitives[b];
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._bucketPrimitives = new Array(NUM_TRAFFIC_BUCKETS).fill(null);
    }
}
