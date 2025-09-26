import { Cartesian3 } from "cesium";
import { Coordinate } from "ol/coordinate";
import { LineString } from "ol/geom";
import { getDistance } from "ol/sphere"; // 실제 지구 거리 계산
import { transform } from "ol/proj";

interface ComputeOffset {
    offset: number;
}

export interface ComputePointAtOffsetCesium extends ComputeOffset {
    offsetPosition: Cartesian3;
}

export interface ComputePointAtOffsetOl extends ComputeOffset {
    offsetPosition: Coordinate;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** OL 2D 거리 - 실제 지구상 거리 (미터) */
function getActualDistance(
    p1: [number, number] | Coordinate,
    p2: [number, number] | Coordinate,
    projection: string = 'EPSG:3857'
): number {
    // 좌표계가 Web Mercator나 기타인 경우 WGS84로 변환 후 계산
    if (projection !== 'EPSG:4326') {
        const p1_wgs84 = transform(p1, projection, 'EPSG:4326');
        const p2_wgs84 = transform(p2, projection, 'EPSG:4326');
        return getDistance(p1_wgs84, p2_wgs84); // 실제 미터 거리
    }
    return getDistance(p1, p2);
}

// 타겟 점을 세그먼트에 투영하여 offset/좌표 구하기

/** Cesium: 타겟을 start-end 세그먼트에 직교투영 */
export function projectPointOntoSegmentCesium(
    startPosition: Cartesian3,
    endPosition: Cartesian3,
    targetPosition: Cartesian3
): ComputePointAtOffsetCesium {
    const base = Cartesian3.subtract(endPosition, startPosition, new Cartesian3());
    const len2 = Cartesian3.magnitudeSquared(base);

    if (len2 === 0) {
        return {offset: 0, offsetPosition: startPosition.clone()};
    }

    const v = Cartesian3.subtract(targetPosition, startPosition, new Cartesian3());
    const t = clamp01(Cartesian3.dot(v, base) / len2);

    const scaled = Cartesian3.multiplyByScalar(base, t, new Cartesian3());
    const offsetPosition = Cartesian3.add(startPosition, scaled, new Cartesian3());
    const offset = Cartesian3.distance(startPosition, offsetPosition);
    return {offset, offsetPosition};
}

/** OpenLayers: 타겟을 start-end 세그먼트에 직교투영 (정확한 미터 계산) */
export function projectPointOntoSegmentOl(
    startPosition: Coordinate,
    endPosition: Coordinate,
    targetPosition: Coordinate,
    projection: string = 'EPSG:3857'
): ComputePointAtOffsetOl {
    const centerLine = new LineString([startPosition, endPosition]);
    const offsetPosition = centerLine.getClosestPoint(targetPosition);

    // 실제 지구상 미터 거리로 계산
    const offset = getActualDistance(startPosition, offsetPosition, projection);
    return {offset, offsetPosition};
}

// offset(거리)만 주어졌을 때 offsetPosition 구하기

/** Cesium: 주어진 offset(미터)을 start-end 세그먼트 따라 이동한 좌표 */
export function computePositionAtOffsetCesium(
    startPosition: Cartesian3,
    endPosition: Cartesian3,
    offsetMeters: number
): ComputePointAtOffsetCesium {
    const base = Cartesian3.subtract(endPosition, startPosition, new Cartesian3());
    const segLen = Cartesian3.magnitude(base);

    if (segLen === 0) {
        return {offset: 0, offsetPosition: startPosition.clone()};
    }

    const clampedOffset = Math.max(0, Math.min(offsetMeters, segLen));
    const dir = Cartesian3.divideByScalar(base, segLen, new Cartesian3());
    const move = Cartesian3.multiplyByScalar(dir, clampedOffset, new Cartesian3());
    const offsetPosition = Cartesian3.add(startPosition, move, new Cartesian3());

    return {offset: clampedOffset, offsetPosition};
}

/** OpenLayers: 주어진 offset(미터)을 start-end 세그먼트 따라 이동한 좌표 */
export function computePositionAtOffsetOl(
    startPosition: [number, number] | Coordinate,
    endPosition: [number, number] | Coordinate,
    offsetMeters: number,
    projection: string = 'EPSG:3857'
): ComputePointAtOffsetOl {
    // 실제 지구상 거리로 세그먼트 길이 계산
    const segLenMeters = getActualDistance(startPosition, endPosition, projection);

    if (segLenMeters === 0) {
        return {offset: 0, offsetPosition: [startPosition[0], startPosition[1]]};
    }

    const clampedOffset = Math.max(0, Math.min(offsetMeters, segLenMeters));
    const t = clampedOffset / segLenMeters;

    // 투영좌표계에서의 선형 보간
    const dx = endPosition[0] - startPosition[0];
    const dy = endPosition[1] - startPosition[1];

    const offsetPosition: Coordinate = [
        startPosition[0] + dx * t,
        startPosition[1] + dy * t,
    ];

    return {offset: clampedOffset, offsetPosition};
}