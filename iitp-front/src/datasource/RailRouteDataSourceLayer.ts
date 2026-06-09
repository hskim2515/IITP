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
        if (!ptLineData?.routes) return;

        /* exit centroid 기반 역 위치 (stationData 없으면 빈 맵으로 처리) */
        const railStations = stationData?.railStations ?? [];
        const centroidMap = computeStationCentroidsOl(railStations, networkData);

        const stationPosMap = new Map<string, Cesium.Cartesian3>();
        for (const station of railStations) {
            const id = String(station.id ?? "");
            if (centroidMap.has(id)) {
                const { lng, lat } = centroidMap.get(id)!;
                stationPosMap.set(id, Cesium.Cartesian3.fromDegrees(lng, lat));
            } else if (station.coordinates?.lng && station.coordinates?.lat) {
                stationPosMap.set(id, Cesium.Cartesian3.fromDegrees(station.coordinates.lng, station.coordinates.lat));
            }
        }

        /* GeometryInstance 생성 — 세그먼트(null separator 기준)마다 별도 instance */
        const MIN_SEG_DIST = 1.0;
        const dedup = (pts: Cesium.Cartesian3[]): Cesium.Cartesian3[] => {
            const out: Cesium.Cartesian3[] = [pts[0]];
            for (let i = 1; i < pts.length; i++) {
                if (Cesium.Cartesian3.distance(pts[i], out[out.length - 1]) >= MIN_SEG_DIST)
                    out.push(pts[i]);
            }
            return out;
        };
        const instances: Cesium.GeometryInstance[] = [];
        const pushSeg = (route: any, seg: Cesium.Cartesian3[]) => {
            if (seg.length < 2) return;
            const clean = dedup(seg);
            if (clean.length < 2) return;
            try {
                instances.push(new Cesium.GeometryInstance({
                    id: { id: route.id, name: route.name, featureType: "railRoute" },
                    geometry: new Cesium.GroundPolylineGeometry({ positions: clean, width: 6 }),
                }));
            } catch (_) {}
        };

        for (const route of ptLineData.routes) {
            if (Array.isArray(route.coords) && route.coords.length >= 2) {
                let seg: Cesium.Cartesian3[] = [];
                for (const c of route.coords) {
                    if (c === null) {
                        pushSeg(route, seg);
                        seg = [];
                    } else {
                        seg.push(Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
                    }
                }
                pushSeg(route, seg);
            } else {
                // 기존: 역 centroid 기반
                const positions: Cesium.Cartesian3[] = [];
                const stationIds: string[] = (route.railStationSeq ?? "").trim().split(/\s+/).filter(Boolean);
                for (const sid of stationIds) {
                    const pos = stationPosMap.get(sid);
                    if (pos) positions.push(pos);
                }
                pushSeg(route, positions);
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
