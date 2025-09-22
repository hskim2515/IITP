import { Cartesian3 } from "cesium";
import { Coordinate } from "ol/coordinate";
import { LineString } from "ol/geom";

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

/** OL 2D 거리 */
function distance2D(
    p1: [number, number] | Coordinate,
    p2: [number, number] | Coordinate
): number {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return Math.sqrt(dx * dx + dy * dy);
}

// 타겟 점을 세그먼트에 투영하여 offset/좌표 구하기 (Project)

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

/** OpenLayers: 타겟을 start-end 세그먼트에 직교투영 */
export function projectPointOntoSegmentOl(
    startPosition: Coordinate,
    endPosition: Coordinate,
    targetPosition: Coordinate
): ComputePointAtOffsetOl {

    const centerLine = new LineString([startPosition, endPosition]);
    const offsetPosition = centerLine.getClosestPoint(targetPosition);
    const offset = distance2D(startPosition, offsetPosition);
    return {offset, offsetPosition};
}

// 2) offset(거리)만 주어졌을 때 offsetPosition 구하기 (Forward)

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
    // base 방향 단위벡터 * clampedOffset
    const dir = Cartesian3.divideByScalar(base, segLen, new Cartesian3());
    const move = Cartesian3.multiplyByScalar(dir, clampedOffset, new Cartesian3());
    const offsetPosition = Cartesian3.add(startPosition, move, new Cartesian3());

    return {offset: clampedOffset, offsetPosition};
}

/** OpenLayers: 주어진 offset(투영 좌표계 단위; 보통 m)을 start-end 세그먼트 따라 이동한 좌표 */
export function computePositionAtOffsetOl(
    startPosition: [number, number] | Coordinate,
    endPosition: [number, number] | Coordinate,
    offsetUnits: number
): ComputePointAtOffsetOl {
    const dx = endPosition[0] - startPosition[0];
    const dy = endPosition[1] - startPosition[1];
    const segLen = Math.hypot(dx, dy);

    if (segLen === 0) {
        return {offset: 0, offsetPosition: [startPosition[0], startPosition[1]]};
    }

    const clampedOffset = Math.max(0, Math.min(offsetUnits, segLen));
    const t = clampedOffset / segLen;

    const offsetPosition: Coordinate = [
        startPosition[0] + dx * t,
        startPosition[1] + dy * t,
    ];

    return {offset: clampedOffset, offsetPosition};
}
