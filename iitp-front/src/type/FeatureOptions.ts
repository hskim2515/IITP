export interface FetchFeatureDataType<T = Record<string, unknown>> {
    id: string | number;
    json: T
    name: string;
}

export enum GeometryType {
    POINT = 'Point',
    LINE_STRING = 'LineString',
    LINEAR_RING = 'LinearRing',
    POLYLINE = 'Polyline',
    POLYGON = 'Polygon',
    MULTI_POINT = 'MultiPoint',
    MULTI_LINE_STRING = 'MultiLineString',
    MULTI_POLYGON = 'MultiPolygon',
    GEOMETRY_COLLECTION = 'GeometryCollection',
    CIRCLE = 'Circle',
}

export default GeometryType;