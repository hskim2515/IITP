const EPSILON = 1e-9;

/**
 * 두 점(p1, p2)과 각 점에서 시작하는 두 방향 벡터(v1, v2)를 이용해
 * 두 벡터가 만나는 교점(p3)을 찾아 삼각형의 꼭짓점 [p1, p3, p2]를 반환합니다.
 * @param fromPt 첫 번째 점 (fromPt)
 * @param toPt 두 번째 점 (toPt)
 * @param fromVector p1에서 시작하는 방향 벡터 (fromLink의 방향)
 * @param toVector p2에서 시작하는 방향 벡터 (toLink의 방향)
 * @returns 삼각형의 꼭짓점 좌표 배열 [p1, p3, p2] 또는 교점이 없는 경우 null
 */
export function getTriangleConnectionPoints(
    fromPt: number[],
    toPt: number[],
    fromVector: number[],
    toVector: number[]
): number[][] | null {
    const [x1, y1] = fromPt;
    const [x2, y2] = toPt;
    const [v1x, v1y] = fromVector;
    const [v2x, v2y] = toVector;

    // 두 벡터 평행 확인
    const denominator = v1x * v2y - v1y * v2x;
    if (Math.abs(denominator) < EPSILON) {
        console.warn("방향 벡터가 평행하여 connection 삼각형을 생성할 수 없습니다.");
        return null;
    }

    const t = ((x2 - x1) * v2y - (y2 - y1) * v2x) / denominator;

    const p3: [number, number] = [
        x1 + t * v1x,
        y1 + t * v1y,
    ];

    // 삼각형 좌표 반환
    return [fromPt, p3, toPt];
}
