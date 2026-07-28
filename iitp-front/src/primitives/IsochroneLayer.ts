import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useLayerStore } from "@stores/useLayerStore";
import { ISOCHRONE } from "@utils/lodConstants";
import { coverageColor } from "@utils/losScale";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

const FACILITY_COLOR: Record<string, Cesium.Color> = {
    bus: Cesium.Color.fromCssColorString("#f97316"),
    rail: Cesium.Color.fromCssColorString("#1e3a8a"),
};

/**
 * 시설(버스정류장/철도역) 서비스권 커버리지("영향권") 분석 — 체크박스만 켜면 시나리오 범위 내
 * 모든 대상 시설의 N분 서비스권을 자동으로 계산해 겹쳐 보여준다(클릭 등 사용자 입력 없음).
 *
 * ⚠️ 처음엔 "지도를 클릭해 원점을 고르는" 단일 등시선으로 만들었는데, 사용자가 "영향권 분석
 * 느낌"(기존 시설 전부의 서비스권을 한번에 자동으로)을 기대한다고 피드백해 전면 재설계함 —
 * 클릭 인터랙션(EventManager bind/unbind)을 완전히 제거하고, 다른 analyze 레이어들과 동일한
 * 재생시각 구독 throttle fetch 패턴으로 교체했다(LinkMetricPolylineLayer 참고). 경계/시설
 * 목록은 시나리오 범위 전체 기준(뷰포트 아님) — RegionTrafficLayer와 동일한 이유(정류장이
 * 시나리오 전역에 분포).
 *
 * ⚠️ 실제 교통배정/HCM 모델이 아니라 자유흐름속도+V/C 근사(백엔드 IsochroneService, BPR류 함수)
 * 기반 추정 — 범례 UI에 명시.
 */
export default class IsochroneLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private readonly _viewer: Cesium.Viewer;
    private _show = false;
    private _active = false;
    private _maxMinutes: number = ISOCHRONE.DEFAULT_MAX_MINUTES;

    private _lastFetchWall = 0;
    private _primitive: Cesium.GroundPolylinePrimitive | null = null;
    private readonly _facilityMarkers: Cesium.CustomDataSource;

    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _layerUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        if (this._primitive) this._primitive.show = val;
        this._facilityMarkers.show = val;
    }

    constructor(
        viewer: Cesium.Viewer,
        // OL(2D) 쪽에 같은 fetch 결과를 공유하기 위한 콜백 — 중복 HTTP 요청 방지
        private readonly onData?: (data: any) => void,
    ) {
        this._viewer = viewer;
        this._facilityMarkers = new Cesium.CustomDataSource("facility-coverage-markers");
        this._facilityMarkers.show = false;
        viewer.dataSources.add(this._facilityMarkers);

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
            catch (e) { console.warn("[FacilityCoverage] 갱신 실패 (무시):", e); }
        }, 250);
    }

    private _update(): void {
        if (this.destroyed) return;
        const userOn = (useLayerStore.getState().activeLayerName ?? []).includes("isochrone");
        this._setActive(userOn);
        if (!userOn) return;

        const now = performance.now();
        if (now - this._lastFetchWall < ISOCHRONE.REFRESH_THROTTLE_MS) return;
        this._lastFetchWall = now;
        this._fetch();
    }

    /** LayerSettingPopup의 분(min) 슬라이더에서 호출 — 즉시 재계산 */
    public setMaxMinutes(minutes: number): void {
        this._maxMinutes = minutes;
        this._lastFetchWall = 0;
        this._schedule();
    }

    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        const half = ISOCHRONE.TIME_WINDOW_SEC;
        if (!cur || !start) return { fromTime: 0, toTime: half * 2 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: half * 2 };
        }
    }

    private _fetch(): void {
        const versionId = getActiveVersionId();
        if (!versionId) return;
        const { fromTime, toTime } = this._timeWindow();

        axiosInstance.get(`/analytics/facility-coverage/${versionId}`, {
            params: { maxMinutes: this._maxMinutes, fromTime, toTime },
        })
            .then((res) => {
                if (this.destroyed) return;
                this._render(res.data);
                this.onData?.(res.data);
                try { this._viewer.scene.requestRender(); } catch (_) {}
            })
            .catch((err) => {
                if (err?.response?.status !== 404) console.warn("[FacilityCoverage] 조회 실패", err);
            });
    }

    private _render(data: any): void {
        const links: any[] = data?.links ?? [];
        const facilities: any[] = data?.facilities ?? [];
        const maxCount = Math.max(1, ...links.map((l) => l.coverageCount ?? 0));

        const instances: Cesium.GeometryInstance[] = [];
        for (const l of links) {
            const coords = l.coordinates;
            if (!coords || coords.length < 2) continue;
            const positions = coords
                .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                .map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            if (positions.length < 2) continue;

            const color = coverageColor(l.coverageCount ?? 0, maxCount);
            instances.push(new Cesium.GeometryInstance({
                geometry: new Cesium.GroundPolylineGeometry({ positions, width: 4 }),
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

        this._facilityMarkers.entities.suspendEvents();
        this._facilityMarkers.entities.removeAll();
        for (const f of facilities) {
            if (f.lng == null || f.lat == null) continue;
            this._facilityMarkers.entities.add({
                position: Cesium.Cartesian3.fromDegrees(f.lng, f.lat),
                point: {
                    pixelSize: 8,
                    color: FACILITY_COLOR[f.type] ?? Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 1.5,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        this._facilityMarkers.entities.resumeEvents();
        this._facilityMarkers.show = this._show;
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
        if (this._primitive) {
            try { this._viewer.scene.groundPrimitives.remove(this._primitive); } catch (_) {}
            this._primitive = null;
        }
        try { this._viewer.dataSources.remove(this._facilityMarkers, true); } catch (_) {}
    }
}
