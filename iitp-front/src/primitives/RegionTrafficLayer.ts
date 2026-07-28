import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useLayerStore } from "@stores/useLayerStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import { getAdminRegionTier, AdminRegionTier, REGION_TRAFFIC } from "@utils/lodConstants";
import { vcToContinuousColor } from "@utils/losScale";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

const TIERS: AdminRegionTier[] = ['sido', 'sigungu', 'eupmyeondong'];
/** 3D 컬럼 최대 높이(m) — 해당 tier 내 최대 volume 지역 기준으로 정규화 */
const MAX_COLUMN_HEIGHT_M = 600;
const MIN_COLUMN_HEIGHT_M = 20;
const COLUMN_SIDE_M = 260;

interface TierBundle {
    ground: Cesium.GroundPrimitive | null;
    columns: Cesium.CustomDataSource;
    loaded: boolean;
}

/**
 * 행정구역(시도/시군구/읍면동) 단위 교통량 — volume은 "지금 이 순간" 스냅샷이라 재생 시각이
 * 흐르는 동안 계속 재요청해야 한다(REGION_TRAFFIC.REFRESH_THROTTLE_MS 간격, 백엔드가
 * atTime±5초 스냅샷으로 응답 — lodConstants.ts REGION_TRAFFIC 주석 참고). 경계 지오메트리 자체는
 * 정적이라 매 응답마다 폴리곤을 다시 만들 필요는 없지만, 구현 단순화를 위해 지금은 volume과
 * 함께 매번 재생성한다(지역 수가 tier당 수십 개 수준이라 비용은 낮음).
 *
 * 표시 여부는 분석 메뉴의 "region" 체크박스가 소유, 줌은 tier(세밀도) 선택만 — 다른 analyze
 * 레이어들과 동일한 방침(자동 레이어 전환 금지, lodConstants.ts 반려 이력 참고).
 */
export default class RegionTrafficLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private readonly _viewer: Cesium.Viewer;
    private _show = false;
    private _active = false;
    private _fetchStarted = false;
    private _activeTier: AdminRegionTier | null = null;

    private readonly _bundles = new Map<AdminRegionTier, TierBundle>();

    private _lastFetchWall = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _layerUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        if (!val) {
            for (const b of this._bundles.values()) this._setBundleVisible(b, false);
        } else if (this._activeTier) {
            const b = this._bundles.get(this._activeTier);
            if (b) this._setBundleVisible(b, true);
        }
    }

    constructor(
        viewer: Cesium.Viewer,
        // OL(2D) 쪽에 같은 fetch 결과를 공유하기 위한 콜백 — 중복 HTTP 요청 방지
        private readonly onData?: (tier: AdminRegionTier, regions: any[]) => void,
    ) {
        this._viewer = viewer;
        for (const t of TIERS) {
            this._bundles.set(t, { ground: null, columns: new Cesium.CustomDataSource(`region-${t}`), loaded: false });
        }
        for (const b of this._bundles.values()) {
            b.columns.show = false;
            viewer.dataSources.add(b.columns);
        }

        // camera.changed는 tier 전환 판정에만 쓴다(경계는 정적 — 재요청 트리거 아님)
        const onCam = () => this._schedule();
        viewer.camera.changed.addEventListener(onCam);
        this._camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        this._layerUnsub = useLayerStore.subscribe(() => this._schedule());
        this._schedule();
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._update(); }
            catch (e) { console.warn('[RegionTraffic] 갱신 실패 (무시):', e); }
        }, 250);
    }

    private _update(): void {
        if (this.destroyed) return;
        const userOn = (useLayerStore.getState().activeLayerName ?? []).includes('region');
        this._setActive(userOn);
        if (!userOn) return;

        const now = performance.now();
        if (!this._fetchStarted || now - this._lastFetchWall >= REGION_TRAFFIC.REFRESH_THROTTLE_MS) {
            this._fetchStarted = true;
            this._lastFetchWall = now;
            this._fetchAllTiers();
        }

        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) return;
        const tier = getAdminRegionTier(metrics.pixelSizeM);
        this._switchTier(tier);
    }

    /** 재생 현재 시각(시뮬레이션 시작 기준 경과 초) — 백엔드가 이 순간 ±5초 스냅샷을 계산한다 */
    private _currentAtTime(): number {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return 0;
        try {
            return Math.max(0, Math.round(JulianDate.secondsDifference(cur, start)));
        } catch {
            return 0;
        }
    }

    private _switchTier(tier: AdminRegionTier): void {
        if (tier === this._activeTier) return;
        const prev = this._activeTier ? this._bundles.get(this._activeTier) : null;
        if (prev) this._setBundleVisible(prev, false);
        this._activeTier = tier;
        if (this._show) {
            const next = this._bundles.get(tier);
            if (next) this._setBundleVisible(next, true);
        }
    }

    private _setBundleVisible(b: TierBundle, visible: boolean): void {
        if (b.ground) b.ground.show = visible;
        b.columns.show = visible;
    }

    private _fetchAllTiers(): void {
        const versionId = getActiveVersionId();
        if (!versionId) return;
        const atTime = this._currentAtTime();
        for (const tier of TIERS) {
            axiosInstance.get(`/analytics/region-traffic/${versionId}`, { params: { tier, atTime } })
                .then((res) => {
                    if (this.destroyed) return;
                    const regions = res.data?.regions ?? [];
                    this._buildTier(tier, regions);
                    this.onData?.(tier, regions);
                    if (tier === this._activeTier) {
                        const b = this._bundles.get(tier);
                        if (b) this._setBundleVisible(b, this._show);
                    }
                    try { this._viewer.scene.requestRender(); } catch (_) {}
                })
                .catch((err) => {
                    if (err?.response?.status !== 404) console.warn(`[RegionTraffic] ${tier} 조회 실패`, err);
                });
        }
    }

    private _buildTier(tier: AdminRegionTier, regions: any[]): void {
        const bundle = this._bundles.get(tier);
        if (!bundle) return;

        const maxVolume = Math.max(1, ...regions.map((r) => r.volume ?? 0));

        const instances: Cesium.GeometryInstance[] = [];
        bundle.columns.entities.suspendEvents();
        bundle.columns.entities.removeAll();

        for (const r of regions) {
            const color = vcToContinuousColor(r.vcRatio ?? -1);
            for (const ring of (r.rings ?? [])) {
                const positions = ring
                    .filter((pt: number[]) => pt && isFinite(pt[0]!) && isFinite(pt[1]!))
                    .map((pt: number[]) => Cesium.Cartesian3.fromDegrees(pt[0]!, pt[1]!));
                if (positions.length < 3) continue;
                instances.push(new Cesium.GeometryInstance({
                    geometry: new Cesium.PolygonGeometry({
                        polygonHierarchy: new Cesium.PolygonHierarchy(positions),
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            color.withAlpha(0.35)),
                    },
                }));
            }

            if (!r.centroid) continue;
            const [lng, lat] = r.centroid;
            const heightM = MIN_COLUMN_HEIGHT_M
                + ((r.volume ?? 0) / maxVolume) * (MAX_COLUMN_HEIGHT_M - MIN_COLUMN_HEIGHT_M);
            bundle.columns.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, heightM / 2),
                box: {
                    dimensions: new Cesium.Cartesian3(COLUMN_SIDE_M, COLUMN_SIDE_M, heightM),
                    material: color.withAlpha(0.85),
                    outline: true,
                    outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                },
            });
            bundle.columns.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, heightM),
                label: {
                    text: `${r.name}\n${(r.volume ?? 0).toLocaleString()}대`,
                    font: '13px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        bundle.columns.entities.resumeEvents();

        if (bundle.ground) {
            try { this._viewer.scene.groundPrimitives.remove(bundle.ground); } catch (_) {}
            bundle.ground = null;
        }
        if (instances.length > 0) {
            bundle.ground = new Cesium.GroundPrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
                asynchronous: true,
                show: false,
                classificationType: Cesium.ClassificationType.BOTH,
            });
            this._viewer.scene.groundPrimitives.add(bundle.ground);
        }
        bundle.loaded = true;
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this.show = active;
    }

    // ── 외부 인터페이스 (개별 차량 위치는 사용하지 않음 — 정적 집계 기반) ──────────
    public setLatestPositions(_data: any) {}
    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // 실제 드로잉은 groundPrimitives/CustomDataSource가 자체적으로 수행하므로 no-op
    update(_frameState: any) {}

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        this._layerUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        for (const b of this._bundles.values()) {
            if (b.ground) { try { this._viewer.scene.groundPrimitives.remove(b.ground); } catch (_) {} }
            try { this._viewer.dataSources.remove(b.columns, true); } catch (_) {}
        }
        this._bundles.clear();
    }
}
