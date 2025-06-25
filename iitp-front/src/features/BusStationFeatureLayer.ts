import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Fill, Stroke, Circle as CircleStyle, Style } from "ol/style";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "BUS_STATION";
    private unsubscribe: () => void;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 410,
            // updateWhileAnimating: true,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        const store = menuCodeToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            // (geojson) => {
            //     const format = new GeoJSON({ featureProjection: "EPSG:3857" });
            //     const features = format.readFeatures(geojson);
            //     source.clear(true);
            //     source.addFeatures(features);
            // },
            async (geojson) => {
                if (!geojson) return;
                try {
                    await this.load(geojson);
                } catch (error) {
                    console.error("[BusStationFeatureLayer] GeoJSON 로드 실패:", error);
                }
            },
            { fireImmediately: true }
        );

        this.source = source;
    }

    private styleFunction(feature: Feature, resolution: number): Style[] {
        const props = feature.get("properties") ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        if (geom instanceof Point) {
            styles.push(new Style({
                image: new CircleStyle({
                    radius: 6,
                    fill: new Fill({ color: "rgba(255,0,0,1)" }),
                    stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
                }),
            }),);
        }
        return styles;
    }

    public async load(): Promise<void> {

        const store = menuCodeToStoreMap[this.LAYER_NAME]

        try {
            const { busStations } = store.getState().originData; // 서버가 lng, lat 계산 가정
            const selectedScenario = useScenarioStore.getState().selectedScenario;
            console.log("station:::", busStations)
            console.log("station lonlat:::", busStations[0].lng, busStations[0].lat)

            const featureBuffer: Feature[] = [];

            busStations.forEach((station: Record<string, string | number>) => {
                const lng = station.lng as number
                const lat = station.lat as number
                const point = new Point(fromLonLat([lng, lat]))
                featureBuffer.push(new Feature({
                    geometry: point,
                    properties: { ...station, featureType: "busStation"},
                }));
            })

            this.source.addFeatures(featureBuffer);
            console.log("NetworkLayer: 로드 완료");
        } catch (e) {
            console.error("NetworkLayer.load 에러:", e);
        }
    }
}
