import { Viewer, GeoJsonDataSource, Cartesian3, Entity, Color } from "cesium";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "BUS_STATION";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const store = menuCodeToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.originData,
            async (originData) => {
                if (!originData?.busStations) return;
                try {
                    await this.load(originData.busStations);
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

        for (const station of busStations) {
            const { lng, lat, id, selected = 0 } = station;
            if (!lng || !lat) continue;

            const position = Cartesian3.fromDegrees(lng, lat);

            this.dataSource.entities.add(
                new Entity({
                    id: `station-${id}`,
                    position,
                    point: {
                        pixelSize: selected === 1 ? 8 : 6,
                        color: selected === 1 ? Color.GREEN : Color.RED,
                        outlineWidth: 1,
                        outlineColor: selected === 1 ? Color.RED : Color.TRANSPARENT,
                    },
                    properties: station,
                })
            );
        }

        this.viewer.dataSources.add(this.dataSource);
        console.log("[BusStationDataSourceLayer] 로드 완료: ", this.dataSource.entities.values.length);
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
