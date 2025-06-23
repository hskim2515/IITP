import { Feature } from "ol";
import { GeoJSON } from "ol/format";
import { GeoJSONFeature, GeoJSONFeatureCollection } from "@stores/useFeatureStoreFactory";

export function olFeatureToGeoJSONFeature(feature: Feature): GeoJSONFeature {
    const format = new GeoJSON();

    return format.writeFeatureObject(feature, {
        featureProjection: "EPSG:3857",     // ol 좌표계
        dataProjection: "EPSG:4326",
    });
}

interface MergeGeoJSONFeatureOptions {
    feature: GeoJSONFeature;
    featureCollection: GeoJSONFeatureCollection;
}

export function mergeGeoJSONFeatureIntoCollection({
                                                      feature,
                                                      featureCollection,
                                                  }: MergeGeoJSONFeatureOptions): GeoJSONFeatureCollection {
    const id = feature.properties?.id;
    if (id == null) return featureCollection;

    const { features } = featureCollection;
    const index = features.findIndex(f => f.properties?.id === id);

    if (index === -1) {
        return {
            type: "FeatureCollection",
            features: [...features, feature],
        };
    }

    const updatedFeatures = [...features];
    updatedFeatures[index] = feature;

    return {
        type: "FeatureCollection",
        features: updatedFeatures,
    };
}