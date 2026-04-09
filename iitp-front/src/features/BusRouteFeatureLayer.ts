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

        public styleFunction(_feature: FeatureLike, _resolution: number): Style[] {
        return [new Style({ stroke: new Stroke({ color: '#ff8800', width: 5 }) })];
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const data = store.getState().currentJsonData;
        if (!data?.lines) { this.source.clear(); return; }

        const networkData = layerNameToStoreMap["network"]?.getState().currentJsonData as any;
        if (!networkData?.links) return;

        // linkId → 좌표 배열 맵 (네트워크 스토어에서 직접 구성)
        const linkCoordMap = new Map<string, Coordinate[]>();
        for (const link of networkData.links) {
            if (!link.coordinates?.length) continue;
            const coords: Coordinate[] = link.coordinates
                .filter((c: any) => c?.lng != null && c?.lat != null)
                .map((c: any) => fromLonLat([c.lng, c.lat]));
            if (coords.length >= 2) {
                linkCoordMap.set(String(link.id), coords);
            }
        }

        if (linkCoordMap.size === 0) return;

        const features: Feature[] = [];
        for (const line of data.lines) {
            const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
            const coords: Coordinate[] = [];
            for (const linkId of linkIds) {
                const linkCoords = linkCoordMap.get(linkId);
                if (linkCoords) coords.push(...linkCoords);
            }
            if (coords.length >= 2) {
                const f = new Feature(new LineString(coords));
                f.setProperties({ id: line.id, interval: line.interval, featureType: "busRoute" });
                features.push(f);
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
