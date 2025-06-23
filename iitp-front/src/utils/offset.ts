import { Geometry, LineString, Point, Polygon } from "ol/geom";
import { getDistance } from "ol/sphere";
import { toLonLat } from "ol/proj";
import { Coordinate } from "ol/coordinate";

/**
 * Geometry 객체로부터 클릭 좌표 추출
 * - Point: 해당 점 좌표
 * - LineString: 시작 좌표
 * - Polygon: 외곽 링의 시작 좌표
 */
export function getClickCoordinateFromGeometry(
    geometry: Geometry | undefined
): Coordinate | null {
    if (!geometry) return null;

    if (geometry instanceof Point) {
        return geometry.getCoordinates();
    }

    if (geometry instanceof LineString) {
        const coords = geometry.getCoordinates();
        return coords.length > 0 ? coords[0] : null;
    }

    if (geometry instanceof Polygon) {
        const rings = geometry.getCoordinates();
        return rings.length > 0 && rings[0].length > 0 ? rings[0][0] : null;
    }

    return null;
}
/**
 * Geometry 내에서 클릭 좌표에 가장 가까운 선분 반환
 */
export function getClosestSegmentFromGeometry(
    geometry: Geometry,
    clickCoord: Coordinate | null
): { from: Coordinate; to: Coordinate } | null {
    if(!clickCoord) return null;
    const type = geometry.getType();
    let coords: Coordinate[];

    if (type === "LineString") {
        coords = (geometry as LineString).getCoordinates();
    } else if (type === "Polygon") {
        coords = (geometry as Polygon).getCoordinates()[0]; // exterior ring
    } else {
        console.warn("지원하지 않는 geometry 타입:", type);
        return null;
    }

    if (coords.length < 2) return null;

    let minDist = Infinity;
    let closestSegment: { from: Coordinate; to: Coordinate } | null = null;

    for (let i = 0; i < coords.length - 1; i++) {
        const from = coords[i];
        const to = coords[i + 1];
        const mid: [number, number] = [
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
        ];

        const distSq =
            (clickCoord[0] - mid[0]) ** 2 + (clickCoord[1] - mid[1]) ** 2;
        if (distSq < minDist) {
            minDist = distSq;
            closestSegment = { from, to };
        }
    }

    return closestSegment;
}
/**
 * 특정 거리(offset)만큼 떨어진 좌표를 선분 기준으로 계산
 */
export function getOffsetPositionFromLine(
    from: Coordinate,
    to: Coordinate,
    offset: number
): Coordinate {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return from;

    const unitDir: [number, number] = [dx / length, dy / length];

    return [
        from[0] + offset * unitDir[0],
        from[1] + offset * unitDir[1],
    ];
}
/**
 * 시작점 기준으로 클릭 좌표까지의 거리(m) 반환 (dot product 이용한 방향성 포함)
 */
export function getSignedOffsetMeters(
    from: Coordinate,
    to: Coordinate,
    clickCoord: Coordinate | null
): number | null{
    if(!clickCoord) return null;
    const lonLatFrom = toLonLat(from);
    const lonLatClick = toLonLat(clickCoord);

    const offset = getDistance(lonLatFrom, lonLatClick);

    const dx1 = to[0] - from[0];
    const dy1 = to[1] - from[1];
    const dx2 = clickCoord[0] - from[0];
    const dy2 = clickCoord[1] - from[1];

    const dot = dx1 * dx2 + dy1 * dy2;

    return dot < 0 ? -offset : offset;
}
/**
 * Geometry, 클릭좌표, offset(m)를 기반으로 최종 좌표 반환
 */
export function getOffsetCoordFromGeometry(
    geometry: Geometry,
    clickCoord: Coordinate,
    offset: number
): Coordinate | null {
    const segment = getClosestSegmentFromGeometry(geometry, clickCoord);
    if (!segment) return null;

    return getOffsetPositionFromLine(segment.from, segment.to, offset);
}
