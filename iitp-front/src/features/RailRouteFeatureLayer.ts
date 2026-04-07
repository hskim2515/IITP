import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";
import { fromLonLat } from "ol/proj";
import { Coordinate } from "ol/coordinate";

export default class RailRouteFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railRoute";
    private unsubscribe: (() => void) | undefined;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 395,
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

        // railStation 데이터가 바뀌어도 재로드
        const railStationStore = layerNameToStoreMap["railStation"];
        if (railStationStore) {
            (railStationStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    public styleFunction(_feature: FeatureLike, _resolution: number): Style[] {
        return [new Style({ stroke: new Stroke({ color: '#0066ff', width: 3 }) })];
    }

    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const railStationStore = layerNameToStoreMap["railStation"];
        if (!store || !railStationStore) return;

        const ptLineData = store.getState().currentJsonData;
        const stationData = railStationStore.getState().currentJsonData;
        if (!ptLineData?.routes || !stationData?.railStations) { this.source.clear(); return; }

        // 역 ID → 좌표 맵 구성
        const stationCoordMap = new Map<string, Coordinate>();
        for (const station of stationData.railStations) {
            if (station.id != null && station.coordinates?.lng && station.coordinates?.lat) {
                stationCoordMap.set(String(station.id), fromLonLat([station.coordinates.lng, station.coordinates.lat]));
            }
        }

        const features: Feature[] = [];
        for (const route of ptLineData.routes) {
            const stationIds: string[] = (route.railStationSeq ?? "").trim().split(/\s+/).filter(Boolean);
            const coords: Coordinate[] = [];
            for (const sid of stationIds) {
                const coord = stationCoordMap.get(sid);
                if (coord) coords.push(coord);
            }
            if (coords.length >= 2) {
                const f = new Feature(new LineString(coords));
                f.setProperties({ id: route.id, name: route.name, featureType: "railRoute" });
                features.push(f);
            }
        }
        this.source.clear();
        this.source.addFeatures(features);
        console.log(`[RailRouteFeatureLayer] 로드 완료: ${features.length}개 노선`);
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
