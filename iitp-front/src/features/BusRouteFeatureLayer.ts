import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { fromLonLat } from "ol/proj";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";
import { Coordinate } from "ol/coordinate";
import { computeLaneCenterlineOl, computeMedianCenterlineOl } from "@utils/interpolateByOffset";

export default class BusRouteFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busRoute";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 300,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
        this.source = source;
        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = (store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => { const _d = useNetworkDrawStore.getState(); if (!_d.isActive && !_d.isConnectionActive) this.load(); },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }


    override setVisible(visible: boolean): void {
        super.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

        public styleFunction(feature: FeatureLike, _resolution: number): Style[] {
        // 디버깅용 — medianLane(중앙버스전용차로) 구간을 다른 색으로 표시(3D BusRouteDataSourceLayer와
        // 동일 계열: #ff4081)해 실제로 어떤 링크가 중앙차로로 분류됐는지 바로 구분한다.
        const isMedian = feature.get('isMedian') === true;
        return [new Style({ stroke: new Stroke({ color: isMedian ? '#ff4081' : '#ff8800', width: 5 }) })];
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const data = store.getState().currentJsonData;
        if (!data?.lines) { this.source.clear(); return; }

        const networkData = layerNameToStoreMap["network"]?.getState().currentJsonData as any;

        // linkId → link 객체 맵 (차선 중심선 계산용)
        const linkById = new Map<string, any>();
        for (const link of networkData?.links ?? []) {
            if (link.coordinates?.length >= 2) linkById.set(String(link.id), link);
        }
        // linkRef → station 맵 (실제 정류장이 어느 차선에 있는지 조회용)
        const busStationData = layerNameToStoreMap["busStation"]?.getState().currentJsonData as any;
        const stationById = new Map<string, any>();
        for (const st of busStationData?.busStations ?? []) {
            if (st?.id != null) stationById.set(String(st.id), st);
        }

        // 노선이 지나는 링크마다 그릴 "가상 차선 인덱스"의 분율(0=저장방향 기준 좌측 끝,
        // 1=우측 끝)을 구한다. 정류장이 붙은 링크는 그 정류장의 실제 laneRef를 쓰고(중앙
        // 버스전용차로 노선처럼 가장자리가 아닌 경우도 정확히 반영됨 — 가장자리를 무조건
        // 가정하면 틀린다는 실사용 지적으로 수정), 정류장이 없는 통과링크는 가장 가까운
        // 정류장의 분율을 그대로 이어받는다. 노선 전체에 정류장 매칭이 하나도 없으면
        // 중앙(0.5)을 안전한 기본값으로 쓴다(3D BusRouteDataSourceLayer와 동일 로직).
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

        // 정류장이 medianLane(중앙버스전용차로)로 스냅된 링크 집합 — 이 링크는 laneFractions로
        // 흉내낼 수 없다(이 링크 혼자만의 차선 배열 안에는 진짜 물리적 중앙이 없음, 실사용
        // 지적: "중앙차선일 경우 링크의 중앙이 아닌 상하행의 중간에 있어야 함").
        const buildMedianLinks = (stationSeq: string[]): Set<string> => {
            const result = new Set<string>();
            for (const stId of stationSeq) {
                const st = stationById.get(stId);
                if (st?.medianLane && st.linkRef != null) result.add(String(st.linkRef));
            }
            return result;
        };

        // linkSeq를 따라 위에서 구한 분율의 차선 중심선(또는 medianLinks면 상하행 중간)을
        // 링크 단위로 잘라 반환한다(색상 구분을 위해 하나로 합치지 않음). 링크 저장 방향이
        // 노선 진행 방향과 반대인 경우(양방향 도로가 흔함) 그대로 이으면 지그재그가 생기므로
        // 직전 링크 끝점과 더 가까운 쪽 끝을 시작점으로 삼도록 필요시 뒤집는다.
        const buildColoredSegments = (
            linkIds: string[], laneFractions: Map<string, number>, medianLinks: Set<string>
        ): { positions: Coordinate[]; isMedian: boolean }[] => {
            const segments: { positions: Coordinate[]; isMedian: boolean }[] = [];
            let prevLast: Coordinate | null = null;
            for (const linkId of linkIds) {
                const link = linkById.get(linkId);
                if (!link) continue;
                const isMedian = medianLinks.has(linkId);
                let pts: Coordinate[] | null;
                if (isMedian) {
                    pts = computeMedianCenterlineOl(link, networkData?.links ?? []);
                } else {
                    const laneCount = Math.max(1, link.lanes?.length ?? 1);
                    const fraction = laneFractions.get(linkId) ?? 0.5;
                    pts = computeLaneCenterlineOl(link, fraction * (laneCount - 1));
                }
                if (!pts || pts.length < 2) continue;
                if (prevLast) {
                    const first = pts[0]!;
                    const lastOfSeg = pts[pts.length - 1]!;
                    const distForward = Math.hypot(prevLast[0]! - first[0]!, prevLast[1]! - first[1]!);
                    const distReversed = Math.hypot(prevLast[0]! - lastOfSeg[0]!, prevLast[1]! - lastOfSeg[1]!);
                    if (distReversed < distForward) pts = [...pts].reverse();
                }
                segments.push({ positions: pts, isMedian });
                prevLast = pts[pts.length - 1]!;
            }
            return segments;
        };

        const features: Feature[] = [];
        const pushSeg = (line: any, coords: Coordinate[], isMedian: boolean) => {
            if (coords.length < 2) return;
            const f = new Feature(new LineString(coords));
            f.setProperties({ id: line.id, interval: line.interval, featureType: "busRoute", isMedian });
            features.push(f);
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
                    pushSeg(line, seg.positions, seg.isMedian);
                }
            } else if (Array.isArray(line.coords) && line.coords.length >= 2) {
                let seg: Coordinate[] = [];
                for (const c of line.coords) {
                    if (c === null) {
                        pushSeg(line, seg, false);
                        seg = [];
                    } else {
                        seg.push(fromLonLat([c.lng, c.lat]));
                    }
                }
                pushSeg(line, seg, false);
            }
        }
        this.source.clear();
        this.source.addFeatures(features);
        console.log(`[BusRouteFeatureLayer] 로드 완료: ${features.length}개 노선`);
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
