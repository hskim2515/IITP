import { Cartesian3, Color, Entity, GeoJsonDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FEATURE_TYPE, RailStationData, TRANSIT_MODE } from "@type/Station";

export default class RailStationDataSourceLayer {
    private readonly LAYER_NAME = "railStation";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            async (currentJsonData) => {
                if (!currentJsonData?.railStations) return;
                try {
                    await this.load(currentJsonData.railStations);
                } catch (error) {
                    console.error("[RailStationDataSourceLayer] railStations 로드 실패:", error);
                }
            },
            {fireImmediately: true}
        );
    }

    private async load(railStations: Record<string, any>[]): Promise<void> {
        // 기존 데이터 제거 후 초기화
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        console.log("railStations:::", railStations)


        const store = layerNameToStoreMap[this.LAYER_NAME];
        console.log("store.getState().currentJsonData:::", store.getState().currentJsonData)


        for(const railStation of railStations) {


            const coord = railStation.coordinates[0];
            const stationPosition = Cartesian3.fromDegrees(coord.lng, coord.lat);

            this.dataSource.entities.add(
                new Entity({
                    position: stationPosition,
                    point: {
                        pixelSize: 6,
                        color: Color.BLUE,
                        outlineWidth: 1,
                        outlineColor: Color.TRANSPARENT,
                    },
                    properties: {
                        ...railStation,
                        transitMode: railStation.transitMode ?? TRANSIT_MODE.SUBWAY,
                        featureType: FEATURE_TYPE.RAIL_STATION,
                    },
                })
            );
            for(const exit of railStation.exits){
                const exitCoord = exit.coordinates?.[0];
                if (!exitCoord || exitCoord.lng == null || exitCoord.lat == null) {
                    // console.warn("[load] exit 좌표가 유효하지 않습니다:", exit);
                    continue;
                }
                const exitPosition = Cartesian3.fromDegrees(exitCoord.lng, exitCoord.lat);

                this.dataSource.entities.add(
                    new Entity({
                        position: exitPosition,
                        point: {
                            pixelSize: 6,
                            color: Color.PURPLE,
                            outlineWidth: 1,
                            outlineColor: Color.TRANSPARENT,
                        },
                        properties: {
                            ...exit,
                            featureType: FEATURE_TYPE.RAIL_STATION_EXIT,
                        },
                    })
                );
            }
        }

        await this.viewer.dataSources.add(this.dataSource);
        console.log("[RailStationDataSourceLayer] 로드 완료: ", this.dataSource.entities.values.length);
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
