/**
 * 급꺾임 폴리라인 코너 스무딩 (Chaikin corner-cutting).
 *
 * <p>KTDB/OSM 변환기가 합성한 커넥션 shape 는 [진입 직진 → 한 점 직각 꺾임 → 진출 직진]
 * 형태의 각진 폴리라인이라(실측 꺾임각 90~120° 확인), 그대로 그리면 교차로 커넥션이
 * 직각으로 보인다. 반면 교통섬 순환 등 진짜 실측 경로는 완만하므로 변형하면 안 된다.
 *
 * <p>→ 중간 정점의 최대 꺾임각이 임계값을 넘는 경우에만 Chaikin 반복으로 코너를 둥글린다.
 * Chaikin 은 양 끝점을 보존하고 경로 전체 형상을 유지한 채 모서리만 잘라내므로
 * 합성 shape 의 "경유 지점" 의미(차선 정렬)를 해치지 않는다.
 */

export interface LngLat { lng: number; lat: number }

/** 중간 정점 최대 꺾임각(도). 2점 이하 또는 계산 불가 시 0. */
export function maxBendDeg(pts: LngLat[]): number {
    let max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
        const v1x = b.lng - a.lng, v1y = b.lat - a.lat;
        const v2x = c.lng - b.lng, v2y = c.lat - b.lat;
        const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
        if (!m1 || !m2) continue;
        const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
        const deg = (Math.acos(cos) * 180) / Math.PI;
        if (deg > max) max = deg;
    }
    return max;
}

/**
 * 급꺾임(임계각 초과)이 있을 때만 Chaikin 스무딩 적용, 아니면 원본 그대로 반환.
 * @param pts 폴리라인 (lng/lat)
 * @param sharpDeg 스무딩 발동 임계 꺾임각 (기본 35°)
 * @param iterations Chaikin 반복 수 (기본 2 — 정점 수 ~4배, 모서리 충분히 둥글어짐)
 */
export function smoothSharpPolyline(pts: LngLat[], sharpDeg = 35, iterations = 2): LngLat[] {
    if (pts.length < 3) return pts;
    if (maxBendDeg(pts) <= sharpDeg) return pts; // 완만한 실측 경로는 원본 유지
    let cur = pts;
    for (let k = 0; k < iterations; k++) {
        const next: LngLat[] = [cur[0]!];
        for (let i = 0; i < cur.length - 1; i++) {
            const a = cur[i]!, b = cur[i + 1]!;
            next.push({ lng: a.lng * 0.75 + b.lng * 0.25, lat: a.lat * 0.75 + b.lat * 0.25 });
            next.push({ lng: a.lng * 0.25 + b.lng * 0.75, lat: a.lat * 0.25 + b.lat * 0.75 });
        }
        next.push(cur[cur.length - 1]!);
        cur = next;
    }
    return cur;
}
