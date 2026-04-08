import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FeatureLike } from "ol/Feature";
import { computeStationCentroidsOl } from "@utils/railStationPosition";
import { fromLonLat } from "ol/proj";
import { Coordinate } from "ol/coordinate";

export default class RailRouteFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railRoute";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

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

        // railStation 또는 network 변경 시 재로드 (exit-centroid 재계산 필요)
        const railStationStore = layerNameToStoreMap["railStation"];
        if (railStationStore) {
            (railStationStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    override setVisible(visible: boolean): void {
        super.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

    public styleFunction(_feature: FeatureLike, _resolution: number): Style[] {
        return [new Style({ stroke: new Stroke({ color: '#0052a5', width: 3 }) })];
    }

    public async load(): Promise<void> {
        // 레이어가 꺼진 상태면 스킵, 켜질 때 재로드
        if (!this.getVisible()) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;
        const store            = layerNameToStoreMap[this.LAYER_NAME];
        const railStationStore = layerNameToStoreMap["railStation"];
        const networkStore     = layerNameToStoreMap["network"];

        try {
            const ptLineData  = store?.getState().currentJsonData;
            const stationData = railStationStore?.getState().currentJsonData;
            const networkData = networkStore?.getState().currentJsonData;

            if (!ptLineData?.routes || !stationData?.railStations || !networkData?.links) {
                this.source.clear(); return;
            }

            // exit centroid 기반 역 위치 (lane 수 반영)
            const centroidMap = computeStationCentroidsOl(stationData.railStations, networkData);

            // centroid 없는 역은 station.coordinates fallback
            const stationCoordMap = new Map<string, Coordinate>();
            for (const station of stationData.railStations) {
                const id = String(station.id ?? "");
                if (centroidMap.has(id)) {
                    const { lng, lat } = centroidMap.get(id)!;
                    stationCoordMap.set(id, fromLonLat([lng, lat]));
                } else if (station.coordinates?.lng && station.coordinates?.lat) {
                    stationCoordMap.set(id, fromLonLat([station.coordinates.lng, station.coordinates.lat]));
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
        } catch (e) {
            console.error("[RailRouteFeatureLayer] load 에러:", e);
        }
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
