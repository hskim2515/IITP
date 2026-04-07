import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Stroke, Style } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useLayerStore } from "@stores/useLayerStore";
import { findFeatureByProperties } from "@utils/feature";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";
import { Coordinate } from "ol/coordinate";
import { Point } from "ol/geom";

export default class RouteFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "route";
    private unsubscribe: (() => void) | undefined;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 310,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
        this.source = source;
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

    public styleFunction(_feature: FeatureLike, _resolution: number): Style[] {
        return [new Style({ stroke: new Stroke({ color: '#00cc88', width: 1.5, lineDash: [5, 3] }) })];
    }

    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const data = store.getState().currentJsonData;
        // Route.json: { "Route": [...] }
        const routes = data?.Route ?? data?.routes;
        if (!routes?.length) { this.source.clear(); return; }

        const networkLayer = useLayerStore.getState().layerManager?.getLayerByName("network");
        const networkSource = networkLayer?.getSource();
        if (!networkSource) return;

        const features: Feature[] = [];
        for (const route of routes) {
            const originNode = findFeatureByProperties(networkSource.getFeatures(), {
                featureType: "nodes",
                id: Number(route.OriginID),
            });
            const destNode = findFeatureByProperties(networkSource.getFeatures(), {
                featureType: "nodes",
                id: Number(route.DestinationID),
            });

            const originGeom = originNode?.getGeometry();
            const destGeom = destNode?.getGeometry();
            if (!(originGeom instanceof Point) || !(destGeom instanceof Point)) continue;

            const coords: Coordinate[] = [
                originGeom.getCoordinates(),
                destGeom.getCoordinates(),
            ];
            const f = new Feature(new LineString(coords));
            f.setProperties({
                OriginID: route.OriginID,
                DestinationID: route.DestinationID,
                featureType: "route",
            });
            features.push(f);
        }
        this.source.clear();
        this.source.addFeatures(features);
        console.log(`[RouteFeatureLayer] 로드 완료: ${features.length}개 경로`);
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
