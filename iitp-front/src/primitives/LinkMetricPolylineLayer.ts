import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useLayerStore } from "@stores/useLayerStore";
import { LINK_METRICS } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import { vcToContinuousColor, losGradeCesiumColor } from "@utils/losScale";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

export type LinkMetricType = "congestion" | "los" | "bottleneck";

/**
 * 링크 혼잡도(V/C)/서비스수준(LOS)/병목 링크 — 네트워크 링크 자체를 지표로 색칠하는 analyze 레이어.
 *
 * `OdFlowCesiumLayer`와 동일한 골격(camera.changed + 재생시각 + 분석메뉴 체크 구독, 디바운스,
 * bbox+시간창 throttle fetch)을 쓰되, 백엔드 집계 대상이 OD 쌍이 아니라 `/analytics/link-traffic`
 * (V/C ratio·losGrade가 이미 계산되어 내려옴)이고 렌더 결과가 링크 중심선을 따라 색칠된
 * `GroundPolylinePrimitive`라는 점이 다르다.
 *
 * 표시 여부는 분석 메뉴의 해당 체크박스(congestion/los/bottleneck)가 전적으로 소유한다 — 줌
 * 티어가 자동으로 레이어를 켜거나 끄지 않는다. 과거 "TrafficHeatmapCesiumLayer"가 줌 자동전환
 * 때문에 heatmap/trip과 동시에 뜨며 깜빡이는 버그로 반려·삭제된 이력이 있어(lodConstants.ts
 * 참고), 반드시 이 방침을 지킨다.
 */
export default class LinkMetricPolylineLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private readonly _viewer: Cesium.Viewer;
    private readonly _metric: LinkMetricType;
    private _show = false;
    private _active = false;

    private _primitive: Cesium.GroundPolylinePrimitive | null = null;
    private _intersectionMarkers: Cesium.CustomDataSource | null = null;

    private _lastFetchAt = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _layerUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        if (this._primitive) this._primitive.show = val;
        if (this._intersectionMarkers) this._intersectionMarkers.show = val;
    }

    constructor(
        viewer: Cesium.Viewer,
        metric: LinkMetricType,
        // OL(2D) 쪽 레이어에 같은 fetch 결과를 공유하기 위한 콜백 — 중복 HTTP 요청 방지
        // (OdFlowCesiumLayer와 달리 이 레이어는 2D 대응 렌더러가 있으므로, 데이터는 이 클래스가
        // 한 번만 가져오고 OL 쪽은 외부에서 주입받아 그리기만 하는 구조로 통일했다).
        private readonly onData?: (links: any[]) => void,
        private readonly onIntersections?: (items: any[]) => void,
    ) {
        this._viewer = viewer;
        this._metric = metric;

        if (metric === "los") {
            this._intersectionMarkers = new Cesium.CustomDataSource(`los-intersections`);
            this._intersectionMarkers.show = false;
            viewer.dataSources.add(this._intersectionMarkers);
        }

        if (!LINK_METRICS.ENABLED) return;

        // camera.changed는 렌더 루프 안에서 발화 — setTimeout으로 렌더 루프 밖에서 실행
        // (OdFlowCesiumLayer/NetworkDataSourceLayer와 동일 패턴).
        const onCam = () => this._schedule();
        viewer.camera.changed.addEventListener(onCam);
        this._camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        // useLayerStore는 subscribeWithSelector 미들웨어가 없어 전체 구독 + 디바운스
        this._layerUnsub = useLayerStore.subscribe(() => this._schedule());
        this._schedule();
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._update(); }
            catch (e) { console.warn(`[LinkMetric:${this._metric}] 갱신 실패 (무시):`, e); }
        }, 250);
    }

    private _update(): void {
        if (!LINK_METRICS.ENABLED || this.destroyed) return;

        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) { this._setActive(false); return; }
        const { bbox } = metrics;

        const userOn = (useLayerStore.getState().activeLayerName ?? []).includes(this._metric);
        this._setActive(userOn);
        if (!userOn) return;

        const now = performance.now();
        if (now - this._lastFetchAt < LINK_METRICS.THROTTLE_MS) return;
        this._lastFetchAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const { w, s, e, n } = bbox;
        const { fromTime, toTime } = this._timeWindow();
        const bboxParam = `${w},${s},${e},${n}`;

        axiosInstance.get(`/analytics/link-traffic/${versionId}`, {
            params: { bbox: bboxParam, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            this._render(res.data?.links ?? []);
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn(`[LinkMetric:${this._metric}] 집계 호출 실패`, err);
        });

        if (this._metric === "los") {
            axiosInstance.get(`/analytics/intersection-los/${versionId}`, {
                params: { bbox: bboxParam, fromTime, toTime },
            }).then((res) => {
                if (this.destroyed) return;
                this._renderIntersections(res.data?.intersections ?? []);
            }).catch((err) => {
                if (err?.response?.status !== 404) console.warn(`[LinkMetric:los] 교차로 호출 실패`, err);
            });
        }
    }

    private _render(links: any[]): void {
        const filtered = this._metric === "bottleneck"
            ? [...links]
                  .filter((l) => (l.vcRatio ?? -1) >= 0)
                  .sort((a, b) => (b.vcRatio ?? 0) - (a.vcRatio ?? 0))
                  .slice(0, LINK_METRICS.BOTTLENECK_TOP_N)
            : links;

        this.onData?.(filtered);

        const instances: Cesium.GeometryInstance[] = [];
        for (const l of filtered) {
            const coords = l.coordinates;
            if (!coords || coords.length < 2) continue;
            const positions = coords
                .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                .map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            if (positions.length < 2) continue;

            const vc = l.vcRatio ?? -1;
            const color = this._metric === "los"
                ? losGradeCesiumColor(l.losGrade)
                : this._metric === "bottleneck"
                    ? Cesium.Color.fromCssColorString("#dc2626")
                    : vcToContinuousColor(vc);
            const width = this._metric === "bottleneck" ? 6 : 3;

            instances.push(new Cesium.GeometryInstance({
                geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
                attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
            }));
        }

        if (this._primitive) {
            try { this._viewer.scene.groundPrimitives.remove(this._primitive); } catch (_) {}
            this._primitive = null;
        }
        if (instances.length > 0) {
            this._primitive = new Cesium.GroundPolylinePrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PolylineColorAppearance(),
                asynchronous: true,
                show: this._show,
                classificationType: Cesium.ClassificationType.BOTH,
            });
            this._viewer.scene.groundPrimitives.add(this._primitive);
        }
        try { this._viewer.scene.requestRender(); } catch (_) {}
    }

    private _renderIntersections(intersections: any[]): void {
        this.onIntersections?.(intersections);
        const ds = this._intersectionMarkers;
        if (!ds) return;
        ds.entities.suspendEvents();
        ds.entities.removeAll();
        for (const it of intersections) {
            if (it.lng == null || it.lat == null) continue;
            ds.entities.add({
                position: Cesium.Cartesian3.fromDegrees(it.lng, it.lat),
                point: {
                    pixelSize: 14,
                    color: losGradeCesiumColor(it.losGrade),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        ds.entities.resumeEvents();
        ds.show = this._show;
        try { this._viewer.scene.requestRender(); } catch (_) {}
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this.show = active;
    }

    /**
     * 재생 현재 시각 기준 ± 집계 시간창 (OdFlowCesiumLayer._timeWindow와 동일 패턴).
     * ⚠️ clock 미준비 시 {0,0}을 반환하면 안 된다 — 백엔드는 fromTime=toTime=0을 "전체 시간
     * 누적"으로 해석해(region-traffic에서 실제로 겪은 함정) V/C가 순간이 아니라 시뮬 전체
     * 누적 volume 기준으로 튀어나온다. {0, 시간창×2}로 유한 창을 보장한다.
     */
    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        const half = LINK_METRICS.TIME_WINDOW_SEC;
        if (!cur || !start) return { fromTime: 0, toTime: half * 2 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: half * 2 };
        }
    }

    // ── 외부 인터페이스 (개별 차량 위치는 사용하지 않음 — 항상 집계 기반) ──────────
    public setLatestPositions(_data: any) {}
    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // ── update (PrimitiveCollection이 매 프레임 호출) — 실제 드로잉은 groundPrimitives에
    // 별도 등록된 GroundPolylinePrimitive/CustomDataSource가 자체적으로 수행하므로 no-op ──
    update(_frameState: any) {}

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        this._layerUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        if (this._primitive) {
            try { this._viewer.scene.groundPrimitives.remove(this._primitive); } catch (_) {}
            this._primitive = null;
        }
        if (this._intersectionMarkers) {
            try { this._viewer.dataSources.remove(this._intersectionMarkers, true); } catch (_) {}
            this._intersectionMarkers = null;
        }
    }
}
