import { Color, ColorMaterialProperty, Entity, GeoJsonDataSource, Viewer, Cartesian3 } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { diff } from "deep-object-diff";
import * as Cesium from "cesium";

export default class RailRouteDataSourceLayer {
    private readonly LAYER_NAME = "railRoute";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: (() => void) | undefined;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);
        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = (store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const railStationStore = layerNameToStoreMap["railStation"];
        if (railStationStore) {
            (railStationStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    public load(): void {
        if (!this.dataSource) return;
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();
            const store = layerNameToStoreMap[this.LAYER_NAME];
            const railStationStore = layerNameToStoreMap["railStation"];
            if (!store || !railStationStore) return;

            const ptLineData = store.getState().currentJsonData;
            const stationData = railStationStore.getState().currentJsonData;
            if (!ptLineData?.routes || !stationData?.railStations) return;

            // 역 ID → Cartesian3 좌표 맵
            const stationPosMap = new Map<string, Cartesian3>();
            for (const station of stationData.railStations) {
                if (station.id != null && station.coordinates?.lng && station.coordinates?.lat) {
                    stationPosMap.set(
                        String(station.id),
                        Cesium.Cartesian3.fromDegrees(station.coordinates.lng, station.coordinates.lat)
                    );
                }
            }

            for (const route of ptLineData.routes) {
                const stationIds: string[] = (route.railStationSeq ?? "").trim().split(/\s+/).filter(Boolean);
                const positions: Cartesian3[] = stationIds
                    .map((sid) => stationPosMap.get(sid))
                    .filter((p): p is Cartesian3 => p !== undefined);

                if (positions.length >= 2) {
                    this.dataSource.entities.add(new Entity({
                        polyline: {
                            positions,
                            width: 3,
                            material: new ColorMaterialProperty(Color.fromCssColorString('#0066ff')),
                            clampToGround: true,
                        },
                        properties: { id: route.id, name: route.name, featureType: "railRoute" },
                    }));
                }
            }
        } finally {
            this.dataSource.entities.resumeEvents();
        }
    }

    public destroy(): void {
        this.unsubscribe?.();
        if (this.dataSource) this.viewer.dataSources.remove(this.dataSource, true);
    }
}
