import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Color, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { computeLaneCenterlineCesium, computeMedianCenterlineCesium } from "@utils/offset";
import * as Cesium from "cesium";

const ROUTE_COLOR = Color.fromCssColorString("#ff8800");
/* 디버깅용 — medianLane(중앙버스전용차로) 구간을 다른 색으로 표시해 실제로 어떤 링크가
 * 중앙차로로 분류됐는지 지도에서 바로 구분할 수 있게 한다. */
const MEDIAN_ROUTE_COLOR = Color.fromCssColorString("#ff4081");

export default class BusRouteDataSourceLayer {
    private readonly LAYER_NAME = "busRoute";
    private primitive: Cesium.GroundPolylinePrimitive | null = null;
    private unsubscribe: (() => void) | undefined;
    private visible = true;
    private needsReload = false;
    private loadTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private viewer: Viewer) {
        this.scheduleLoad();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = (store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.scheduleLoad(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => {
                    const _d = useNetworkDrawStore.getState();
                    if (!_d.isActive && !_d.isConnectionActive) this.scheduleLoad();
                },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.primitive) this.primitive.show = visible;
        if (visible && this.needsReload) this.scheduleLoad();
    }

    private scheduleLoad(): void {
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => { this.loadTimer = null; this.load(); }, 150);
    }

    public load(): void {
        if (!this.visible) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        const data = store?.getState().currentJsonData;
        const networkStore = layerNameToStoreMap["network"];
        const networkData = networkStore?.getState().currentJsonData;

        /* 기존 primitive 제거 */
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }

        if (!data?.lines || !networkData?.links) return;

        /* linkId → link 객체 맵 (차선 중심선 계산용) */
        const linkById = new Map<string, any>();
        for (const link of networkData.links) {
            if (link.coordinates?.length >= 2) linkById.set(String(link.id), link);
        }
        /* linkRef → station 맵 (실제 정류장이 어느 차선에 있는지 조회용) */
        const busStationData = layerNameToStoreMap["busStation"]?.getState().currentJsonData as any;
        const stationById = new Map<string, any>();
        for (const st of busStationData?.busStations ?? []) {
            if (st?.id != null) stationById.set(String(st.id), st);
        }

        /* 노선이 지나는 링크마다 그릴 "가상 차선 인덱스"의 분율(0=저장방향 기준 좌측 끝,
           1=우측 끝)을 구한다. 정류장이 붙은 링크는 그 정류장의 실제 laneRef를 쓰고(중앙
           버스전용차로 노선처럼 가장자리가 아닌 경우도 정확히 반영됨 — 가장자리를 무조건
           가정하면 틀린다는 실사용 지적으로 수정), 정류장이 없는 통과링크는 가장 가까운
           정류장의 분율을 그대로 이어받는다(앞쪽에 정류장이 없으면 노선에서 처음 나오는
           분율을 미리 당겨쓴다). 노선 전체에 정류장 매칭이 하나도 없으면 중앙(0.5)을 안전한
           기본값으로 쓴다. */
        const buildLaneFractions = (linkIds: string[], stationSeq: string[]): Map<string, number> => {
            const rawByLink = new Map<string, number>();
            for (const stId of stationSeq) {
                const st = stationById.get(stId);
                if (!st || st.linkRef == null) continue;
                const link = linkById.get(String(st.linkRef));
                if (!link) continue;
                const laneCount = Math.max(1, link.lanes?.length ?? 1);
                const laneRef = Number(st.laneRef ?? 0);
                rawByLink.set(String(st.linkRef), laneCount > 1 ? laneRef / (laneCount - 1) : 0.5);
            }
            let firstKnown: number | undefined;
            for (const linkId of linkIds) {
                if (rawByLink.has(linkId)) { firstKnown = rawByLink.get(linkId); break; }
            }
            const result = new Map<string, number>();
            let last = firstKnown;
            for (const linkId of linkIds) {
                if (rawByLink.has(linkId)) last = rawByLink.get(linkId);
                result.set(linkId, last ?? 0.5);
            }
            return result;
        };

        /* 정류장이 medianLane(중앙버스전용차로)로 스냅된 링크 집합 — 이 링크는 laneFractions로
           흉내낼 수 없다(이 링크 혼자만의 차선 배열 안에는 진짜 물리적 중앙이 없음, 실사용
           지적: "중앙차선일 경우 링크의 중앙이 아닌 상하행의 중간에 있어야 함"). */
        const buildMedianLinks = (stationSeq: string[]): Set<string> => {
            const result = new Set<string>();
            for (const stId of stationSeq) {
                const st = stationById.get(stId);
                if (st?.medianLane && st.linkRef != null) result.add(String(st.linkRef));
            }
            return result;
        };

        /* linkSeq를 따라 위에서 구한 분율의 차선 중심선(또는 medianLinks면 상하행 중간)을
           링크 단위로 잘라 반환한다(색상 구분을 위해 하나로 합치지 않음). 링크 저장 방향이
           노선 진행 방향과 반대인 경우(양방향 도로가 흔함) 그대로 이으면 지그재그가 생기므로
           직전 링크 끝점과 더 가까운 쪽 끝을 시작점으로 삼도록 필요시 뒤집는다. */
        const buildColoredSegments = (
            linkIds: string[], laneFractions: Map<string, number>, medianLinks: Set<string>
        ): { positions: Cesium.Cartesian3[]; isMedian: boolean }[] => {
            const segments: { positions: Cesium.Cartesian3[]; isMedian: boolean }[] = [];
            let prevLast: Cesium.Cartesian3 | null = null;
            for (const linkId of linkIds) {
                const link = linkById.get(linkId);
                if (!link) continue;
                const isMedian = medianLinks.has(linkId);
                let pts: Cesium.Cartesian3[] | null;
                if (isMedian) {
                    pts = computeMedianCenterlineCesium(link, networkData.links);
                } else {
                    const laneCount = Math.max(1, link.lanes?.length ?? 1);
                    const fraction = laneFractions.get(linkId) ?? 0.5;
                    pts = computeLaneCenterlineCesium(link, fraction * (laneCount - 1));
                }
                if (!pts || pts.length < 2) continue;
                if (prevLast) {
                    const distForward = Cesium.Cartesian3.distance(prevLast, pts[0]!);
                    const distReversed = Cesium.Cartesian3.distance(prevLast, pts[pts.length - 1]!);
                    if (distReversed < distForward) pts = [...pts].reverse();
                }
                segments.push({ positions: pts, isMedian });
                prevLast = pts[pts.length - 1]!;
            }
            return segments;
        };

        /* GeometryInstance 생성 — 세그먼트(null separator 기준/링크 단위)마다 별도 instance */
        const MIN_SEG_DIST = 1.0; // Cesium은 동일/근접 좌표에서 WebGL 오류 발생
        const dedup = (pts: Cesium.Cartesian3[]): Cesium.Cartesian3[] => {
            const out: Cesium.Cartesian3[] = [pts[0]];
            for (let i = 1; i < pts.length; i++) {
                if (Cesium.Cartesian3.distance(pts[i], out[out.length - 1]) >= MIN_SEG_DIST)
                    out.push(pts[i]);
            }
            return out;
        };
        const instances: Cesium.GeometryInstance[] = [];
        const pushSeg = (lineId: any, seg: Cesium.Cartesian3[], color: Cesium.Color) => {
            if (seg.length < 2) return;
            const clean = dedup(seg);
            if (clean.length < 2) return;
            try {
                instances.push(new Cesium.GeometryInstance({
                    id: { id: lineId, featureType: "busRoute" },
                    geometry: new Cesium.GroundPolylineGeometry({ positions: clean, width: 5 }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
                    },
                }));
            } catch (_) {}
        };

        for (const line of data.lines) {
            // link.seq(실제 네트워크 링크 체인)를 우선 사용 — 정류장(linkRef 기반)이 참조하는
            // 것과 동일한 형상이라 도로/정류장 위치와 항상 일치한다. coords(OSM 원본 좌표)는
            // extendToTerminal() 등으로 link.seq와 재동기화되지 않아 도로에서 벗어날 수 있으므로
            // link.seq가 없는 노선(스냅 실패 등)에 대해서만 폴백으로 쓴다.
            const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
            if (linkIds.length > 0) {
                const stationSeq: string[] = (line.station?.seq ?? "").trim().split(/\s+/).filter(Boolean);
                const laneFractions = buildLaneFractions(linkIds, stationSeq);
                const medianLinks = buildMedianLinks(stationSeq);
                for (const seg of buildColoredSegments(linkIds, laneFractions, medianLinks)) {
                    pushSeg(line.id, seg.positions, seg.isMedian ? MEDIAN_ROUTE_COLOR : ROUTE_COLOR);
                }
            } else if (Array.isArray(line.coords) && line.coords.length >= 2) {
                let seg: Cesium.Cartesian3[] = [];
                for (const c of line.coords) {
                    if (c === null) {
                        pushSeg(line.id, seg, ROUTE_COLOR);
                        seg = [];
                    } else {
                        seg.push(Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
                    }
                }
                pushSeg(line.id, seg, ROUTE_COLOR);
            }
        }
        if (!instances.length) return;

        this.primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineColorAppearance(),
            show: this.visible,
        });
        this.viewer.scene.primitives.add(this.primitive);
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    public destroy(): void {
        if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
        this.unsubscribe?.();
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }
    }
}
