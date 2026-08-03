import { Cartesian3 } from "cesium";
import { Coordinate } from "ol/coordinate";
import { LineString } from "ol/geom";
import { getDistance } from "ol/sphere"; // 실제 지구 거리 계산
import { transform } from "ol/proj";

/**
 * link JSON에서 laneIdx 차선의 중심선을 Cesium Cartesian3[]로 계산한다.
 * interpolateByOffset.ts의 computeLaneCenterlineOl(OL 버전)과 동일한 정점별 법선 오프셋
 * 방식 — NetworkDataSourceLayer.computeOffsetPositions(private)와 같은 발상을 독립 함수로
 * 재현해, 버스정류장/철도역 출구 등 다른 3D 레이어에서도 곡선 링크의 정확한 차선 중심선을
 * 재사용할 수 있게 한다.
 */
export function computeLaneCenterlineCesium(link: any, laneIdx: number): Cartesian3[] | null {
    const coords = (link?.coordinates ?? []).filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat));
    if (coords.length < 2) return null;
    const laneCount = link.lanes?.length ?? 1;
    if (laneCount === 0) return null;
    const laneWidth = (link.width ?? 7) / laneCount;
    const lateralOffset = (laneIdx - (laneCount - 1) / 2) * laneWidth;

    const pts = coords.map((c: any) => Cartesian3.fromDegrees(c.lng, c.lat));
    if (lateralOffset === 0) return pts;

    return pts.map((p: Cartesian3, i: number) => {
        const prev = pts[Math.max(0, i - 1)]!;
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const diff = Cartesian3.subtract(next, prev, new Cartesian3());
        const diffMag = Cartesian3.magnitude(diff);
        if (diffMag < 1e-6) return p;
        const dir = Cartesian3.divideByScalar(diff, diffMag, new Cartesian3());

        const up = Cartesian3.normalize(p, new Cartesian3());
        const rightRaw = Cartesian3.cross(dir, up, new Cartesian3());
        const rightMag = Cartesian3.magnitude(rightRaw);
        if (rightMag < 1e-6) return p;
        const right = Cartesian3.divideByScalar(rightRaw, rightMag, new Cartesian3());

        return Cartesian3.add(p, Cartesian3.multiplyByScalar(right, lateralOffset, new Cartesian3()), new Cartesian3());
    });
}

/** 링크의 상하행(반대방향) 짝 링크를 찾는다 — from/to node가 정확히 뒤바뀐 링크.
 *  중앙버스전용차로 위치 계산에 필요(실사용 지적: "중앙차선일 경우 링크의 중앙이 아닌
 *  상하행의 중간에 있어야 함" — 이 링크 혼자만의 차선 배열 안에서는 상하행 사이 물리적
 *  중앙분리대 위치를 표현할 수 없다). */
export function findOppositeLink(link: any, allLinks: any[]): any | null {
    if (!link?.fromNode || !link?.toNode) return null;
    return allLinks.find((l: any) => l && String(l.id) !== String(link.id)
        && String(l.fromNode) === String(link.toNode) && String(l.toNode) === String(link.fromNode)) ?? null;
}

/**
 * 중앙버스전용차로(median) 위치 — 이 링크의 최내측(중앙선 쪽, lane 0) 중심선과 반대방향
 * 링크의 최내측 중심선을 호길이 비율로 대응시켜 평균한다. 두 방향이 같은 geometry를
 * 공유하는 경우(가장 흔한 OSM 변환 경로) 대칭적으로 이 링크의 진짜 중앙선에 수렴하고,
 * KTDB처럼 두 방향이 실측으로 분리된 별도 geometry를 가지면 두 차로 사이 실제 물리적
 * 중앙분리대 위치에 가까워진다. 반대방향 링크가 없으면(일방통행 등) 이 링크의 lane 0을
 * 그대로 쓴다.
 */
export function computeMedianCenterlineCesium(link: any, allLinks: any[]): Cartesian3[] | null {
    const ownLane0 = computeLaneCenterlineCesium(link, 0);
    if (!ownLane0) return null;
    const opposite = findOppositeLink(link, allLinks);
    if (!opposite) return ownLane0;
    const oppLane0 = computeLaneCenterlineCesium(opposite, 0);
    if (!oppLane0 || oppLane0.length < 2) return ownLane0;

    // opposite는 from/toNode가 뒤바뀐 링크라 좌표 순서도 반대다 — 뒤집어서 같은 진행방향으로
    // 맞춘 뒤, 호길이 비율 t에서 own[t]와 opp[t]를 대응시켜 평균한다.
    const oppReversed = [...oppLane0].reverse();
    const n = ownLane0.length;
    const result: Cartesian3[] = [];
    for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const j = oppReversed.length > 1 ? t * (oppReversed.length - 1) : 0;
        const j0 = Math.floor(j), j1 = Math.min(oppReversed.length - 1, j0 + 1);
        const frac = j - j0;
        const oppPt = Cartesian3.lerp(oppReversed[j0]!, oppReversed[j1]!, frac, new Cartesian3());
        result.push(Cartesian3.lerp(ownLane0[i]!, oppPt, 0.5, new Cartesian3()));
    }
    return result;
}

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

// ── 다중 세그먼트(꺾인/곡선) 폴리라인 버전 ──────────────────────────────
// 링크/차선 중심선은 2점이 아니라 여러 점으로 이루어진 경우가 많다(실측:
// scenario2_1 네트워크 708개 링크 중 41%가 3점 이상). 기존 *SegmentXxx/computePositionAtOffsetXxx*는
// 시작~끝 "직선 한 개"만 봐서, 곡선 도로에서 클릭 지점과 실제 스냅 위치가 수십 m씩
// 어긋나는 문제가 있었다(가장 굽은 실측 링크 기준 약 54m). 아래 폴리라인 버전은 전체 점을
// 순회하며 가장 가까운 세그먼트를 찾고, offset을 "시작점부터의 누적 실거리"로 정의한다 —
// 노면표시 렌더링에 이미 쓰이던 interpolateByOffset.ts의 interpolateAlongLine과 동일한 정의라
// 그쪽과도 자연히 호환된다.

/** OpenLayers: 폴리라인 전체 구간 중 target에 가장 가까운 점에 투영. offset = 시작점부터의 누적 실거리(m). */
export function projectPointOntoPolylineOl(
    points: Coordinate[],
    targetPosition: Coordinate,
    projection: string = 'EPSG:3857'
): ComputePointAtOffsetOl {
    if (points.length === 0) return {offset: 0, offsetPosition: [0, 0]};
    if (points.length === 1) return {offset: 0, offsetPosition: [points[0]![0]!, points[0]![1]!]};

    let cumulative = 0;
    let best: {distSq: number; offsetPosition: Coordinate; offset: number} | null = null;

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const {offset: segOffset, offsetPosition: proj} = projectPointOntoSegmentOl(start, end, targetPosition, projection);
        const dx = proj[0]! - targetPosition[0]!;
        const dy = proj[1]! - targetPosition[1]!;
        const distSq = dx * dx + dy * dy;
        if (!best || distSq < best.distSq) {
            best = {distSq, offsetPosition: proj, offset: cumulative + segOffset};
        }
        cumulative += getActualDistance(start, end, projection);
    }
    return {offset: best!.offset, offsetPosition: best!.offsetPosition};
}

/** Cesium: 폴리라인 전체 구간 중 target에 가장 가까운 점에 투영. offset = 시작점부터의 누적 실거리(m). */
export function projectPointOntoPolylineCesium(
    points: Cartesian3[],
    targetPosition: Cartesian3
): ComputePointAtOffsetCesium {
    if (points.length === 0) return {offset: 0, offsetPosition: new Cartesian3()};
    if (points.length === 1) return {offset: 0, offsetPosition: points[0]!.clone()};

    let cumulative = 0;
    let best: {distSq: number; offsetPosition: Cartesian3; offset: number} | null = null;

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const {offset: segOffset, offsetPosition: proj} = projectPointOntoSegmentCesium(start, end, targetPosition);
        const distSq = Cartesian3.distanceSquared(proj, targetPosition);
        if (!best || distSq < best.distSq) {
            best = {distSq, offsetPosition: proj, offset: cumulative + segOffset};
        }
        cumulative += Cartesian3.distance(start, end);
    }
    return {offset: best!.offset, offsetPosition: best!.offsetPosition};
}

export interface ComputePointAtOffsetOlWithDirection extends ComputePointAtOffsetOl {
    /** 투영 지점이 속한 구간의 단위 방향벡터(정규화됨, EPSG:3857 등 투영좌표계 기준) */
    direction: [number, number];
}

export interface ComputePointAtOffsetCesiumWithDirection extends ComputePointAtOffsetCesium {
    /** 투영 지점이 속한 구간의 단위 방향벡터(정규화됨) */
    direction: Cartesian3;
}

/** OpenLayers: 폴리라인 전체 구간을 따라 주어진 offset(누적 실거리, m)만큼 이동한 좌표 + 그 구간의 방향. */
export function computePositionAtOffsetPolylineOl(
    points: Coordinate[],
    offsetMeters: number,
    projection: string = 'EPSG:3857'
): ComputePointAtOffsetOlWithDirection {
    if (points.length === 0) return {offset: 0, offsetPosition: [0, 0], direction: [1, 0]};
    if (points.length === 1) return {offset: 0, offsetPosition: [points[0]![0]!, points[0]![1]!], direction: [1, 0]};

    const dirOf = (start: Coordinate, end: Coordinate): [number, number] => {
        const dx = end[0]! - start[0]!, dy = end[1]! - start[1]!;
        const len = Math.hypot(dx, dy);
        return len > 0 ? [dx / len, dy / len] : [1, 0];
    };

    let cumulative = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const segLen = getActualDistance(start, end, projection);
        if (segLen === 0) continue;
        if (cumulative + segLen >= offsetMeters || i === points.length - 2) {
            const {offsetPosition} = computePositionAtOffsetOl(start, end, offsetMeters - cumulative, projection);
            return {
                offset: Math.max(0, Math.min(offsetMeters, cumulative + segLen)),
                offsetPosition,
                direction: dirOf(start, end),
            };
        }
        cumulative += segLen;
    }
    const last = points[points.length - 1]!;
    const secondLast = points[points.length - 2]!;
    return {offset: cumulative, offsetPosition: [last[0]!, last[1]!], direction: dirOf(secondLast, last)};
}

/** Cesium: 폴리라인 전체 구간을 따라 주어진 offset(누적 실거리, m)만큼 이동한 좌표 + 그 구간의 방향. */
export function computePositionAtOffsetPolylineCesium(
    points: Cartesian3[],
    offsetMeters: number
): ComputePointAtOffsetCesiumWithDirection {
    if (points.length === 0) return {offset: 0, offsetPosition: new Cartesian3(), direction: Cartesian3.UNIT_X.clone()};
    if (points.length === 1) return {offset: 0, offsetPosition: points[0]!.clone(), direction: Cartesian3.UNIT_X.clone()};

    const dirOf = (start: Cartesian3, end: Cartesian3): Cartesian3 => {
        const d = Cartesian3.subtract(end, start, new Cartesian3());
        const len = Cartesian3.magnitude(d);
        return len > 0 ? Cartesian3.divideByScalar(d, len, d) : Cartesian3.UNIT_X.clone();
    };

    let cumulative = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const segLen = Cartesian3.distance(start, end);
        if (segLen === 0) continue;
        if (cumulative + segLen >= offsetMeters || i === points.length - 2) {
            const {offsetPosition} = computePositionAtOffsetCesium(start, end, offsetMeters - cumulative);
            return {
                offset: Math.max(0, Math.min(offsetMeters, cumulative + segLen)),
                offsetPosition,
                direction: dirOf(start, end),
            };
        }
        cumulative += segLen;
    }
    const last = points[points.length - 1]!;
    const secondLast = points[points.length - 2]!;
    return {offset: cumulative, offsetPosition: last.clone(), direction: dirOf(secondLast, last)};
}