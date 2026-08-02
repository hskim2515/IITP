import { fromLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

/**
 * 실제 미터 → EPSG:3857 단위.
 * Web Mercator 스케일 팩터는 위도 φ 에서 1/cos(φ) 이라, 미터를 그대로 3857 에 더하면
 * 한국(≈37°) 기준 ~25% 작아져 MVT(서버 metersToTile)와 어긋난다.
 */
export function metersTo3857(meters: number, latDeg: number): number {
    const cos = Math.cos((latDeg * Math.PI) / 180);
    return cos > 1e-6 ? meters / cos : meters;
}

/** 링크 좌표의 대표 위도(평균) — 미터→3857 변환용 */
function linkMeanLat(link: any): number {
    const coords = link?.coordinates ?? [];
    if (coords.length === 0) return 37;
    let sum = 0, n = 0;
    for (const c of coords) {
        if (c && isFinite(c.lat)) { sum += c.lat; n++; }
    }
    return n > 0 ? sum / n : 37;
}

/**
 * 레인 폴리곤 링(EPSG:3857) — MVT(NetworkTileService.buildOffsetPolygon)·3D 렌더와 동일.
 *   중앙정렬 + 차선0=최좌측, 우측(+) 법선(nx=sdy, ny=-sdx) 기준.
 *   폭은 실제 미터를 위도 보정 후 3857 에 적용(MVT metersToTile 과 정합).
 *   차선 반폭은 MVT 와 같이 0.94 배(차선 사이 틈).
 *   fracStart/fracEnd(0~1) 지정 시 종방향 그 구간만(셀 하이라이트용).
 *
 * ⚠️ 선택(클릭)·호버·MVT 렌더가 이 단일 소스를 써야 "화면에 보이는 차선"과 겹친다.
 */
export function buildLaneRing3857(
    link: any,
    laneIdx: number,
    fracStart = 0,
    fracEnd = 1,
): number[][] | null {
    const lanes = link?.lanes ?? [];
    const laneCount = lanes.length || link?.numLane || 0;
    if (laneCount === 0 || laneIdx < 0 || laneIdx >= laneCount) return null;
    const roadW = link.width ?? 7;
    const lat = linkMeanLat(link);
    const laneW = metersTo3857(roadW / laneCount, lat);
    // MVT/3D 렌더 정합: 중앙정렬 + 차선0=최좌측. 우측(+) 법선 기준 좌측은 음수.
    const off = (laneIdx - (laneCount - 1) / 2) * laneW;
    // MVT detail 은 차선 폭의 94% 로 사이 틈을 냄 — hover/선택도 동일해야 겹친다.
    const half = laneW / 2 * 0.94;
    let pts: number[][] = (link.coordinates ?? []).map((c: any) => fromLonLat([c.lng, c.lat]));
    if (pts.length < 2) return null;
    // 종방향 구간 클립: 누적거리 비율 [fracStart, fracEnd] 에 해당하는 중심선 부분경로 추출.
    if (fracStart > 0 || fracEnd < 1) {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!));
        const total = cum[cum.length - 1]! || 1;
        const dS = fracStart * total, dE = fracEnd * total;
        const at = (d: number): number[] => {
            for (let i = 1; i < cum.length; i++) if (d <= cum[i]!) { const t = (d - cum[i - 1]!) / ((cum[i]! - cum[i - 1]!) || 1); return [pts[i - 1]![0]! + (pts[i]![0]! - pts[i - 1]![0]!) * t, pts[i - 1]![1]! + (pts[i]![1]! - pts[i - 1]![1]!) * t]; }
            return pts[pts.length - 1]!;
        };
        const sub: number[][] = [at(dS)];
        for (let i = 0; i < pts.length; i++) if (cum[i]! > dS && cum[i]! < dE) sub.push(pts[i]!);
        sub.push(at(dE));
        pts = sub;
        if (pts.length < 2) return null;
    }
    const left: number[][] = [], right: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)]!;
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const sdx = next[0]! - prev[0]!, sdy = next[1]! - prev[1]!;
        const sl = Math.hypot(sdx, sdy) || 1;
        const nx = sdy / sl, ny = -sdx / sl; // 우측 법선(3D right 정합)
        const cx = pts[i]![0]! + nx * off, cy = pts[i]![1]! + ny * off;
        left.push([cx + nx * half, cy + ny * half]);
        right.push([cx - nx * half, cy - ny * half]);
    }
    return [...left, ...right.reverse(), left[0]!];
}

/**
 * linkRef/laneIdx 로 네트워크 store(뷰포트 작업셋)에서 링크를 찾아 레인 폴리곤 링(3857) 반환.
 * 링크가 작업셋에 없으면 null (호출측이 폴백 처리).
 */
export function getLaneRing3857ByRef(linkRef: unknown, laneIdx: number): number[][] | null {
    const network: any = layerNameToStoreMap["network"]?.getState()?.currentJsonData;
    const link = network?.links?.find((l: any) => l && String(l.id) === String(linkRef));
    if (!link) return null;
    return buildLaneRing3857(link, laneIdx);
}
