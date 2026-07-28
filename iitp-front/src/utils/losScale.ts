import * as Cesium from "cesium";

/**
 * 링크 혼잡도(V/C ratio)/서비스수준(LOS) 공용 색상 스케일.
 *
 * 백엔드(TrafficMetricsUtil)와 동일한 V/C 임계값을 쓴다 — 서버가 이미 losGrade를 계산해
 * 내려주므로 보통은 안 써도 되지만, 방어적으로(응답에 losGrade가 비어있는 과거 캐시 등) 유지한다.
 */
export function vcToLosGrade(vc: number): string | null {
    if (vc < 0) return null;
    if (vc <= 0.60) return "A";
    if (vc <= 0.70) return "B";
    if (vc <= 0.80) return "C";
    if (vc <= 0.90) return "D";
    if (vc <= 1.00) return "E";
    return "F";
}

/** LOS 등급(A~F) → 고정 색상 (hex). A=원활 → F=혼잡. */
const LOS_GRADE_COLORS: Record<string, string> = {
    A: "#2563eb", // 파랑
    B: "#22c55e", // 초록
    C: "#84cc16", // 연두
    D: "#eab308", // 노랑
    E: "#f97316", // 주황
    F: "#ef4444", // 빨강
};

const LOS_GRADE_NO_DATA = "#6b7280"; // 회색 — 계산 불가

export function losGradeColor(grade: string | null | undefined): string {
    if (!grade) return LOS_GRADE_NO_DATA;
    return LOS_GRADE_COLORS[grade] ?? LOS_GRADE_NO_DATA;
}

export function losGradeLabel(grade: string | null | undefined): string {
    if (!grade) return "데이터 없음";
    return `LOS ${grade}`;
}

/** 범례용 등급 목록 (A→F 순서) */
export const LOS_GRADE_LEGEND: Array<{ grade: string; color: string; label: string }> =
    (["A", "B", "C", "D", "E", "F"] as const).map((g) => ({
        grade: g,
        color: LOS_GRADE_COLORS[g]!,
        label: `LOS ${g}`,
    }));

/**
 * 혼잡도 히트맵용 연속 그라데이션 (hex) — 0=원활(초록) → 1.0=포화(빨강) → 1.2+=진한빨강(오버플로우).
 */
export function vcToContinuousColorHex(vc: number): string {
    if (vc < 0) return LOS_GRADE_NO_DATA;
    const t = Math.max(0, Math.min(1, vc));
    // 0~0.5: 초록(34,197,94) → 노랑(234,179,8), 0.5~1.0: 노랑 → 빨강(239,68,68)
    let r: number, g: number, b: number;
    if (t < 0.5) {
        const k = t * 2;
        r = Math.round(34 + (234 - 34) * k);
        g = Math.round(197 + (179 - 197) * k);
        b = Math.round(94 + (8 - 94) * k);
    } else {
        const k = (t - 0.5) * 2;
        r = Math.round(234 + (239 - 234) * k);
        g = Math.round(179 + (68 - 179) * k);
        b = Math.round(8 + (68 - 8) * k);
    }
    if (vc > 1.0) {
        // 포화 초과 — 진한 빨강(153,27,27) 쪽으로 추가 보간(최대 1.5에서 완전 도달)
        const over = Math.max(0, Math.min(1, (vc - 1.0) / 0.5));
        r = Math.round(239 + (153 - 239) * over);
        g = Math.round(68 + (27 - 68) * over);
        b = Math.round(68 + (27 - 68) * over);
    }
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function vcToContinuousColor(vc: number): Cesium.Color {
    return Cesium.Color.fromCssColorString(vcToContinuousColorHex(vc));
}

export function losGradeCesiumColor(grade: string | null | undefined): Cesium.Color {
    return Cesium.Color.fromCssColorString(losGradeColor(grade));
}

/**
 * 시설 서비스권 커버리지("영향권") 그라데이션 — 회색(0곳, 사각지대) → 청록(겹치는 시설 수만큼
 * 진해짐). V/C 계열(초록→빨강)·등시선 계열(파랑→보라)과 또 다른 색상 축을 써서 기존 레이어들과
 * 혼동되지 않게 한다.
 * @param count    이 링크에 도달 가능한 시설 수 (0 = 사각지대)
 * @param maxCount 정규화 기준 최대값(해당 tier/뷰포트 내 실제 최대 coverageCount)
 */
export function coverageColorHex(count: number, maxCount: number): string {
    if (count <= 0) return "#9ca3af"; // 회색 — 사각지대
    const k = Math.max(0, Math.min(1, count / Math.max(1, maxCount)));
    const from = { r: 0x99, g: 0xf6, b: 0xe4 }; // #99f6e4 옅은 청록 (커버 1곳)
    const to   = { r: 0x0f, g: 0x76, b: 0x6e }; // #0f766e 진한 청록 (많이 겹침)
    const r = Math.round(from.r + (to.r - from.r) * k);
    const g = Math.round(from.g + (to.g - from.g) * k);
    const b = Math.round(from.b + (to.b - from.b) * k);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function coverageColor(count: number, maxCount: number): Cesium.Color {
    return Cesium.Color.fromCssColorString(coverageColorHex(count, maxCount));
}
