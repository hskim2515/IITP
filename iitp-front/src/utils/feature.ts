import Collection from "ol/Collection";
import { Feature } from "ol";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import BaseLayer from "ol/layer/Base";
import Geometry from "ol/geom/Geometry";
import { LineString, Point, Polygon } from "ol/geom";
import { Coordinate } from "ol/coordinate";
import { getDistance } from "ol/sphere";
import {fromLonLat, toLonLat} from "ol/proj";

export interface PositionOnGeometry {
    coordinate: Coordinate; // 최적 위치 좌표
    offset?: number; // 시작점부터 이 좌표까지의 실제 거리 (offset 미터)
    fractionAlong?: number; // 전체 Geometry 길이에 대한 거리 비율 (0~1)
    segmentIndex?: number; // 해당 좌표가 위치한 세그먼트(선분)의 인덱스
}

/**
 * 두 좌표 간 유클리드 거리 계산
 */
export function segmentDistance(a: Coordinate, b: Coordinate): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.hypot(dx, dy);
}

/**
 * Geometry에서 1차원 좌표 배열 추출
 */
export function getGeometryCoordinates(
    geometry: Geometry | undefined
): Coordinate[] | [] {
    if (geometry instanceof Point) {
        return [ geometry.getCoordinates(), geometry.getCoordinates() ]; // LineString과 호환되도록 2개 반환
    }
    if (geometry instanceof LineString) {
        return geometry.getCoordinates();
    }
    if (geometry instanceof Polygon) {
        const rings = geometry.getCoordinates();
        return rings[0];
    }
    return [];
}

/**
 * 좌표 배열의 전체 길이 합계 계산
 */
export function computeTotalLength(coords: Coordinate[]): number {
    return coords.reduce((sum, curr, idx) => {
        if (idx === 0) return 0;
        return sum + segmentDistance(coords[idx - 1], curr);
    }, 0);
}

/**
 * 점 target을 선분 a→b에 투영, 투영점과 t값 반환
 */
export function projectOnSegment(
    a: Coordinate,
    b: Coordinate,
    target: Coordinate
): { proj: Coordinate; t: number } {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen2 = dx * dx + dy * dy;
    const tRaw = ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / segLen2;
    const t = Math.max(0, Math.min(1, tRaw));
    return { proj: [ a[0] + t * dx, a[1] + t * dy ], t };
}
/**
 * Feature 시작점, 끝점 좌표 반환
 * - Point: 동일 좌표를 start/end로
 * - LineString: 첫 번째, 마지막 좌표
 * - Polygon: 외곽 고리(first ring)의 첫/마지막 좌표
 */

export function getFromToCoordinates(
    feature: Feature | undefined
): { fromCoord: Coordinate | null, toCoord: Coordinate | null } {
    if (!feature) return { fromCoord: null, toCoord: null };

    const geometry = feature.getGeometry();
    if (!geometry) return { fromCoord: null, toCoord: null };

    if (geometry instanceof Point) {
        const coord = geometry.getCoordinates();
        return { fromCoord: coord, toCoord: coord };
    }

    if (geometry instanceof LineString) {
        const coords = geometry.getCoordinates();
        if (coords.length === 0) return { fromCoord: null, toCoord: null };
        return { fromCoord: coords[0], toCoord: coords[coords.length - 1] };
    }

    if (geometry instanceof Polygon) {
        const rings = geometry.getCoordinates();
        const outer = rings[0];
        if (!outer || outer.length === 0) return { fromCoord: null, toCoord: null };
        return { fromCoord: outer[0], toCoord: outer[outer.length - 1] };
    }

    return { fromCoord: null, toCoord: null };
}

/**
 * Collection<Feature>에서 특정 속성값만 추출해 중복 없이 리스트로 반환
 *
 * @param features   Feature 컬렉션
 * @param key        추출할 속성명
 * @returns          중복이 제거된 해당 속성값들의 배열
 */
export function getValuesFromFeatures<T = unknown>(
    features: Collection<Feature>,
    key: string
): T[] {
    const values = features
        .getArray()
        .map((feature: Feature) => {
            const propsContainer = (feature.getProperties() as any).properties;
            const props: Record<string, any> =
                propsContainer && typeof propsContainer === "object"
                    ? propsContainer
                    : feature.getProperties();

            return props[key] as T | undefined;
        })
        // undefined/null 제거
        .filter((v): v is T => v !== undefined && v !== null);

    // Set으로 중복 제거 후 배열 반환
    return Array.from(new Set(values));
}

function extractFeaturesFromInput(input: Feature[]): Feature[] | null;
function extractFeaturesFromInput(input: Collection<Feature>): Feature[] | null;
function extractFeaturesFromInput(input: VectorSource): Feature[] | null;
function extractFeaturesFromInput(input: VectorLayer | WebGLVectorLayer | BaseLayer): Feature[] | null;
function extractFeaturesFromInput(input: Feature[] | Collection<Feature> | VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined): Feature[] | null {
    if (!input) return null;

    if (Array.isArray(input)) {
        return input;
    } else if (input instanceof Collection) {
        return input.getArray();
    } else if (input instanceof VectorSource) {
        return input.getFeatures();
    } else if (
        input instanceof VectorLayer ||
        input instanceof WebGLVectorLayer ||
        input instanceof BaseLayer
    ) {
        const source = input.getSource?.();
        if (!source || !(source instanceof VectorSource)) return null;
        return source.getFeatures();
    }

    return null;
}

export function getPositionByCoordinate(input: Feature, coordinate: Coordinate): PositionOnGeometry | null;
export function getPositionByCoordinate(input: Geometry, coordinate: Coordinate): PositionOnGeometry | null;
export function getPositionByCoordinate(
    input: Feature | Geometry | undefined,
    coordinate: Coordinate | undefined
): PositionOnGeometry | null {
    if (!input || !coordinate) return null;

    const geometry = input instanceof Feature ? input.getGeometry() : input;
    if (!geometry) return null;

    // Point geometry인 경우
    if (geometry instanceof Point) {
        return { coordinate: geometry.getCoordinates() };
    }

    const coords = getGeometryCoordinates(geometry);
    if (coords.length < 2) return null;

    const totalLen = computeTotalLength(coords);
    let accumulated = 0;
    let best: PositionOnGeometry | null = null;

    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const { proj, t } = projectOnSegment(a, b, coordinate);
        const distAlong = accumulated + segmentDistance(a, proj);
        const distToTarget = segmentDistance(proj, coordinate);

        if (!best || distToTarget < segmentDistance(best.coordinate, coordinate)) {
            best = {
                coordinate: proj,
                offset: distAlong,
                fractionAlong: totalLen > 0 ? distAlong / totalLen : 0,
                segmentIndex: i - 1,
            };
        }

        accumulated += segmentDistance(a, b);
    }

    return best;
}

/**
 * geometry와 offset(거리)이 주어졌을 때,
 * geometry의 시작점으로부터 offset만큼 진행한 지점의 좌표 반환
 */
export function getCoordinateByOffset(input: Feature, offset: number): Coordinate | null;
export function getCoordinateByOffset(input: Geometry, offset: number): Coordinate | null;
export function getCoordinateByOffset(
    input: Feature | Geometry | undefined,
    offset: number | undefined
): Coordinate | null {
    const geometry = input instanceof Feature ? input.getGeometry() : input;

    if (!geometry || typeof offset !== "number" || offset < 0) {
        return null;
    }

    if (geometry instanceof Point) {
        return geometry.getCoordinates();
    }

    const coords = getGeometryCoordinates(geometry);
    if (coords.length < 2) {
        return null;
    }

    if (offset === 0) return coords[0];

    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const segLen = segmentDistance(a, b);

        if (accumulated + segLen >= offset) {
            const remain = offset - accumulated;
            const t = segLen > 0 ? remain / segLen : 0;
            return [
                a[0] + t * (b[0] - a[0]),
                a[1] + t * (b[1] - a[1]),
            ];
        }
        accumulated += segLen;
    }

    // offset이 전체 길이를 초과한 경우
    return null;
}

export function getOffsetByCoordinate(input: Geometry, coordinate: Coordinate): number | null;
export function getOffsetByCoordinate(input: Feature, coordinate: Coordinate): number | null;
export function getOffsetByCoordinate(
    input: Geometry | Feature | undefined,
    coordinate: Coordinate
): number | null {
    if (!input || !coordinate) return null;

    let geometry;
    if(input instanceof Feature) {
        geometry = input.getGeometry()
    } else if (input instanceof Geometry) {
        geometry = input
    } else {
        console.log("getOffsetByCoordinate typeof input:::", typeof input)
    }
    if (!geometry) return null;

    const pos = getPositionByCoordinate(geometry, coordinate);
    return (pos && typeof pos.offset === 'number') ? pos.offset : null;
}

export function findFeatureByProperties(input: Collection<Feature>, properties: Record<string, unknown>): Feature | null;
export function findFeatureByProperties(input: VectorSource, properties: Record<string, unknown>): Feature | null;
export function findFeatureByProperties(input: VectorLayer | WebGLVectorLayer | BaseLayer, properties: Record<string, unknown>): Feature | null;
export function findFeatureByProperties(
    input: Collection<Feature> | VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined,
    properties: Record<string, any> | undefined
): Feature | null {
    if (!input || !properties) return null;

    const features = extractFeaturesFromInput(input)
    if (!features) return null;

    return features.find((feature) =>
        Object.entries(properties).every(([ key, value ]) => feature.get(key) == value)
    ) ?? null;
}

export function getFeaturesByProperties(input: Feature[], properties: Record<string, unknown>): Collection<Feature> | null;
export function getFeaturesByProperties(input: VectorSource, properties: Record<string, unknown>): Collection<Feature> | null;
export function getFeaturesByProperties(input: VectorLayer | WebGLVectorLayer | BaseLayer, properties: Record<string, unknown>): Collection<Feature> | null;
export function getFeaturesByProperties(
    input: Feature[] | VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined,
    properties: Record<string, unknown> | undefined
): Collection<Feature> | null {
    if (!input || !properties) return null;

    const features = extractFeaturesFromInput(input)
    if (!features) return null;

    const matchedArray = features.filter((feature: Feature) =>
        Object.entries(properties).every(
            ([ key, value ]) => feature.getProperties()[key] === value
        )
    );

    return new Collection<Feature>(matchedArray)
}


export function filterFeaturesByKey(input: Feature[], ids: Array<string | number>, key?: string): Collection<Feature>;
export function filterFeaturesByKey(input: Collection<Feature>, ids: Array<string | number>, key?: string): Collection<Feature>;
export function filterFeaturesByKey(input: VectorSource, ids: Array<string | number>, key?: string): Collection<Feature>;
export function filterFeaturesByKey(input: VectorLayer | WebGLVectorLayer | BaseLayer, ids: Array<string | number>, key?: string): Collection<Feature>;
export function filterFeaturesByKey(
    input: Feature[] | Collection<Feature> | VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined,
    ids: Array<string | number>,
    key: string = "__guid"
): Collection<Feature> {
    if (!Array.isArray(ids) || ids.length === 0 || !input) {
        return new Collection<Feature>([]);
    }

    const features = extractFeaturesFromInput(input)
    if (!features) return new Collection<Feature>([]);

    const matched = features.filter((feature) => {
        const raw = feature.getProperties() as any;
        const props = raw.properties && typeof raw.properties === "object" ? raw.properties : raw;
        return ids.includes(props[key]);
    });

    return new Collection<Feature>(matched);
}

export function createFeature (data: any): Feature<Point> | undefined {
    const props: any = {
        ...data,
    };
    const coord = data.coordinates[0];
    const hasValidCoordinate = typeof coord.lng === 'number' && typeof coord.lat === 'number';

    const geom = hasValidCoordinate ? new Point(fromLonLat([coord.lng!, coord.lat!])) : undefined;

    const feature = new Feature<Point>(geom);
    feature.setProperties(props);

    return feature;
}
export function convertFeatureToRecord(f: Feature): any {
    const geometry = f.getGeometry();
    const coordinates = geometry?.getCoordinates();
    const [lng, lat] = toLonLat(coordinates);

    return {
        ...f.getProperties(),
        coordinates: [{ lng, lat }],
    };
}

export function getFeaturesByGuidPrefix(input: Feature[], prefix: string): Collection<Feature> | null;
export function getFeaturesByGuidPrefix(input: VectorSource, prefix: string): Collection<Feature> | null;
export function getFeaturesByGuidPrefix(input: VectorLayer | WebGLVectorLayer | BaseLayer, prefix: string): Collection<Feature> | null;
export function getFeaturesByGuidPrefix(
    input: Feature[] | VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined,
    prefix: string
): Collection<Feature> | null {
    if (!input || !prefix) return null;

    const features = extractFeaturesFromInput(input)
    if (!features) return new Collection<Feature>([]);
    const matchedArray = features.filter((feature: Feature) => {
        const guid = feature.get('__guid');
        return typeof guid === 'string' && guid.startsWith(prefix);
    });

    return new Collection<Feature>(matchedArray)
}


// snap
export function findNearestFeature(
    features: Feature[],
    targetCoord: Coordinate,
    maxDistance: number = 10
): Feature | null {
    if(!features) return null;
    let closest: Feature | null = null;
    let minDistance = Infinity;
    for (const feature of features) {
        const geom = feature.getGeometry();
        if (!geom) continue;

        const closestCoord = geom.getClosestPoint(targetCoord);
        const distance = getDistance(closestCoord, targetCoord);

        if (distance < minDistance && distance <= maxDistance) {
            closest = feature;
            minDistance = distance;
        }
    }

    return closest;
}

export function getSnapFeature(input: Feature[],  targetCoord: Coordinate | null,maxDistance: number):Feature<Geometry> | null;
export function getSnapFeature(input: Feature<Geometry>,  targetCoord: Coordinate | null,maxDistance: number):Feature<Geometry> | null;
export function getSnapFeature(input: VectorSource, targetCoord: Coordinate | null,maxDistance: number):Feature<Geometry> | null;
export function getSnapFeature(input: VectorLayer | WebGLVectorLayer | BaseLayer, targetCoord: Coordinate | null, maxDistance: number):Feature<Geometry> | null;
export function getSnapFeature(input: VectorSource | VectorLayer | WebGLVectorLayer | BaseLayer | undefined , targetCoord: Coordinate | null,maxDistance: number):Feature<Geometry> | null{
    if(!targetCoord) return null;
    const features = extractFeaturesFromInput(input)
    return findNearestFeature(features, targetCoord, maxDistance);
}