import { ColorMaterialProperty, Entity, CustomDataSource, Viewer } from "cesium";
import * as Cesium from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { computeStationCentroidsOl } from "@utils/railStationPosition";
import { Color } from "cesium";

const RAIL_COLOR = Color.fromCssColorString("#0052a5");

export default class RailRouteDataSourceLayer {
    private readonly LAYER_NAME = "railRoute";
    public readonly dataSource: CustomDataSource;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private needsReload = false;

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);
        this.load(); // 초기 로드 (show=false 상태이면 needsReload=true 처리됨)

        const subscribe = (storeName: string) => {
            const store = layerNameToStoreMap[storeName];
            if (!store) return;
            this.unsubscribes.push((store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
        };
        subscribe(this.LAYER_NAME);
        subscribe("railStation");
        subscribe("network");
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("[RailRouteDataSourceLayer] load 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        // 레이어가 꺼진 상태면 스킵, 켜질 때 재로드
        if (!this.dataSource.show) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;

        const store            = layerNameToStoreMap[this.LAYER_NAME];
        const railStationStore = layerNameToStoreMap["railStation"];
        const networkStore     = layerNameToStoreMap["network"];
        if (!store || !railStationStore || !networkStore) return;

        const ptLineData  = store.getState().currentJsonData;
        const stationData = railStationStore.getState().currentJsonData;
        const networkData = networkStore.getState().currentJsonData;

        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            if (!ptLineData?.routes || !stationData?.railStations || !networkData?.links) return;

            // exit centroid 기반 역 위치 (lane 수 반영)
            const centroidMap = computeStationCentroidsOl(stationData.railStations, networkData);

            // centroid 없는 역은 station.coordinates fallback
            const stationPosMap = new Map<string, Cesium.Cartesian3>();
            for (const station of stationData.railStations) {
                const id = String(station.id ?? "");
                if (centroidMap.has(id)) {
                    const { lng, lat } = centroidMap.get(id)!;
                    stationPosMap.set(id, Cesium.Cartesian3.fromDegrees(lng, lat));
                } else if (station.coordinates?.lng && station.coordinates?.lat) {
                    stationPosMap.set(id, Cesium.Cartesian3.fromDegrees(station.coordinates.lng, station.coordinates.lat));
                }
            }

            for (const route of ptLineData.routes) {
                const stationIds: string[] = (route.railStationSeq ?? "").trim().split(/\s+/).filter(Boolean);
                const positions: Cesium.Cartesian3[] = stationIds
                    .map((sid) => stationPosMap.get(sid))
                    .filter((p): p is Cesium.Cartesian3 => p !== undefined);

                if (positions.length >= 2) {
                    this.dataSource.entities.add(new Entity({
                        polyline: {
                            positions,
                            width: 3,
                            material: new ColorMaterialProperty(RAIL_COLOR),
                            clampToGround: true,
                        },
                        properties: { id: route.id, name: route.name, featureType: "railRoute" },
                    }));
                }
            }

            console.log(`[RailRouteDataSourceLayer] 완료: ${this.dataSource.entities.values.length}개 노선`);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
