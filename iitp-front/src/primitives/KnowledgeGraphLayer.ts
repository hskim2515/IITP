import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useLayerStore } from "@stores/useLayerStore";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import { getAdminRegionTier, KNOWLEDGE_GRAPH } from "@utils/lodConstants";
import { losGradeCesiumColor } from "@utils/losScale";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";
import ParabolicArrowPrimitive from "./ParabolicArrowPrimitive";

export type GraphType = "regionOd" | "congestionAdjacency";

/** "지식그래프" 느낌 — 지역 OD 관계 노드 고정 색(보라 계열), 크기만 volume에 비례 */
const REGION_NODE_COLOR = Cesium.Color.fromCssColorString("#8b5cf6");

/**
 * 지식그래프 스타일 분석 레이어 2종의 공용 렌더러 — `LinkMetricPolylineLayer`가 congestion/los/
 * bottleneck 3종을 metric 파라미터로 공유하는 것과 동일한 패턴. 노드=원(포인트 엔티티), 엣지=
 * 기존 `ParabolicArrowPrimitive`(OD 화살표에 이미 쓰이는 포물선 커넥터) 재사용.
 *
 * - regionOd: 지역(시도/시군구/읍면동, 줌에 따라 자동 tier) 간 OD 관계. 경계 지오메트리 없이
 *   지역 자체를 노드로만 쓰므로 region-traffic보다 훨씬 가볍다 — 재생시각 구독 throttle fetch.
 * - congestionAdjacency: V/C 임계값 이상 정체 링크를 노드로, 네트워크 커넥션으로 이어진 정체
 *   링크끼리 엣지 — LinkMetricPolylineLayer와 동일하게 카메라bbox+재생시각 구독.
 *
 * 표시 여부는 분석 메뉴 체크박스가 소유, 줌은 세밀도(tier)/fetch 범위 결정에만 관여 — 기존 방침.
 */
export default class KnowledgeGraphLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private readonly _viewer: Cesium.Viewer;
    private readonly _graphType: GraphType;
    private readonly _layerName: string;
    private _show = false;
    private _active = false;

    private readonly _nodesDs: Cesium.CustomDataSource;
    private readonly _edgeArrow: ParabolicArrowPrimitive;

    private _lastFetchWall = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _layerUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        this._nodesDs.show = val;
        this._edgeArrow.setVisible(val);
    }

    constructor(
        viewer: Cesium.Viewer,
        graphType: GraphType,
        // OL(2D) 쪽에 같은 fetch 결과를 공유하기 위한 콜백 — 중복 HTTP 요청 방지
        private readonly onData?: (nodes: any[], edges: any[]) => void,
    ) {
        this._viewer = viewer;
        this._graphType = graphType;
        this._layerName = graphType === "regionOd" ? "regionOdGraph" : "congestionGraph";

        this._nodesDs = new Cesium.CustomDataSource(`kg-${graphType}`);
        this._nodesDs.show = false;
        viewer.dataSources.add(this._nodesDs);
        this._edgeArrow = new ParabolicArrowPrimitive(viewer.scene.context, [] as any);

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
            catch (e) { console.warn(`[KnowledgeGraph:${this._graphType}] 갱신 실패 (무시):`, e); }
        }, 250);
    }

    private _update(): void {
        if (this.destroyed) return;
        const userOn = (useLayerStore.getState().activeLayerName ?? []).includes(this._layerName);
        this._setActive(userOn);
        if (!userOn) return;

        const now = performance.now();
        if (now - this._lastFetchWall < KNOWLEDGE_GRAPH.REFRESH_THROTTLE_MS) return;
        this._lastFetchWall = now;

        if (this._graphType === "regionOd") this._fetchRegionOd();
        else this._fetchCongestion();
    }

    /** 재생 현재 시각 기준 ± 집계 시간창. clock 미준비 시 {0,window*2}(유한 창) — {0,0}은 백엔드가
     *  "전체 시간 누적"으로 해석해 순간과 무관한 값이 나온다(이번 세션에 반복 발견한 함정). */
    private _timeWindow(windowSec: number): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return { fromTime: 0, toTime: windowSec * 2 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            return { fromTime: Math.max(0, sec - windowSec), toTime: sec + windowSec };
        } catch {
            return { fromTime: 0, toTime: windowSec * 2 };
        }
    }

    private _fetchRegionOd(): void {
        const versionId = getActiveVersionId();
        if (!versionId) return;
        const metrics = computeViewportMetrics(this._viewer);
        const tier = metrics ? getAdminRegionTier(metrics.pixelSizeM) : "eupmyeondong";
        const { fromTime, toTime } = this._timeWindow(KNOWLEDGE_GRAPH.REGION_OD_TIME_WINDOW_SEC);

        axiosInstance.get(`/analytics/region-od-graph/${versionId}`, { params: { tier, fromTime, toTime } })
            .then((res) => {
                if (this.destroyed) return;
                const nodes = res.data?.nodes ?? [];
                const edges = res.data?.edges ?? [];
                this._renderRegionOd(nodes, edges);
                this.onData?.(nodes, edges);
                try { this._viewer.scene.requestRender(); } catch (_) {}
            })
            .catch((err) => {
                if (err?.response?.status !== 404) console.warn("[KnowledgeGraph:regionOd] 조회 실패", err);
            });
    }

    private _fetchCongestion(): void {
        const versionId = getActiveVersionId();
        if (!versionId) return;
        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) return;
        const { w, s, e, n } = metrics.bbox;
        const { fromTime, toTime } = this._timeWindow(KNOWLEDGE_GRAPH.CONGESTION_TIME_WINDOW_SEC);

        axiosInstance.get(`/analytics/congestion-graph/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime, threshold: KNOWLEDGE_GRAPH.CONGESTION_THRESHOLD },
        })
            .then((res) => {
                if (this.destroyed) return;
                const nodes = res.data?.nodes ?? [];
                const edges = res.data?.edges ?? [];
                this._renderCongestion(nodes, edges);
                this.onData?.(nodes, edges);
                try { this._viewer.scene.requestRender(); } catch (_) {}
            })
            .catch((err) => {
                if (err?.response?.status !== 404) console.warn("[KnowledgeGraph:congestionAdjacency] 조회 실패", err);
            });
    }

    private _renderRegionOd(nodes: any[], edges: any[]): void {
        const maxVolume = Math.max(1, ...nodes.map((nd) => nd.totalVolume ?? 0));
        const byCode = new Map<string, any>(nodes.map((nd) => [nd.code, nd]));

        this._nodesDs.entities.suspendEvents();
        this._nodesDs.entities.removeAll();
        for (const nd of nodes) {
            if (!nd.centroid) continue;
            const [lng, lat] = nd.centroid;
            const size = 10 + ((nd.totalVolume ?? 0) / maxVolume) * 30;
            this._nodesDs.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lng, lat),
                point: {
                    pixelSize: size,
                    color: REGION_NODE_COLOR.withAlpha(0.85),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: `${nd.name ?? nd.code}\n${(nd.totalVolume ?? 0).toLocaleString()}대`,
                    font: "12px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -size - 8),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        this._nodesDs.entities.resumeEvents();

        const maxEdgeVolume = Math.max(1, ...edges.map((ed: any) => ed.volume ?? 0));
        const odData = edges
            .map((ed: any) => {
                const from = byCode.get(ed.from);
                const to = byCode.get(ed.to);
                if (!from?.centroid || !to?.centroid) return null;
                return {
                    fromCoord: from.centroid,
                    toCoord: to.centroid,
                    density: Math.min(1, (ed.volume ?? 0) / maxEdgeVolume),
                };
            })
            .filter(Boolean);
        this._edgeArrow.setOdData(odData);
    }

    private _renderCongestion(nodes: any[], edges: any[]): void {
        const byId = new Map<string, any>(nodes.map((nd) => [nd.linkId, nd]));

        this._nodesDs.entities.suspendEvents();
        this._nodesDs.entities.removeAll();
        for (const nd of nodes) {
            if (!nd.centroid) continue;
            const [lng, lat] = nd.centroid;
            this._nodesDs.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lng, lat),
                point: {
                    pixelSize: 14,
                    color: losGradeCesiumColor(nd.losGrade),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                    text: `V/C ${(nd.vcRatio ?? 0).toFixed(2)}`,
                    font: "11px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -20),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
        this._nodesDs.entities.resumeEvents();

        // 엣지 자체엔 심각도가 없어 양끝 노드 V/C 평균으로 색 농도(density)를 근사한다
        const odData = edges
            .map((ed: any) => {
                const from = byId.get(ed.from);
                const to = byId.get(ed.to);
                if (!from?.centroid || !to?.centroid) return null;
                const avgVc = ((from.vcRatio ?? 0) + (to.vcRatio ?? 0)) / 2;
                return { fromCoord: from.centroid, toCoord: to.centroid, density: Math.min(1, avgVc) };
            })
            .filter(Boolean);
        this._edgeArrow.setOdData(odData);
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this.show = active;
    }

    // ── 외부 인터페이스 (개별 차량 위치는 사용하지 않음 — 집계 기반) ──────────
    public setLatestPositions(_data: any) {}
    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // PrimitiveCollection이 매 프레임 호출 — 엣지(ParabolicArrowPrimitive)만 실제 draw call 필요
    update(frameState: any) {
        if (this.destroyed) return;
        this._edgeArrow.update(frameState);
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        this._layerUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        this._edgeArrow.destroy();
        try { this._viewer.dataSources.remove(this._nodesDs, true); } catch (_) {}
    }
}
