import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import { Link } from "@type/Network";
import { VEHICLE_AGGREGATION } from "@utils/lodConstants";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";
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

    // ── 차량 백엔드 집계 모드 (VEHICLE_AGGREGATION.ENABLED, 원거리) — 2D 레이어와 동일 패턴 ──
    private _viewer: Cesium.Viewer;
    private _aggregationActive = false;   // true면 개별 차량 위치 무시 (백엔드 집계가 히트맵 담당)
    private _lastAggregateAt = 0;
    private _aggCameraUnsub: (() => void) | null = null;
    private _aggSimUnsub: (() => void) | null = null;
    private _aggTimer: ReturnType<typeof setTimeout> | null = null;
    /** 집계 응답으로 받은 링크 지오메트리 (네트워크 타일 모드 대응 — 스토어 비의존) */
    private _aggLinkCoords = new Map<number, Cesium.Cartesian3[]>();

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        for (const p of this._bucketPrimitives) {
            if (p) p.show = val;
        }
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._viewer = viewer;
        this._buildFromStore();

        /* settings 변경 시 즉시 재빌드 */
        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors, s.exaggeration],
            () => {
                this._needsRebuild = true;
                this._lastRebuildTime = 0; // throttle 해제
            },
        );

        /* 백엔드 집계 모드: 카메라 정착 + 재생 시각 변화 시 bbox+시간창 집계 fetch.
         * ⚠️ camera.changed 는 렌더 루프 안에서 발화 — globe.pick 등을 동기 호출하면
         * 렌더 중 예외 → Cesium renderError 로 렌더링이 완전히 멈출 수 있다.
         * 반드시 setTimeout 으로 렌더 루프 밖에서 실행 (NetworkDataSourceLayer 와 동일 패턴). */
        if (VEHICLE_AGGREGATION.ENABLED) {
            const onCam = () => this._scheduleAggregation();
            viewer.camera.changed.addEventListener(onCam);
            this._aggCameraUnsub = () => viewer.camera.changed.removeEventListener(onCam);
            this._aggSimUnsub = (useSimulationStore as any).subscribe(
                (s: any) => s.currentTime,
                () => this._scheduleAggregation(),
            );
            this._scheduleAggregation();
        }
    }

    /** 집계 갱신을 렌더 루프 밖으로 디바운스 (250ms) + 예외 격리 */
    private _scheduleAggregation(): void {
        if (this._aggTimer) return;
        this._aggTimer = setTimeout(() => {
            this._aggTimer = null;
            try {
                this._updateAggregation();
            } catch (e) {
                console.warn('[TrafficHeatmapCesium] 집계 갱신 실패 (무시):', e);
            }
        }, 250);
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

    // ─────────────── 백엔드 집계 모드 (원거리, 2D 레이어와 동일 패턴) ───────────────

    /** 화면 중앙 지면점 기준 bbox + 재생 시간창으로 집계 fetch → emaByLink/_aggLinkCoords 주입 */
    private _updateAggregation(): void {
        if (!VEHICLE_AGGREGATION.ENABLED || this.destroyed) return;
        const scene = this._scene;
        const camera = this._viewer.camera;
        const canvas = scene.canvas;

        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const ray = camera.getPickRay(center);
        const ground = ray ? scene.globe.pick(ray, scene) : undefined;
        if (!ground) return;

        const groundDist = Cesium.Cartesian3.distance(camera.positionWC, ground);
        const frustum: any = camera.frustum;
        const fovy = frustum.fovy ?? frustum.fov ?? Cesium.Math.toRadians(60);
        const canvasH = canvas.clientHeight || 900;
        const canvasW = canvas.clientWidth || 1200;
        const pixelSizeM = (2 * groundDist * Math.tan(fovy / 2)) / canvasH;

        // near(확대) 미만에서는 집계 비활성 → 개별 차량 표시로 복귀.
        // 단 denseViewport(viewport 차량 상한 초과)면 줌 무관 집계 유지 — 개별 차량 대체 가시화.
        const dense = (useVehicleStore.getState() as any).denseViewport === true;
        this._aggregationActive = dense || pixelSizeM >= VEHICLE_AGGREGATION.MIN_RESOLUTION;
        if (!this._aggregationActive) return;

        const now = performance.now();
        if (now - this._lastAggregateAt < VEHICLE_AGGREGATION.THROTTLE_MS) return;
        this._lastAggregateAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const halfHeightM = pixelSizeM * canvasH / 2;
        const halfWidthM  = pixelSizeM * canvasW / 2;
        const carto = Cesium.Cartographic.fromCartesian(ground);
        const cLng = Cesium.Math.toDegrees(carto.longitude);
        const cLat = Cesium.Math.toDegrees(carto.latitude);
        const hLat = halfHeightM / 111320;
        const hLng = (halfWidthM / 111320) / Math.max(Math.cos(carto.latitude), 0.01);

        const { fromTime, toTime } = this._timeWindow();

        axiosInstance.get(`/analytics/link-traffic/${versionId}`, {
            params: { bbox: `${cLng - hLng},${cLat - hLat},${cLng + hLng},${cLat + hLat}`, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            const links = res.data?.links ?? [];
            for (const [id] of this.emaByLink) this.emaByLink.set(id, 0); // 잔상 제거
            for (const lt of links) {
                const id = Number(lt.linkId);
                this.emaByLink.set(id, lt.volume ?? 0);
                // 네트워크 타일 모드: 스토어에 링크 지오메트리 없음 → 집계 응답 좌표 사용
                if (!this._aggLinkCoords.has(id) && Array.isArray(lt.coordinates) && lt.coordinates.length >= 2) {
                    this._aggLinkCoords.set(id,
                        lt.coordinates.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat)));
                }
            }
            this._needsRebuild = true;
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn('[TrafficHeatmapCesium] 집계 호출 실패', err);
        });
    }

    /** 재생 현재 시각 기준 ± TIME_WINDOW_SEC (시뮬 시작 기준 초). 전체면 0,0 — 2D와 동일 */
    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return { fromTime: 0, toTime: 0 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            const half = VEHICLE_AGGREGATION.TIME_WINDOW_SEC;
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: 0 };
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

        /* 집계 응답 좌표 기반 링크 (네트워크 타일 모드 — 스토어에 없는 링크) */
        const storeIds = new Set(this._links.map(l => l.id));
        for (const [id, positions] of this._aggLinkCoords) {
            if (storeIds.has(id)) continue; // 스토어 링크와 중복 방지
            const bucket = emaToBucket(this.emaByLink.get(id) ?? 0);
            if (bucket === 0) continue;
            bucketPositions[bucket]!.push(positions);
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
        // 집계 모드(원거리)에서는 개별 차량 위치 무시 — 백엔드 집계가 히트맵 담당 (2D와 동일)
        if (VEHICLE_AGGREGATION.ENABLED && this._aggregationActive) return;
        this._pendingPositions = data.positions;
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // ── update (PrimitiveCollection이 매 프레임 호출) ────────────────
    update(_frameState: any) {
        if (this.destroyed) return;
        if (this.linkSegments.length === 0) {
            this._buildFromStore();
            // 네트워크 타일 모드: 스토어가 빈 마커라 linkSegments 가 항상 0 —
            // 집계 좌표(_aggLinkCoords)가 있으면 재빌드 루프는 계속 진행해야 한다.
            if (this._aggLinkCoords.size === 0) return;
        }

        this._frameCount++;

        /* EMA 업데이트 */
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions);
            this._needsRebuild = true;
        }

        /* 시간 기반 재빌드 (최대 2초 간격). 예외는 격리 — update()는 렌더 루프에서 호출되므로
           예외가 새어나가면 Cesium renderError 로 렌더링 전체가 멈춘다. */
        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            try {
                this._rebuildPrimitives();
            } catch (e) {
                console.warn('[TrafficHeatmapCesium] 재빌드 실패 (무시):', e);
            }
            this._lastRebuildTime = now;
            this._needsRebuild = false;
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._settingsUnsubscribe?.();
        this._aggCameraUnsub?.();
        this._aggSimUnsub?.();
        if (this._aggTimer) { clearTimeout(this._aggTimer); this._aggTimer = null; }
        this._aggLinkCoords.clear();
        for (let b = 0; b < NUM_TRAFFIC_BUCKETS; b++) {
            const p = this._bucketPrimitives[b];
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._bucketPrimitives = new Array(NUM_TRAFFIC_BUCKETS).fill(null);
    }
}
