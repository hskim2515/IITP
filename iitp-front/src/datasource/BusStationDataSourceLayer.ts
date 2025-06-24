import { GeoJsonDataSource, Viewer, Color } from "cesium";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";


export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "BUS_STATION";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const store = menuCodeToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            async (geojson) => {
                if (!geojson) return;
                try {
                    await this.load(geojson);
                } catch (error) {
                    console.error("[BusStationDataSourceLayer] GeoJSON 로드 실패:", error);
                }
            },
            { fireImmediately: true }
        );
    }

    private async load(geojson: any): Promise<GeoJsonDataSource> {
        // 기존 데이터 제거
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const loaded = await this.dataSource.load(geojson, {
            clampToGround: true,
        });

        // "selected" 값에 따라 스타일 설정
        loaded.entities.values.forEach(entity => {
            const selected = entity.properties?.selected?.getValue() ?? 0;
            entity.billboard = undefined

            entity.point = {
                pixelSize: selected === 1 ? 8 : 6,
                color: selected === 1 ? Color.GREEN : Color.RED,
                outlineWidth: 1,
                outlineColor: selected === 1 ? Color.RED : Color.TRANSPARENT,
            };
        });

        this.viewer.dataSources.add(this.dataSource);

        return this.dataSource;
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
