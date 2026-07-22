import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useLayerStore } from "@stores/useLayerStore";
import { OD_FLOW } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";
import ParabolicArrowPrimitive from "./ParabolicArrowPrimitive";

/**
 * OD(origin-destination) 흐름 — 가장 축소된 overview 줌 티어(히트맵보다도 더 멀리서).
 *
 * 백엔드 `/analytics/od-flow` 집계(각 차량의 시간창 내 첫/끝 위치를 격자로 스냅해 (origin,
 * destination) 쌍별 volume 집계 — SQLite GROUP BY, 개별 차량 데이터 불필요)를 받아 기존
 * `ParabolicArrowPrimitive`(포물선 화살표)에 그대로 주입해 그린다. 렌더러를 새로 만들지 않고
 * 재사용하는 대신, 데이터 소스는 기존 "od" 레이어(개별 차량의 현재위치→목적지를 매초 재계산,
 * `LayerManager.addODArrows`)와 완전히 분리한다 — 그래서 레이어 이름도 "odFlow"로 별도.
 *
 * 표시 여부는 분석 메뉴의 "od" 체크(activeLayerName)가 소유한다 — 줌 티어에 따라 스스로
 * 나타나는 게 아니라("레이어 전환보다 사용자 온오프 + 줌은 세밀도만" 방침), 사용자가 od를
 * 켜두면 근거리에선 기존 "od" 레이어(개별 차량 기반, 상세)가, 이 원거리 구간에선 이 레이어
 * (백엔드 집계, 개괄)가 데이터를 담당하는 식으로 줌은 세밀도/데이터 소스만 바꾼다.
 * 카메라 zoom(pixelSizeM)은 그래서 fetch 여부에만 쓴다(OD_FLOW.MIN_RESOLUTION 이상에서만
 * 집계 호출 — bbox+시간창 계산은 공용 computeViewportMetrics 재사용).
 */
export default class OdFlowCesiumLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private _viewer: Cesium.Viewer;
    private _arrow: ParabolicArrowPrimitive;
    private _show = false;
    private _active = false;

    private _lastAggregateAt = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _layerUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        this._arrow.setVisible(val);
    }

    constructor(viewer: Cesium.Viewer) {
        this._viewer = viewer;
        this._arrow = new ParabolicArrowPrimitive(viewer.scene.context, [] as any);

        if (!OD_FLOW.ENABLED) return;

        // ⚠️ camera.changed는 렌더 루프 안에서 발화 — globe.pick 등을 동기 호출하면 렌더 중
        // 예외로 이어져 렌더링이 멈출 수 있다. setTimeout으로 렌더 루프 밖에서 실행
        // (NetworkDataSourceLayer/TrafficHeatmapCesiumLayer/TrafficTailCesiumLayer와 동일 패턴).
        const onCam = () => this._schedule();
        viewer.camera.changed.addEventListener(onCam);
        this._camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        // 분석 메뉴에서 od를 켜고 끌 때 즉시 반응 (카메라/재생이 멈춰 있어도) — useLayerStore는
        // subscribeWithSelector 미들웨어가 없어 selector 오버로드가 안 되므로 전체 구독 + debounce.
        this._layerUnsub = useLayerStore.subscribe(() => this._schedule());
        this._schedule();
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._updateAggregation(); }
            catch (e) { console.warn('[OdFlowCesium] 집계 갱신 실패 (무시):', e); }
        }, 250);
    }

    /** 화면 중앙 지면점 기준 bbox + 재생 시간창으로 집계 fetch (computeViewportMetrics 공용 유틸 사용) */
    private _updateAggregation(): void {
        if (!OD_FLOW.ENABLED || this.destroyed) return;

        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) { this._setActive(false); return; }
        const { normalizedPixelSizeM, bbox } = metrics;

        // 줌은 데이터 소스만 결정: 이 구간 미만(근거리)은 기존 "od" 레이어(개별 차량 기반)가 OD
        // 화살표를 담당하므로 여기선 fetch하지 않는다. 표시 여부는 사용자의 분석 메뉴 od 체크가
        // 소유 — 체크 안 되어 있으면 줌과 무관하게 숨김(자동 레이어 전환 없음).
        const zoomActive = normalizedPixelSizeM >= OD_FLOW.MIN_RESOLUTION;
        const userOn = (useLayerStore.getState().activeLayerName ?? []).includes("od");
        const active = zoomActive && userOn;
        this._setActive(active);
        if (!active) return;

        const now = performance.now();
        if (now - this._lastAggregateAt < OD_FLOW.THROTTLE_MS) return;
        this._lastAggregateAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const { w, s, e, n } = bbox;
        const { fromTime, toTime } = this._timeWindow();

        axiosInstance.get(`/analytics/od-flow/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime, maxPairs: OD_FLOW.MAX_PAIRS },
        }).then((res) => {
            if (this.destroyed) return;
            const pairs = res.data?.pairs ?? [];
            const maxVolume = Math.max(1, ...pairs.map((p: any) => p.volume ?? 0));
            const odData = pairs.map((p: any) => ({
                fromCoord: [p.fromLng, p.fromLat],
                toCoord: [p.toLng, p.toLat],
                density: Math.min(1, (p.volume ?? 0) / maxVolume),
            }));
            this._arrow.setOdData(odData);
            try { this._viewer.scene.requestRender(); } catch (_) {}
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn('[OdFlowCesium] 집계 호출 실패', err);
        });
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this.show = active;
    }

    /** 재생 현재 시각 기준 ± 집계 시간창 (TrafficHeatmapCesiumLayer._timeWindow와 동일) */
    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return { fromTime: 0, toTime: 0 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            const half = OD_FLOW.TIME_WINDOW_SEC;
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: 0 };
        }
    }

    // ── 외부 인터페이스 (개별 차량 위치는 사용하지 않음 — 항상 집계 기반) ──────────
    public setLatestPositions(_data: any) {}
    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // ── update (PrimitiveCollection이 매 프레임 호출) — 내부 ParabolicArrowPrimitive에 위임 ──
    update(frameState: any) {
        if (this.destroyed) return;
        this._arrow.update(frameState);
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        this._layerUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        this._arrow.destroy();
    }
}
