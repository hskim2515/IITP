import { Viewer, GeoJsonDataSource, Cartesian3, Entity, Color } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusStationData, FEATURE_TYPE, TRANSIT_MODE } from "@type/Station";
import { diff } from "deep-object-diff";

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "busStation";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: (() => void) | undefined;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load();
                },
                {equalityFn: (a, b) => Object.keys(diff(a, b)).length === 0}
            );
        }
    }

    public load(): void {
        if (!this.dataSource) return;
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const store = layerNameToStoreMap[this.LAYER_NAME];
            const busStations = store.getState().currentJsonData?.busStations;

            if (!busStations) {
                console.log("[BusStationDataSourceLayer] No bus stations data to load.");
                return;
            }

            busStations.forEach((data) => {
                const props: BusStationData = {
                    ...data,
                    transitMode: data.transitMode ?? TRANSIT_MODE.BUS,
                    featureType: data.featureType ?? FEATURE_TYPE.BUS_STATION,
                };
                const coord = data.coordinates;

                if (!coord || coord.lng == null || coord.lat == null) return;

                const position = Cartesian3.fromDegrees(coord.lng, coord.lat);

                this.dataSource.entities.add(
                    new Entity({
                        id: data.__guid,
                        position,
                        point: {
                            pixelSize: 6,
                            color: Color.RED,
                            outlineWidth: 1,
                            outlineColor: Color.TRANSPARENT,
                        },
                        properties: props,
                    })
                );
            });

            console.log("BusStationDataSourceLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("BusStationDataSourceLayer.load() 중 에러 발생:", error);
        } finally {
            this.dataSource.entities.resumeEvents();
        }
    }

    public destroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.dataSource) {
            this.viewer.dataSources.remove(this.dataSource, true);
        }
    }
}