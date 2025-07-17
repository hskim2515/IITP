import { Viewer, GeoJsonDataSource, Cartesian3, Entity, Color } from "cesium";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";
import { BusStationData, FEATURE_TYPE, TRANSIT_MODE } from "@type/Station";

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "busStation";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            async (currentJsonData) => {
                if (!currentJsonData?.busStations) return;
                try {
                    await this.load(currentJsonData.busStations);
                } catch (error) {
                    console.error("[BusStationDataSourceLayer] busStations 로드 실패:", error);
                }
            },
            { fireImmediately: true }
        );
    }

    private async load(busStations: Record<string, any>[]): Promise<void> {
        // 기존 데이터 제거 후 초기화
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        console.log("busStations:::", busStations)


        const store = layerNameToStoreMap[this.LAYER_NAME];
        console.log("store.getState().currentJsonData:::", store.getState().currentJsonData)


        busStations.map((data) => {
            const props: BusStationData = {
                ...data,
                transitMode: data.transitMode ?? TRANSIT_MODE.BUS,
                featureType: data.featureType ?? FEATURE_TYPE.BUS_STATION,
            };
            const coord = data.coordinates[0];
            const position = Cartesian3.fromDegrees(coord.lng, coord.lat);

            this.dataSource.entities.add(
                new Entity({
                    position,
                    point: {
                        pixelSize: 6,
                        color: Color.RED,
                        outlineWidth: 1,
                        outlineColor:  Color.TRANSPARENT,
                    },
                    properties: props,
                })
            );

        })

        await this.viewer.dataSources.add(this.dataSource);
        console.log("[BusStationDataSourceLayer] 로드 완료: ", this.dataSource.entities.values.length);
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
