/**
 * 변환기 합성 커넥션 shape 의 회전 궤적 재구성.
 *
 * <p>KTDB/OSM 변환기가 합성한 커넥션 shape 는 [진입 직진 → 급꺾임(90~120°) → 진출 직진]
 * 폴리라인이라 그대로 그리면 직각으로 보인다. 중간 경유점은 변환기 인공물이므로,
 * 급꺾임 shape 는 **진입/진출 접선 기반 3차 베지어 호** 하나로 통째로 대체한다 —
 * 정지선(시작점)에서 진입 차선 방향으로 나가 진출 차선 방향에 접하며 들어오는,
 * 실제 차량 회전 궤적과 같은 형태(좌회전=교차로를 크게 도는 호, 우회전=모서리의
 * 작은 호 — 시작·끝 거리에 비례해 자연스럽게 결정됨).
 *
 * <p>교통섬 순환 등 완만한 실측 경로(최대 꺾임 ≤ 임계각)는 원본 그대로 둔다.
 *
 * <p>이전 시도의 교훈: Chaikin(세그먼트 비례)은 회전반경이 수십 m 로 폭주해 사거리
 * 중앙에 원이 생겼고, 소반경 필렛(4m)은 "코너까지 직진 후 급선회"라 차량 궤적이
 * 아니었다. 접선 호가 두 문제 모두 없는 정공법.
 */

export interface LngLat { lng: number; lat: number }

/** 한국 위도권 근사 (lng 1도 ≈ 88km, lat 1도 ≈ 111km — 코드베이스 공통 근사) */
const M_PER_DEG_LNG = 88000;
const M_PER_DEG_LAT = 111000;

function bendDeg(a: LngLat, b: LngLat, c: LngLat): number {
    const v1x = (b.lng - a.lng) * M_PER_DEG_LNG, v1y = (b.lat - a.lat) * M_PER_DEG_LAT;
    const v2x = (c.lng - b.lng) * M_PER_DEG_LNG, v2y = (c.lat - b.lat) * M_PER_DEG_LAT;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (!m1 || !m2) return 0;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    return (Math.acos(cos) * 180) / Math.PI;
}

/** 중간 정점 최대 꺾임각(도). 2점 이하 또는 계산 불가 시 0. */
export function maxBendDeg(pts: LngLat[]): number {
    let max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = bendDeg(pts[i - 1]!, pts[i]!, pts[i + 1]!);
        if (d > max) max = d;
    }
    return max;
}

/** a→b 단위벡터 (미터 평면) — 길이 0 이면 null */
function unitDirM(a: LngLat, b: LngLat): { x: number; y: number } | null {
    const x = (b.lng - a.lng) * M_PER_DEG_LNG, y = (b.lat - a.lat) * M_PER_DEG_LAT;
    const m = Math.hypot(x, y);
    return m > 1e-6 ? { x: x / m, y: y / m } : null;
}

/**
 * 급꺾임(임계각 초과) shape 만 진입/진출 접선 3차 베지어 호로 대체.
 * 완만한 실측 경로는 원본 그대로 반환.
 * @param pts 폴리라인 (lng/lat, 3점 이상일 때만 의미)
 * @param sharpDeg 대체 발동 임계 꺾임각 (기본 35°)
 */
export function smoothSharpPolyline(pts: LngLat[], sharpDeg = 35): LngLat[] {
    if (pts.length < 3) return pts;
    if (maxBendDeg(pts) <= sharpDeg) return pts; // 완만한 실측 경로는 원본 유지

    const A = pts[0]!, B = pts[pts.length - 1]!;
    // 접선: 진입 = 첫 세그먼트 방향(shape 는 차선에서 직진 진입하므로 차선 방향과 일치),
    //        진출 = 마지막 세그먼트 방향. 퇴화(중복점) 시 다음/이전 점으로 폴백.
    let u = null, v = null;
    for (let i = 1; i < pts.length && !u; i++) u = unitDirM(A, pts[i]!);
    for (let i = pts.length - 2; i >= 0 && !v; i--) v = unitDirM(pts[i]!, B);
    if (!u || !v) return pts;

    // 컨트롤 거리 = 시작-끝 직선거리의 40% (도로 곡선 합성 표준 스케일).
    // 좌회전(멀리)=큰 호, 우회전(가까이)=작은 호가 자동으로 나온다.
    const distM = Math.hypot((B.lng - A.lng) * M_PER_DEG_LNG, (B.lat - A.lat) * M_PER_DEG_LAT);
    const d = distM * 0.4;
    const p1 = { lng: A.lng + (u.x * d) / M_PER_DEG_LNG, lat: A.lat + (u.y * d) / M_PER_DEG_LAT };
    const p2 = { lng: B.lng - (v.x * d) / M_PER_DEG_LNG, lat: B.lat - (v.y * d) / M_PER_DEG_LAT };

    const out: LngLat[] = [];
    const N = 16;
    for (let k = 0; k <= N; k++) {
        const t = k / N, s = 1 - t;
        out.push({
            lng: s * s * s * A.lng + 3 * s * s * t * p1.lng + 3 * s * t * t * p2.lng + t * t * t * B.lng,
            lat: s * s * s * A.lat + 3 * s * s * t * p1.lat + 3 * s * t * t * p2.lat + t * t * t * B.lat,
        });
    }
    return out;
}
