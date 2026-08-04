import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { LINK_METRICS } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import { losGradeCesiumColor } from "@utils/losScale";
import { normalizeSimType } from "@utils/simType";
import { computeLaneCenterlineCesium } from "@utils/offset";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

const BOUNDARY_COLOR = Cesium.Color.fromCssColorString("#22d3ee"); // 청록 — 마이크로/메조 경계 강조

/**
 * 메조 링크 레인/커넥션 색칠 — 마이크로는 개별 차량 CZML로 이미 보이므로 대상 아님(레이어
 * 목적이 "마이크로/메조가 섞였을 때 메조 쪽도 뭔가 보이게" 하는 것). LinkMetricPolylineLayer와
 * 같은 골격(camera+재생시각 구독, throttle fetch, GroundPrimitive 재구성)이되, 그 클래스가
 * 의존하던 useLayerStore.activeLayerName 체크박스 메커니즘은 실제로 어디에도 연결 안 된
 * 죽은 코드였다(실측 확인, 2026-08-04) — 그래서 토글 없이 항상 켜져 있다(메조 링크가
 * 있으면 자동 표시).
 *
 * 색상 소스는 링크가 아니라 레인 단위 `/analytics/lane-traffic` — 레인마다 실제 평균속도 기반
 * LOS 등급으로 채색. 커넥션(회전 이동)은 자신의 fromLink+fromLane 레인 색을 그대로 물려받는다
 * (커넥션 자체의 차량 귀속 집계는 아직 없음 — 근사지만 "어느 흐름에서 온 회전인지"는 보존).
 * 마이크로↔메조 경계에 걸친 커넥션(fromLink/toLink의 simType이 다름)은 청록 점으로 강조해
 * "여기서부터 정밀 시뮬레이션으로 전환된다"를 표시한다.
 */
export default class MesoLaneMetricLayer {
    private readonly _viewer: Cesium.Viewer;
    private destroyed = false;

    private _lanePrimitive: Cesium.GroundPrimitive | null = null;
    private _connPrimitive: Cesium.GroundPolylinePrimitive | null = null;
    private _boundaryMarkers: Cesium.CustomDataSource;

    private _lastFetchAt = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(viewer: Cesium.Viewer) {
        this._viewer = viewer;
        this._boundaryMarkers = new Cesium.CustomDataSource("meso-micro-boundary");
        viewer.dataSources.add(this._boundaryMarkers);

        const onCam = () => this._schedule();
        viewer.camera.changed.addEventListener(onCam);
        this._camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        this._schedule();
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._update(); }
            catch (e) { console.warn("[MesoLaneMetricLayer] 갱신 실패 (무시):", e); }
        }, 250);
    }

    private _update(): void {
        if (this.destroyed) return;
        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) return;

        const now = performance.now();
        if (now - this._lastFetchAt < LINK_METRICS.THROTTLE_MS) return;
        this._lastFetchAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const { w, s, e, n } = metrics.bbox;
        const { fromTime, toTime } = this._timeWindow();

        axiosInstance.get(`/analytics/lane-traffic/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            this._render((res.data as any)?.lanes ?? []);
        }).catch((err) => {
            if (err?.response?.status !== 404) console.warn("[MesoLaneMetricLayer] 집계 호출 실패", err);
        });
    }

    private _render(lanes: any[]): void {
        const network: any = useNetworkStore.getState().currentJsonData;
        const links: any[] = network?.links ?? [];
        if (links.length === 0) { this._clear(); return; }

        // laneKey(`${linkId}_${laneIdx}`) → 색/등급
        const metricByLane = new Map<string, any>();
        for (const l of lanes) metricByLane.set(`${l.linkId}_${l.laneId}`, l);

        const linkById = new Map<string, any>(links.map((l: any) => [String(l.id), l]));
        const mesoLinkIds = new Set(
            links.filter((l: any) => normalizeSimType(l.simType) === "Meso").map((l: any) => String(l.id)));

        const laneInstances: Cesium.GeometryInstance[] = [];
        for (const link of links) {
            if (!mesoLinkIds.has(String(link.id))) continue;
            const laneCount = link.lanes?.length ?? 0;
            const laneWidth = (link.width ?? 7) / Math.max(1, laneCount);
            for (let i = 0; i < laneCount; i++) {
                const positions = computeLaneCenterlineCesium(link, i);
                if (!positions || positions.length < 2) continue;
                const metric = metricByLane.get(`${link.id}_${i}`);
                const color = losGradeCesiumColor(metric?.losGrade);
                try {
                    laneInstances.push(new Cesium.GeometryInstance({
                        id: `meso_lane_${link.id}_${i}`,
                        geometry: new Cesium.CorridorGeometry({
                            positions,
                            width: laneWidth * 0.9,
                            cornerType: Cesium.CornerType.MITERED,
                            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                        }),
                        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
                    }));
                } catch (_) { /* 좌표 불충분 등 — 스킵 */ }
            }
        }

        const connInstances: Cesium.GeometryInstance[] = [];
        const boundaryPositions: Cesium.Cartesian3[] = [];
        for (const node of network?.nodes ?? []) {
            for (const conn of node?.connections ?? []) {
                const fromLink = linkById.get(String(conn.fromLink));
                const toLink = linkById.get(String(conn.toLink));
                if (!fromLink) continue;
                const fromIsMeso = normalizeSimType(fromLink.simType) === "Meso";
                const toIsMeso = toLink ? normalizeSimType(toLink.simType) === "Meso" : fromIsMeso;
                if (!fromIsMeso && toIsMeso) continue; // 마이크로→메조 진입은 toLink 색으로 그 링크 렌더 때 처리
                if (!fromIsMeso) continue; // 둘 다 마이크로 — 개별 차량으로 이미 표시됨

                const coords = conn.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) continue;
                const positions = coords
                    .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                    .map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
                if (positions.length < 2) continue;

                const metric = metricByLane.get(`${conn.fromLink}_${conn.fromLane}`);
                const color = losGradeCesiumColor(metric?.losGrade);
                try {
                    connInstances.push(new Cesium.GeometryInstance({
                        id: `meso_conn_${node.id}_${conn.id}`,
                        geometry: new Cesium.GroundPolylineGeometry({ positions, width: 4 }),
                        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
                    }));
                } catch (_) { /* noop */ }

                // 마이크로/메조 경계 — 한쪽만 메조인 커넥션의 중간 지점에 표시.
                if (fromIsMeso !== toIsMeso) {
                    const mid = positions[Math.floor(positions.length / 2)];
                    if (mid) boundaryPositions.push(mid);
                }
            }
        }

        this._clear();

        if (laneInstances.length > 0) {
            this._lanePrimitive = new Cesium.GroundPrimitive({
                geometryInstances: laneInstances,
                appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
                asynchronous: true,
                classificationType: Cesium.ClassificationType.BOTH,
            });
            this._viewer.scene.groundPrimitives.add(this._lanePrimitive);
        }
        if (connInstances.length > 0) {
            this._connPrimitive = new Cesium.GroundPolylinePrimitive({
                geometryInstances: connInstances,
                appearance: new Cesium.PolylineColorAppearance(),
                asynchronous: true,
                classificationType: Cesium.ClassificationType.BOTH,
            });
            this._viewer.scene.groundPrimitives.add(this._connPrimitive);
        }
        this._boundaryMarkers.entities.suspendEvents();
        this._boundaryMarkers.entities.removeAll();
        for (let i = 0; i < boundaryPositions.length; i++) {
            this._boundaryMarkers.entities.add({
                position: boundaryPositions[i],
                point: {
                    pixelSize: 12,
                    color: BOUNDARY_COLOR,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        this._boundaryMarkers.entities.resumeEvents();
        try { this._viewer.scene.requestRender(); } catch (_) {}
    }

    private _clear(): void {
        if (this._lanePrimitive) {
            try { this._viewer.scene.groundPrimitives.remove(this._lanePrimitive); } catch (_) {}
            this._lanePrimitive = null;
        }
        if (this._connPrimitive) {
            try { this._viewer.scene.groundPrimitives.remove(this._connPrimitive); } catch (_) {}
            this._connPrimitive = null;
        }
    }

    /** 재생 현재 시각 기준 ± 집계 시간창 — LinkMetricPolylineLayer._timeWindow와 동일 패턴. */
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

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        this._clear();
        try { this._viewer.dataSources.remove(this._boundaryMarkers, true); } catch (_) {}
    }
}
