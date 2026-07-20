/**
 * 급꺾임 폴리라인 코너 스무딩 (반경 상한 필렛).
 *
 * <p>KTDB/OSM 변환기가 합성한 커넥션 shape 는 [진입 직진 → 한 점 직각 꺾임 → 진출 직진]
 * 형태의 각진 폴리라인이라(실측 꺾임각 90~120°), 그대로 그리면 교차로 커넥션이
 * 직각으로 보인다. 반면 교통섬 순환 등 진짜 실측 경로는 완만하므로 변형하면 안 된다.
 *
 * <p>구현: 급꺾임(임계각 초과) 정점만, 꼭짓점에서 **미터 단위 상한 거리**(기본 4m)
 * 안쪽으로 잘라 2차 베지어 필렛으로 둥글린다. 세그먼트 비례(Chaikin) 방식은
 * 세그먼트가 길면 회전반경이 수십 m 로 폭주해 사거리 중앙에 원이 생기던 문제
 * (실사용 보고) — 절대 반경 상한으로 차량 회전반경 스케일을 유지한다.
 * 끝점·완만한 정점은 보존되므로 차선 정렬/경유점 의미 불변.
 */

export interface LngLat { lng: number; lat: number }

/** 한국 위도권 근사 (lng 1도 ≈ 88km, lat 1도 ≈ 111km — 코드베이스 공통 근사) */
const M_PER_DEG_LNG = 88000;
const M_PER_DEG_LAT = 111000;

function distM(a: LngLat, b: LngLat): number {
    return Math.hypot((b.lng - a.lng) * M_PER_DEG_LNG, (b.lat - a.lat) * M_PER_DEG_LAT);
}

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

/** b 에서 toward 방향으로 dM 미터 이동한 점 */
function pointToward(b: LngLat, toward: LngLat, dM: number): LngLat {
    const total = distM(b, toward);
    if (total <= 1e-6) return b;
    const t = Math.min(1, dM / total);
    return { lng: b.lng + (toward.lng - b.lng) * t, lat: b.lat + (toward.lat - b.lat) * t };
}

/**
 * 급꺾임 정점만 반경 상한 필렛으로 둥글린 폴리라인 반환 (급꺾임 없으면 원본 그대로).
 * @param pts 폴리라인 (lng/lat)
 * @param sharpDeg 필렛 발동 임계 꺾임각 (기본 35°)
 * @param radiusM 꼭짓점에서 잘라내는 최대 거리(m, 기본 4 — 차량 회전반경 스케일).
 *                인접 세그먼트의 45% 를 넘지 않아 경유점 형상 유지.
 */
export function smoothSharpPolyline(pts: LngLat[], sharpDeg = 35, radiusM = 4): LngLat[] {
    if (pts.length < 3) return pts;
    let hasSharp = false;
    for (let i = 1; i < pts.length - 1; i++) {
        if (bendDeg(pts[i - 1]!, pts[i]!, pts[i + 1]!) > sharpDeg) { hasSharp = true; break; }
    }
    if (!hasSharp) return pts; // 완만한 실측 경로는 원본 유지

    const out: LngLat[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = out[out.length - 1]!; // 직전 출력점 기준 (연속 필렛 겹침 방지)
        const b = pts[i]!, c = pts[i + 1]!;
        if (bendDeg(pts[i - 1]!, b, c) <= sharpDeg) { out.push(b); continue; }
        const d = Math.min(radiusM, distM(a, b) * 0.45, distM(b, c) * 0.45);
        if (d < 0.3) { out.push(b); continue; } // 너무 짧으면 필렛 무의미
        const p1 = pointToward(b, a, d);
        const p2 = pointToward(b, c, d);
        // p1 → (ctrl=b) → p2 2차 베지어 필렛 (끝점 제외 내부 7점)
        for (let k = 0; k <= 8; k++) {
            const t = k / 8, u = 1 - t;
            out.push({
                lng: u * u * p1.lng + 2 * u * t * b.lng + t * t * p2.lng,
                lat: u * u * p1.lat + 2 * u * t * b.lat + t * t * p2.lat,
            });
        }
    }
    out.push(pts[pts.length - 1]!);
    return out;
}
