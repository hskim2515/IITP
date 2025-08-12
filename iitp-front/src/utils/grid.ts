import { GeoJSONFeature, GeoJSONFeatureCollection } from "ol/format/GeoJSON";

export function featureCollectionToFlatRow(
    featureCollection: GeoJSONFeatureCollection,
): Record<string, unknown>[] {
    console.log("rowData featureCollectionToFlatRow init")
    if (!featureCollection || featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return [];
    console.log("rowData featureCollectionToFlatRow logic")
    return featureCollection.features.map(featureToFlatRow) || []
}

export function featureToFlatRow(feature: GeoJSONFeature): Record<string, unknown> {
    const props = feature.properties || {};
    const geom = feature.geometry;

    const flatRow: Record<string, unknown> = {
        ...props,
    };

    if (geom) { // 블럭을 나눌 수 있도록
        flatRow.geometryType = geom.type;

        switch (geom.type) {
            case "Point": {
                const coords = geom.coordinates as [ number, number ];
                flatRow.lon = coords[0];
                flatRow.lat = coords[1];
                break;
            }
            case "LineString":
            case "MultiPoint":
            case "Polygon":
            case "MultiLineString":
            case "MultiPolygon": {
                flatRow.lon = null;
                flatRow.lat = null;
                flatRow.coordinatesText = JSON.stringify(geom.coordinates);
                break;
            }
            default:
                break;
        }
    }

    return flatRow;
}