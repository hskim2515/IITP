import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useLayerStore } from "@stores/useLayerStore";
import { findFeatureByProperties } from "@utils/feature";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";

export default class SignalTodFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "signalTod";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 420,
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
        // signal 피처가 로드된 후 재시도
        const signalStore = layerNameToStoreMap["signal"];
        if (signalStore) {
            (signalStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }


    override setVisible(visible: boolean): void {
        super.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

        public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const planCount = feature.get("planCount") ?? 0;
        return [
            new Style({
                image: new CircleStyle({
                    radius: 8,
                    fill: new Fill({ color: '#9933ff' }),
                    stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
                }),
                text: resolution < 5 ? new Text({
                    text: String(planCount),
                    fill: new Fill({ color: '#ffffff' }),
                    font: '10px sans-serif',
                }) : undefined,
            }),
        ];
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const data = store.getState().currentJsonData;
        if (!data?.nodes) { this.source.clear(); return; }

        const signalLayer = useLayerStore.getState().layerManager?.getLayerByName("signal");
        const signalSource = signalLayer?.getSource();
        if (!signalSource) return;

        const features: Feature[] = [];
        for (const node of data.nodes) {
            // 신호 레이어에서 같은 nodeId를 가진 피처의 위치를 참조
            const signalFeature = findFeatureByProperties(signalSource.getFeatures(), {
                nodeId: String(node.id),
            });
            const signalGeom = signalFeature?.getGeometry();
            if (!(signalGeom instanceof Point)) continue;

            const f = new Feature(new Point(signalGeom.getCoordinates()));
            f.setProperties({
                id: node.id,
                planCount: node.plans?.length ?? 0,
                featureType: "signalTod",
            });
            features.push(f);
        }
        this.source.clear();
        this.source.addFeatures(features);
        console.log(`[SignalTodFeatureLayer] 로드 완료: ${features.length}개 노드`);
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
