import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import GeoJSON from 'ol/format/GeoJSON';
import { Icon, Style} from "ol/style";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import {Feature} from "ol";
import {interpolateByOffset} from "@utils/interpolateByOffset";

export const PavementMarkingType = {
    Diamond: 'Diamond.png',
    LeftTurn: 'LeftTurn.png',
    RightTurn: 'RightTurn.png',
    Straight: 'Straight.png',
    StraightLeft: 'StraightLeft.png',
    StraightRight: 'StraightRight.png',
    UTurn: 'UTurn.png',
} as const;

export class PavementMarkingFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "PAVEMENT_MARKING";
    private unsubscribe: () => void;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: true,

            style: (feature: Feature, resolution: number) => {
                const baseResolution = 1.2;
                const scale = 0.05 * (baseResolution / resolution);

                const markingType = feature.get("markingType");
                const iconFile = PavementMarkingType[markingType];
                const url = `http://192.168.10.182:58080/models/${iconFile}`;

                const angle = feature.get("angle") || 0;

                return new Style({
                    image: new Icon({
                        src: url,
                        scale,
                        anchor: [0.5, 1],
                        rotateWithView: true,
                        rotation: angle,
                    }),
                });
            },
            zIndex: 400,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        const store = menuCodeToStoreMap["PAVEMENT_MARKING"];
        console.log(store.getState().currentGeojson);

        this.unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            (geojson) => {
                if (!geojson) return;
                const format = new GeoJSON({
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });

                const features = format.readFeatures(geojson);
                console.log("feature : " + features);
                const mergedFeatures = interpolateByOffset(features);

                source.clear(true);
                mergedFeatures.forEach(f => {
                    f.setStyle(null);
                    f.set("selected", 0);
                    f.changed();
                    console.log("👉 Geometry:", f.getGeometry());
                });
                source.addFeatures(mergedFeatures);
            },
            { fireImmediately: true }
        );
        this.source = source;
    }

    public load(): void {
        const store = menuCodeToStoreMap[this.LAYER_NAME];
        const geojson = store.getState().currentGeojson;

        const format = new GeoJSON({
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
        });

        const markingFeatures = format.readFeatures(geojson);
        const mergeFeature = interpolateByOffset(markingFeatures);

        this.source.clear(true);
        mergeFeature.forEach(f => {
            f.set("selected", 0);
            f.changed();
        });

        this.source.addFeatures(mergeFeature);
        const geojsonStr = new GeoJSON().writeFeatures(mergeFeature, {
            featureProjection: "EPSG:3857",
            dataProjection: "EPSG:4326"
        });
        const geojsonObj = JSON.parse(geojsonStr);
        store.getState().setCurrentGeojson(geojsonObj);

    }

    public destroy() {
        this.unsubscribe();
    }
}
