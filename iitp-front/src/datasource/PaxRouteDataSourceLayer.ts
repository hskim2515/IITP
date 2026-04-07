import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Color, ColorMaterialProperty, Entity, GeoJsonDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { diff } from "deep-object-diff";
import * as Cesium from "cesium";

export default class PaxRouteDataSourceLayer {
    private readonly LAYER_NAME = "paxRoute";
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
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => { const _d = useNetworkDrawStore.getState(); if (!_d.isActive && !_d.isConnectionActive) this.load(); },
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
            const data = store?.getState().currentJsonData;
            const routes = data?.PaxRoute ?? data?.Route ?? data?.routes;
            if (!routes?.length) return;

            const networkStore = layerNameToStoreMap["network"];
            const networkData = networkStore?.getState().currentJsonData;
            if (!networkData?.nodes) return;

            const nodePosMap = new Map<number, Cesium.Cartesian3>();
            for (const node of networkData.nodes) {
                if (node.coordinates?.lng != null && node.coordinates?.lat != null) {
                    nodePosMap.set(Number(node.id), Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat));
                }
            }

            for (const route of routes) {
                const originPos = nodePosMap.get(Number(route.OriginID));
                const destPos = nodePosMap.get(Number(route.DestinationID));
                if (!originPos || !destPos) continue;

                this.dataSource.entities.add(new Entity({
                    polyline: {
                        positions: [originPos, destPos],
                        width: 1.5,
                        material: new ColorMaterialProperty(Color.fromCssColorString('#cc44ff')),
                        clampToGround: true,
                    },
                    properties: { OriginID: route.OriginID, DestinationID: route.DestinationID, featureType: "paxRoute" },
                }));
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
