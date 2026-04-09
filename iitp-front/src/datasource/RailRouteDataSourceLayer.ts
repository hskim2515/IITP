import { Viewer } from "cesium";
import * as Cesium from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { computeStationCentroidsOl } from "@utils/railStationPosition";

const RAIL_COLOR = Cesium.Color.fromCssColorString("#0052a5");

export default class RailRouteDataSourceLayer {
    private readonly LAYER_NAME = "railRoute";
    private primitive: Cesium.GroundPolylinePrimitive | null = null;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private visible = true;
    private needsReload = false;

    constructor(private viewer: Viewer) {
        this.load();

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
        this.visible = visible;
        if (this.primitive) this.primitive.show = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("[RailRouteDataSourceLayer] load 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        if (!this.visible) { this.needsReload = true; return; }
        this.needsReload = false;

        /* 기존 primitive 제거 */
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }
        if (this.destroyed) return;

        const store            = layerNameToStoreMap[this.LAYER_NAME];
        const railStationStore = layerNameToStoreMap["railStation"];
        const networkStore     = layerNameToStoreMap["network"];
        if (!store || !railStationStore || !networkStore) return;

        const ptLineData  = store.getState().currentJsonData;
        const stationData = railStationStore.getState().currentJsonData;
        const networkData = networkStore.getState().currentJsonData;
        if (!ptLineData?.routes || !stationData?.railStations || !networkData?.links) return;

        /* exit centroid 기반 역 위치 */
        const centroidMap = computeStationCentroidsOl(stationData.railStations, networkData);

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

        /* GeometryInstance 생성 */
        const instances: Cesium.GeometryInstance[] = [];
        for (const route of ptLineData.routes) {
            const stationIds: string[] = (route.railStationSeq ?? "").trim().split(/\s+/).filter(Boolean);
            const positions: Cesium.Cartesian3[] = stationIds
                .map((sid) => stationPosMap.get(sid))
                .filter((p): p is Cesium.Cartesian3 => p !== undefined);

            if (positions.length >= 2) {
                instances.push(new Cesium.GeometryInstance({
                    id: { id: route.id, name: route.name, featureType: "railRoute" },
                    geometry: new Cesium.GroundPolylineGeometry({ positions, width: 6 }),
                }));
            }
        }
        if (!instances.length) return;
        if (this.destroyed) return;

        this.primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineMaterialAppearance({
                material: Cesium.Material.fromType("Color", { color: RAIL_COLOR }),
            }),
            show: this.visible,
        });
        this.viewer.scene.primitives.add(this.primitive);
        console.log(`[RailRouteDataSourceLayer] 완료: ${instances.length}개 노선`);
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }
    }
}
