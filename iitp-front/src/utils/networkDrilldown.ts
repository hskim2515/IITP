/**
 * 레인 종방향 위치(frac 0~1) → 세그먼트/셀 인덱스 산출 헬퍼.
 *
 * <p>과거엔 같은 지점을 반복 클릭해 링크→레인→세그먼트→셀로 깊이를 늘려가는 방식이었으나,
 * 클릭할 때마다 결과가 화면 반대편 고정 패널에 나타나고 몇 번째 클릭인지 기억해야 해서
 * 불편하다는 피드백으로 폐기했다 — 지금은 클릭 지점에 뜨는 맥락 툴바(NetworkEditToolbar,
 * useNetworkToolbarStore)의 "차선보기"/"구간보기"/"셀보기" 버튼이 이 함수들로 다음 단계
 * 대상을 계산해 지도 재클릭 없이 바로 전환한다.
 *
 * <p>세그먼트(구간, block 여부로 레인 드롭/합류 차로를 표현)와 셀(CTM 시뮬레이션 단위)은
 * 서로 다른 축의 분할이라 별개 단계로 둔다 — 실측(2_toy network/network.xml): cell은 링크
 * 전체 길이로 1개뿐인데 그 안에 block=True/False 세그먼트 2개가 걸쳐 있는 경우가 흔하다.
 */

/**
 * 레인 종방향 비율(frac 0~1)에서 세그먼트 인덱스 산출 — initPoint~endPoint(m) 경계 기준.
 * segments는 항상 initPoint 오름차순으로 유지된다는 전제(splitSegmentInNetwork/
 * mergeSegmentInNetwork가 이 불변식을 지킴).
 */
export function segmentIndexAtFrac(lane: any, link: any, frac: number): number {
    const segments = lane?.segments ?? [];
    if (segments.length === 0) return 0;
    const length = link?.length ?? 0;
    const d = Math.max(0, Math.min(1, frac)) * length;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (d >= (s?.initPoint ?? 0) && d < (s?.endPoint ?? length)) return i;
    }
    return segments.length - 1;
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
