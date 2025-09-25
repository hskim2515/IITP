import { Cartesian3, Color, Entity, GeoJsonDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FEATURE_TYPE, RailPublicStationResponse, TRANSIT_MODE } from "@type/Station";
import { diff } from "deep-object-diff";
import { computePositionAtOffsetCesium } from "@utils/offset";

export default class RailStationDataSourceLayer {
    private readonly LAYER_NAME = "railStation";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: (() => void) | undefined;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: {currentJsonData: RailPublicStationResponse}) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load();
                },
                {equalityFn: (a: RailPublicStationResponse, b: RailPublicStationResponse) => diff(a, b) === undefined}
            );
        }
    }

    public load(): void {
        if (!this.dataSource) return;
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const store = layerNameToStoreMap[this.LAYER_NAME];
            const railStations = store.getState().currentJsonData?.railStations;
            const networkDataSource = this.viewer.dataSources.getByName("network")[0];
            if (!networkDataSource) return;

            for (const railStation of railStations) {
                const coord = railStation.coordinates;
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
                for (const exit of railStation.exits) {

                    const linkEntity = networkDataSource.entities.values.find(
                        (e) =>
                            e.properties?.featureType == "links" &&
                            e.properties?.id == exit.linkRef
                    );
                    const [linkStart, linkEnd] = linkEntity?.corridor?.positions?.getValue()

                    const { offsetPosition } = computePositionAtOffsetCesium(linkStart, linkEnd, exit.offset)

                    this.dataSource.entities.add(
                        new Entity({
                            position: offsetPosition,
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

            console.log("RailStationDataSourceLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("RailStationDataSourceLayer.load() 중 에러 발생:", error);
        } finally {
            this.dataSource.entities.resumeEvents();
        }
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
