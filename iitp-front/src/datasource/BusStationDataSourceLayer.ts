import { Color, Entity, GeoJsonDataSource, HeightReference, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusPublicStationResponse, BusStationData } from "@type/Station";
import { diff } from 'deep-diff';
import { computePositionAtOffsetCesium } from "@utils/offset";

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
                (state: {currentJsonData: BusPublicStationResponse}) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load();
                },
                {
                    equalityFn: (a: BusPublicStationResponse, b: BusPublicStationResponse) => diff(a, b) === undefined
                }
            );
        }
    }

    public load(): void {
        if (!this.dataSource) return;
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const store = layerNameToStoreMap[this.LAYER_NAME];
            const busStations: BusStationData[] = store.getState().currentJsonData?.busStations;

            if (!busStations) {
                console.log("[BusStationDataSourceLayer] No bus stations data to load.");
                return;
            }

            const networkDataSource = this.viewer.dataSources.getByName("network")[0];
            if (!networkDataSource) return;
            busStations.forEach((data) => {
                const props: BusStationData = {
                    ...data
                };

                const laneEntity = networkDataSource.entities.values.find(
                    (e) =>
                        e.properties?.featureType == "lanes" &&
                        e.properties?.linkRef == data.linkRef &&
                        e.properties?.id == data.laneRef
                );

                const laneSource = laneEntity?.properties?.laneSource.getValue()
                const laneTarget = laneEntity?.properties?.laneTarget.getValue()

                const {offsetPosition} = computePositionAtOffsetCesium(laneSource, laneTarget, data.offset)


                this.dataSource.entities.add(
                    new Entity({
                        id: data.__guid,
                        position: offsetPosition,
                        point: {
                            pixelSize: 6,
                            color: Color.RED,
                            outlineWidth: 1,
                            outlineColor: Color.TRANSPARENT,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                        },
                        properties: props,
                    })
                );
            });

            console.log("BusStationDataSourceLayer: 모든 Feature가 추가됨");
        } catch (error) {
            console.error("BusStationDataSourceLayer.load() 중 에러 발생:", error);
        } finally {
            console.log("this.dataSource.entities:::", this.dataSource.entities)
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