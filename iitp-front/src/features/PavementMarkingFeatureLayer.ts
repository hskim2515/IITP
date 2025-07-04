import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import GeoJSON from 'ol/format/GeoJSON';
import { Icon, Style} from "ol/style";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import {Feature} from "ol";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import { FEATURE_TYPE, SNAP_FEATURE_TYPE, SNAP_LAYER, PavementMarkingType } from "@type/PavementMarking";

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
                const url = `${process.env.REACT_APP_FILE_BASE_URL}models/${iconFile}`;

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
                source.clear(true);
                source.addFeatures(features);
            },
            { fireImmediately: true }
        );
        this.source = source;
    }

    public loadFromStore(): void {
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
    }

    /**
     * Snap 대상 레이어 키
     */
    public getSnapLayerKey(): string {
        return SNAP_LAYER;
    }

    /**
     * Snap 대상 featureType
     */
    public getSnapFeatureType(): string {
        return SNAP_FEATURE_TYPE;
    }

    public getFeatureType(): string {
        return FEATURE_TYPE.PAVEMENT_MARKING;
    }

    public destroy() {
        this.unsubscribe();
    }
}
