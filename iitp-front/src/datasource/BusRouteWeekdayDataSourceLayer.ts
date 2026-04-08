import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Color, ColorMaterialProperty, Entity, GeoJsonDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { diff } from "deep-object-diff";
import * as Cesium from "cesium";

export default class BusRouteWeekdayDataSourceLayer {
    private readonly LAYER_NAME = "busRouteWeekday";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

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
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => { const _d = useNetworkDrawStore.getState(); if (!_d.isActive && !_d.isConnectionActive) this.load(); },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        if (!this.dataSource) return;
        if (!this.dataSource.show) { this.needsReload = true; return; }
        this.needsReload = false;
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();
            const store = layerNameToStoreMap[this.LAYER_NAME];
            const data = store?.getState().currentJsonData;
            if (!data?.lines) return;

            const networkStore = layerNameToStoreMap["network"];
            const networkData = networkStore?.getState().currentJsonData;
            if (!networkData?.links) return;

            const linkPosMap = new Map<number, Cesium.Cartesian3[]>();
            for (const link of networkData.links) {
                if (link.coordinates?.length >= 2) {
                    linkPosMap.set(Number(link.id), [
                        Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat),
                        Cesium.Cartesian3.fromDegrees(link.coordinates[1].lng, link.coordinates[1].lat),
                    ]);
                }
            }

            for (const line of data.lines) {
                const linkIds: string[] = (line.link?.seq ?? "").trim().split(/\s+/).filter(Boolean);
                const positions: Cesium.Cartesian3[] = [];
                for (const linkId of linkIds) {
                    const pts = linkPosMap.get(Number(linkId));
                    if (pts) positions.push(...pts);
                }
                if (positions.length >= 2) {
                    this.dataSource.entities.add(new Entity({
                        polyline: {
                            positions,
                            width: 2,
                            material: new ColorMaterialProperty(Color.fromCssColorString('#ff6600')),
                            clampToGround: true,
                        },
                        properties: { id: line.id, interval: line.interval, featureType: "busRouteWeekday" },
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
