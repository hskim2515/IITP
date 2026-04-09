import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Color, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import * as Cesium from "cesium";

const ROUTE_COLOR = Color.fromCssColorString("#ff6600");

export default class BusRouteWeekdayDataSourceLayer {
    private readonly LAYER_NAME = "busRouteWeekday";
    private primitive: Cesium.GroundPolylinePrimitive | null = null;
    private unsubscribe: (() => void) | undefined;
    private visible = true;
    private needsReload = false;
    private loadTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private viewer: Viewer) {
        this.scheduleLoad();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = (store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.scheduleLoad(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => {
                    const _d = useNetworkDrawStore.getState();
                    if (!_d.isActive && !_d.isConnectionActive) this.scheduleLoad();
                },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.primitive) this.primitive.show = visible;
        if (visible && this.needsReload) this.scheduleLoad();
    }

    private scheduleLoad(): void {
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => { this.loadTimer = null; this.load(); }, 150);
    }

    public load(): void {
        if (!this.visible) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        const data = store?.getState().currentJsonData;
        const networkStore = layerNameToStoreMap["network"];
        const networkData = networkStore?.getState().currentJsonData;

        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }

        if (!data?.lines || !networkData?.links) return;

        const linkPosMap = new Map<number, Cesium.Cartesian3[]>();
        for (const link of networkData.links) {
            if (link.coordinates?.length >= 2) {
                linkPosMap.set(Number(link.id), [
                    Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat),
                    Cesium.Cartesian3.fromDegrees(link.coordinates[1].lng, link.coordinates[1].lat),
                ]);
            }
        }

        const instances: Cesium.GeometryInstance[] = [];
        for (const line of data.lines) {
            const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
            const positions: Cesium.Cartesian3[] = [];
            for (const linkId of linkIds) {
                const pts = linkPosMap.get(Number(linkId));
                if (pts) positions.push(...pts);
            }
            if (positions.length < 2) continue;
            instances.push(new Cesium.GeometryInstance({
                id: { id: line.id, interval: line.interval, featureType: "busRouteWeekday" },
                geometry: new Cesium.GroundPolylineGeometry({ positions, width: 5 }),
            }));
        }
        if (!instances.length) return;

        this.primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineMaterialAppearance({
                material: Cesium.Material.fromType("Color", { color: ROUTE_COLOR }),
            }),
            show: this.visible,
        });
        this.viewer.scene.primitives.add(this.primitive);
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    public destroy(): void {
        if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
        this.unsubscribe?.();
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }
    }
}
