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

export default class BusRouteWeekendFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busRouteWeekend";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 298,
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

        public styleFunction(_feature: FeatureLike, _resolution: number): Style[] {
        return [new Style({ stroke: new Stroke({ color: '#ffaa00', width: 5, lineDash: [4, 4] }) })];
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const data = store.getState().currentJsonData;
        if (!data?.lines) { this.source.clear(); return; }

        const networkData = layerNameToStoreMap["network"]?.getState().currentJsonData as any;

        // linkId → 좌표 배열 맵 (네트워크 스토어에서 직접 구성) — line.coords가 없는 노선의
        // link.seq 폴백 재구성에만 쓰인다.
        const linkCoordMap = new Map<string, Coordinate[]>();
        for (const link of networkData?.links ?? []) {
            if (!link.coordinates?.length) continue;
            const coords: Coordinate[] = link.coordinates
                .filter((c: any) => c?.lng != null && c?.lat != null)
                .map((c: any) => fromLonLat([c.lng, c.lat]));
            if (coords.length >= 2) {
                linkCoordMap.set(String(link.id), coords);
            }
        }

        const features: Feature[] = [];
        const pushSeg = (line: any, coords: Coordinate[]) => {
            if (coords.length < 2) return;
            const f = new Feature(new LineString(coords));
            f.setProperties({ id: line.id, interval: line.interval, featureType: "busRouteWeekend" });
            features.push(f);
        };
        for (const line of data.lines) {
            // line.coords(OSM 원본 순서 그대로의 실제 경로 좌표, 3D BusRouteDataSourceLayer와
            // 동일 우선순위)가 있으면 그걸 쓴다 — link.seq→linkCoordMap 방식은 링크가 노선
            // 진행 방향과 반대로 저장돼 있어도 그대로 이어붙여 지그재그가 생길 수 있어(실측:
            // 2D에서만 노선이 꼬여 보임, 3D는 이미 coords를 우선 사용해 정상) 폴백으로만 쓴다.
            if (Array.isArray(line.coords) && line.coords.length >= 2) {
                let seg: Coordinate[] = [];
                for (const c of line.coords) {
                    if (c === null) {
                        pushSeg(line, seg);
                        seg = [];
                    } else {
                        seg.push(fromLonLat([c.lng, c.lat]));
                    }
                }
                pushSeg(line, seg);
            } else {
                const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
                const coords: Coordinate[] = [];
                for (const linkId of linkIds) {
                    const linkCoords = linkCoordMap.get(linkId);
                    if (linkCoords) coords.push(...linkCoords);
                }
                pushSeg(line, coords);
            }
        }
        this.source.clear();
        this.source.addFeatures(features);
        console.log(`[BusRouteWeekendFeatureLayer] 로드 완료: ${features.length}개 노선`);
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
