/**
 * 네트워크 선택 드릴다운: 같은 지점을 반복 클릭하면 링크 → 레인 → 셀(세그먼트)로 깊이 증가.
 * 다른 지점 클릭 시 깊이 리셋. 2D(useNetworkSelect·handleOLSelect)와 3D(handleCesiumSelect)가
 * 공유하는 모듈 레벨 상태.
 */

export type DrillDepth = 'link' | 'lane' | 'cell';

let lastKey = "";       // 직전 클릭이 얹힌 대상 키(linkId 또는 linkId_laneIdx)
let lastDepth: DrillDepth = 'link';

/** 클릭 대상 키가 직전과 같으면 깊이 증가(link→lane→cell), 다르면 리셋(link). 새 깊이 반환. */
export function nextDrillDepth(targetKey: string): DrillDepth {
    if (targetKey === lastKey) {
        lastDepth = lastDepth === 'link' ? 'lane' : lastDepth === 'lane' ? 'cell' : 'cell';
    } else {
        lastKey = targetKey;
        lastDepth = 'link';
    }
    return lastDepth;
}

/** 드릴다운 상태 초기화(선택 해제·모드 전환 시). */
export function resetDrill(): void {
    lastKey = "";
    lastDepth = 'link';
}

/**
 * 레인 종방향 비율(frac 0~1)에서 셀 인덱스 산출.
 *   cells 있으면 그 경계(offset/length), 없으면 numCell 균등분할.
 */
export function cellIndexAtFrac(lane: any, link: any, frac: number): number {
    const cells = lane?.cells ?? [];
    const length = link?.length ?? 0;
    const d = Math.max(0, Math.min(1, frac)) * length; // 종방향 거리(m)
    if (cells.length > 0 && length > 0) {
        // 셀 경계: 각 셀의 offset(시작)~offset+length(끝). offset 없으면 균등 가정.
        let acc = 0;
        for (let i = 0; i < cells.length; i++) {
            const cl = cells[i]?.length ?? (length / cells.length);
            if (d < acc + cl) return i;
            acc += cl;
        }
        return cells.length - 1;
    }
    // cells 비어있음(클라이언트 생성) → numCell 균등분할
    const n = Math.max(1, lane?.numCell ?? link?.lanes?.[0]?.numCell ?? (Math.ceil(length / 100) || 1));
    return Math.max(0, Math.min(n - 1, Math.floor(frac * n)));
}

/** 셀 개수(cells 있으면 그 수, 없으면 numCell). */
export function cellCount(lane: any, link: any): number {
    const cells = lane?.cells ?? [];
    if (cells.length > 0) return cells.length;
    const length = link?.length ?? 0;
    return Math.max(1, lane?.numCell ?? (Math.ceil(length / 100) || 1));
}
