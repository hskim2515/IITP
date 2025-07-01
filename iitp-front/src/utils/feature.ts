import Collection from "ol/Collection";
import { Feature } from "ol";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import BaseLayer from "ol/layer/Base";
import Geometry from "ol/geom/Geometry";
import { LineString, Point, Polygon } from "ol/geom";
import { Coordinate } from "ol/coordinate";

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
): Coordinate[] {
    if (geometry instanceof Point) {
        return [geometry.getCoordinates(), geometry.getCoordinates()];
    }
    if (geometry instanceof LineString) {
        return geometry.getCoordinates();
    }
    if (geometry instanceof Polygon) {
        const rings = geometry.getCoordinates();
        return rings[0] || [];
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
    return { proj: [a[0] + t * dx, a[1] + t * dy], t };
}

export function getPositionOnFeature(
    feature: Feature | undefined,
    target: Coordinate
): PositionOnGeometry | null {
    const geom = feature?.getGeometry()
    if(!geom) return null;
    return getPositionOnGeometry(geom, target)
}
/**
 * Geometry와 좌표가 주어졌을 때, geometry 상의 위치 계산
 */
export function getPositionOnGeometry(
    geometry: Geometry | undefined,
    target: Coordinate
): PositionOnGeometry | null {
    // Point는 그대로 반환
    if (geometry instanceof Point) {
        const coord = geometry.getCoordinates();
        return { coordinate: coord };
    }

    // 선 또는 폴리곤 외곽 고리의 좌표
    const coords = getGeometryCoordinates(geometry);
    if (coords.length < 2) return null;

    const totalLen = computeTotalLength(coords);
    let accumulated = 0;
    let best: PositionOnGeometry | null = null;

    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const { proj, t } = projectOnSegment(a, b, target);
        const distAlong = accumulated + segmentDistance(a, proj);
        const distToTarget = segmentDistance(proj, target);

        if (!best || distToTarget < segmentDistance(best.coordinate, target)) {
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
export function getCoordinateAtDistance(
    geometry: Geometry,
    offset: number
): Coordinate | null {
    if (geometry instanceof Point) {
        return geometry.getCoordinates();
    }
    const coords = getGeometryCoordinates(geometry);
    if (coords.length < 2 || offset < 0) {
        return null;
    }
    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const segLen = segmentDistance(a, b);
        if (accumulated + segLen >= offset) {
            const remain = offset - accumulated;
            const t = segLen > 0 ? remain / segLen : 0;
            return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        }
        accumulated += segLen;
    }
    // offset이 전체 길이를 초과할 경우, 마지막 좌표 반환
    return coords[coords.length - 1];
}

/**
 * geometry와 point가 주어졌을 때,
 * geometry의 시작점으로부터 point까지의 거리(offset)를 반환
 */
export function getOffsetOnGeometry(
    geometry: Geometry | undefined,
    point: Coordinate
): number | null {
    const pos = getPositionOnGeometry(geometry, point);
    return pos && typeof pos.offset === 'number' ? pos.offset : null;
}
export function getOffsetOnFeature(
    feature: Feature | undefined,
    point: Coordinate
): number | null {
    const geom = feature?.getGeometry()
    return getOffsetOnGeometry(geom, point);
}
/**
 * Feature 시작점, 끝점 좌표 반환
 * - Point: 동일 좌표를 start/end로
 * - LineString: 첫 번째, 마지막 좌표
 * - Polygon: 외곽 고리(first ring)의 첫/마지막 좌표
 * - 예외: {start: [], end: []}
 */
export function getFromToCoordinates(feature: Feature | undefined): {
    startPosition: Coordinate;
    end: Coordinate;
} {
    if(!feature) return { startPosition: [], end: [] };
    const geom = feature.getGeometry();
    if (geom instanceof Point) {
        const coord = geom.getCoordinates();
        return { startPosition: coord, end: coord };
    } else if (geom instanceof LineString) {
        const coords = geom.getCoordinates();
        if (coords.length === 0) {
            return { startPosition: [], end: [] };
        }
        return { startPosition: coords[0], end: coords[coords.length - 1] };
    } else if (geom instanceof Polygon) {
        const rings = geom.getCoordinates();
        if (rings.length === 0 || rings[0].length === 0) {
            return { startPosition: [], end: [] };
        }
        const outer = rings[0];
        return { startPosition: outer[0], end: outer[outer.length - 1] };
    }

    return { startPosition: [], end: [] };
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

/**
 * 조건에 맞는 Feature들을 Collection으로 반환
 */
export function filterFeaturesToCollection(
    features: Feature[],
    partialProperties: Record<string, any>
): Collection<Feature> {
    const matchedArray = features.filter((feature: Feature) =>
        Object.entries(partialProperties).every(
            ([ key, value ]) => feature.getProperties()[key] === value
        )
    );

    return new Collection<Feature>(matchedArray)
}

/**
 * 조건에 맞는 Feature 반환
 */
export function findFeaturesToFeature(
    features: Collection<Feature>,
    partialProperties: Record<string, any> | undefined
): Feature | undefined {
    if(!partialProperties) return
    return features.getArray().find(feature =>
        Object.entries(partialProperties).every(
            ([ key, value ]) => {
                return feature.get(key) == value
            }
        )
    )
}

/**
 * VectorSource 에서 조건에 맞는 Feature 반환
 */
export function findSourceToFeature(
    source: VectorSource,
    partialProperties: Record<string, any>
): Feature | undefined {
    return findFeaturesToFeature(source.getFeatures(), partialProperties)
}

/**
 * Layer에서 조건에 맞는 Feature 반환
 */
export function findLayerToFeature(
    layer: VectorLayer | WebGLVectorLayer | BaseLayer,
    partialProperties: Record<string, any>
): Feature | undefined {
    return findFeaturesToFeature(layer.getSource().getFeatures(), partialProperties)
}

/**
 * Layer에서 조건에 맞는 Feature들을 Collection으로 반환
 */
export function getFeaturesByPropertyFromLayer(
    layer: VectorLayer | WebGLVectorLayer | BaseLayer,
    partialProperties: Record<string, any>
): Collection<Feature> {
    return filterFeaturesToCollection(layer.getSource().getFeatures(), partialProperties);
}

/**
 * VectorSource에서 조건에 맞는 Feature들을 Collection으로 반환
 */
export function getFeaturesByPropertyFromSource(
    source: VectorSource,
    partialProperties: Record<string, any>
): Collection<Feature> {
    return filterFeaturesToCollection(source.getFeatures(), partialProperties);

}

/**
 * Collection<Feature>에서 조건에 맞는 Feature들을 Collection으로 반환
 */
export function getFeaturesByPropertyFromCollection(
    features: Collection<Feature>,
    partialProperties: Record<string, any>
): Collection<Feature> {
    return filterFeaturesToCollection(features.getArray(), partialProperties);
}

/**
 * ID 리스트에 포함된 Feature만 필터해서 Collection으로 반환
 *
 * @param features  Feature 배열
 * @param ids       추출할 id 값들의 배열
 * @returns         id가 ids 배열에 포함된 Feature들의 Collection
 */
export function filterFeaturesByIds(
    features: Feature[],
    ids: Array<string | number> | undefined | null
): Collection<Feature> {

    if (!Array.isArray(ids) || ids.length === 0) {
        return new Collection<Feature>([]);
    }

    const matched = features.filter((feature) => {
        const raw = feature.getProperties() as any;

        const props = raw.properties && typeof raw.properties === 'object'
            ? raw.properties
            : raw;

        return ids.includes(props.__guid);
    });
    console.log("filterFeaturesByIds matched:::", matched)
    return new Collection<Feature>(matched);
}

/**
 * Layer에서 ID 리스트에 포함된 Feature들을 Collection으로 반환
 */
export function getFeaturesByIdsFromLayer(
    layer: VectorLayer | WebGLVectorLayer | BaseLayer,
    ids: Array<string | number>
): Collection<Feature> {
    const source = layer.getSource() as VectorSource;
    return filterFeaturesByIds(source.getFeatures(), ids);
}

/**
 * VectorSource에서 ID 리스트에 포함된 Feature들을 Collection으로 반환
 */
export function getFeaturesByIdsFromSource(
    source: VectorSource,
    ids: Array<string | number>
): Collection<Feature> {
    return filterFeaturesByIds(source.getFeatures(), ids);
}

/**
 * Collection<Feature>에서 ID 리스트에 포함된 Feature들을 Collection으로 반환
 */
export function getFeaturesByIdsFromCollection(
    features: Collection<Feature>,
    ids: Array<string | number>
): Collection<Feature> {
    return filterFeaturesByIds(features, ids);
}

export function applyDiffs(obj: any, diffs: { path: string[], value: any }[]) {
    const clone = structuredClone(obj);
    for (const { path, value } of diffs) {
        let current = clone;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!current[key] || typeof current[key] !== "object") {
                current[key] = {};
            }
            current = current[key];
        }
        current[path[path.length - 1]] = value;
    }
    return clone;
}

export function diffObjects(obj1: any, obj2: any, path: string[] = []): { path: string[], value: any }[] {
    const diffs: { path: string[], value: any }[] = [];
    const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of keys) {
        const fullPath = [...path, key];
        const val1 = obj1?.[key];
        const val2 = obj2?.[key];

        const isObject = (v: any) =>
            typeof v === "object" && v !== null && !Array.isArray(v);

        if (isObject(val1) && isObject(val2)) {
            diffs.push(...diffObjects(val1, val2, fullPath));
        } else if (val1 !== val2) {
            diffs.push({ path: fullPath, value: val2 });
        }
    }

    return diffs;
}

export function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;

    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        return a.every((val, idx) => deepEqual(val, b[idx]));
    }

    if (typeof a === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((key) => deepEqual(a[key], b[key]));
    }

    return false;
}