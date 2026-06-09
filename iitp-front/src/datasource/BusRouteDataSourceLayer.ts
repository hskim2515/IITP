import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Color, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import * as Cesium from "cesium";

const ROUTE_COLOR = Color.fromCssColorString("#ff8800");

export default class BusRouteDataSourceLayer {
    private readonly LAYER_NAME = "busRoute";
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

        /* 기존 primitive 제거 */
        if (this.primitive) {
            this.viewer.scene.primitives.remove(this.primitive);
            this.primitive = null;
        }

        if (!data?.lines || !networkData?.links) return;

        /* linkId → 좌표 맵 */
        const linkPosMap = new Map<number, Cesium.Cartesian3[]>();
        for (const link of networkData.links) {
            if (link.coordinates?.length >= 2) {
                linkPosMap.set(Number(link.id), [
                    Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat),
                    Cesium.Cartesian3.fromDegrees(link.coordinates[1].lng, link.coordinates[1].lat),
                ]);
            }
        }

        /* GeometryInstance 생성 — 세그먼트(null separator 기준)마다 별도 instance */
        const MIN_SEG_DIST = 1.0; // Cesium은 동일/근접 좌표에서 WebGL 오류 발생
        const dedup = (pts: Cesium.Cartesian3[]): Cesium.Cartesian3[] => {
            const out: Cesium.Cartesian3[] = [pts[0]];
            for (let i = 1; i < pts.length; i++) {
                if (Cesium.Cartesian3.distance(pts[i], out[out.length - 1]) >= MIN_SEG_DIST)
                    out.push(pts[i]);
            }
            return out;
        };
        const instances: Cesium.GeometryInstance[] = [];
        const pushSeg = (lineId: any, seg: Cesium.Cartesian3[]) => {
            if (seg.length < 2) return;
            const clean = dedup(seg);
            if (clean.length < 2) return;
            try {
                instances.push(new Cesium.GeometryInstance({
                    id: { id: lineId, featureType: "busRoute" },
                    geometry: new Cesium.GroundPolylineGeometry({ positions: clean, width: 5 }),
                }));
            } catch (_) {}
        };

        for (const line of data.lines) {
            if (Array.isArray(line.coords) && line.coords.length >= 2) {
                let seg: Cesium.Cartesian3[] = [];
                for (const c of line.coords) {
                    if (c === null) {
                        pushSeg(line.id, seg);
                        seg = [];
                    } else {
                        seg.push(Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
                    }
                }
                pushSeg(line.id, seg);
            } else {
                const positions: Cesium.Cartesian3[] = [];
                const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
                for (const linkId of linkIds) {
                    const pts = linkPosMap.get(Number(linkId));
                    if (pts) positions.push(...pts);
                }
                pushSeg(line.id, positions);
            }
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
