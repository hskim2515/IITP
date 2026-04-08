import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Fill, Stroke, Style } from "ol/style";
import { Point } from "ol/geom";
import CircleStyle from "ol/style/Circle";
import { FeatureLike } from "ol/Feature";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { RailPublicStationResponse } from "@type/Station";
import { useSchemaStore } from "@stores/useSchemaStore";
import { buildLinkMapOl, computeExitPositionOl } from "@utils/railStationPosition";
import { Coordinate } from "ol/coordinate";

export default class RailStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 400,
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

    override setVisible(visible: boolean): void {
        super.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

    public styleFunction(feature: FeatureLike, _resolution: number): Style[] {
        const props = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        if (geom instanceof Point && props.featureType === "railStations") {
            styles.push(new Style({
                image: new CircleStyle({
                    radius: 7,
                    fill: new Fill({ color: "rgb(0,102,255)" }),
                    stroke: new Stroke({ color: "#ffffff", width: 2 }),
                }),
            }));
        }

        if (geom instanceof Point && props.featureType === "exits") {
            styles.push(new Style({
                image: new CircleStyle({
                    radius: 4,
                    fill: new Fill({ color: "rgb(153,0,255)" }),
                    stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 }),
                }),
            }));
        }

        return styles;
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];

        try {
            const response: RailPublicStationResponse | undefined = store?.getState().currentJsonData;
            if (!response?.railStations?.length) { this.source.clear(); return; }

            const networkData: any = networkStore?.getState().currentJsonData;
            if (!networkData?.links) { this.source.clear(); return; }

            const linkMap = buildLinkMapOl(networkData);

            const stationTemplate = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'railStations');
            const exitTemplate    = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'exits');

            const featureBuffer: Feature[] = [];

            for (const station of response.railStations) {
                const exits = station.exits ?? [];
                const exitPositions: Coordinate[] = [];

                for (const exit of exits) {
                    const link = linkMap.get(String(exit.linkRef));
                    if (!link || exit.offset == null) continue;

                    const pos = computeExitPositionOl(link, exit.offset);
                    exitPositions.push(pos);

                    const exitFeature = new Feature(new Point(pos));
                    exitFeature.setProperties({ ...exitTemplate, ...exit, featureType: "exits" });
                    featureBuffer.push(exitFeature);
                }

                if (exitPositions.length === 0) continue;

                const cx = exitPositions.reduce((s, p) => s + (p[0] as number), 0) / exitPositions.length;
                const cy = exitPositions.reduce((s, p) => s + (p[1] as number), 0) / exitPositions.length;

                const stationFeature = new Feature(new Point([cx, cy]));
                stationFeature.setProperties({ ...stationTemplate, ...station, featureType: "railStations" });
                featureBuffer.push(stationFeature);
            }

            this.source.clear();
            this.source.addFeatures(featureBuffer);
            console.log(`[RailStationFeatureLayer] 로드 완료: ${featureBuffer.length}개 피처`);
        } catch (e) {
            console.error("[RailStationFeatureLayer] load 에러:", e);
        }
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
