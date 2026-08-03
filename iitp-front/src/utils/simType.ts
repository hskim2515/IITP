/**
 * 링크 simType(Meso/Micro) 정규화 + 셀(cell) 기본값 합성.
 *
 * 백엔드 SimType enum(DbMappedEnum, Meso=0/Micro=1)은 JSON에서 문자열("Meso"/"Micro")로
 * 내려오지만(LinkResponse), 프론트가 직접 만드는 새 링크(makeLink/makeLinkFromCoords)는
 * 숫자 리터럴(simType: 0)을 쓴다 — turning(S vs Straight)과 동일한 이중 표기 문제라
 * 항상 이 함수로 정규화해서 비교할 것.
 *
 * <p>레거시 참조 구현(source_code/backend/parseXML.py) 확인 결과: 셀은 simType에 따라
 * 규칙이 다르다 — Micro는 분할 없이 링크(레인) 전체가 셀 1개, Meso만 일정 간격(레거시는
 * 60m 고정)으로 나뉜다. 기존 코드는 이 구분 없이 셀 개수 폴백에 100m(useNetworkSelect.ts)
 * 또는 5m(useNetworkDraw.ts DEFAULT_CELL_LENGTH)를 제각각 썼는데, 실제 규약과 무관한 임의
 * 상수였다 — 이 파일로 통일.
 */
export type SimTypeWord = 'Meso' | 'Micro';

export function normalizeSimType(t: unknown): SimTypeWord {
    if (t === 'Micro' || t === 1 || t === '1') return 'Micro';
    return 'Meso'; // 미상 값은 Meso 취급(기존 기본값 simType:0과 동일)
}

/** 레거시 백엔드(parseXML.py cellDistance)와 동일한 Meso 셀 길이 규약(m) */
export const MESO_CELL_LENGTH = 60;

/** simType에 따른 기본 셀 개수 — Micro는 항상 1(분할 없음), Meso는 60m 단위. */
export function defaultNumCells(length: number, simType: unknown): number {
    if (normalizeSimType(simType) === 'Micro') return 1;
    return Math.max(1, Math.ceil(length / MESO_CELL_LENGTH));
}

/** 실측 cells가 없을 때(그린 도로, 또는 병합 상대편에 cells가 없는 경우) 채워 넣을 기본 cells[] 합성. */
export function synthesizeCells(length: number, simType: unknown): { id: number; length: number; offset: number }[] {
    if (normalizeSimType(simType) === 'Micro') {
        return [{ id: 0, length, offset: 0 }];
    }
    const n = Math.max(1, Math.ceil(length / MESO_CELL_LENGTH));
    return Array.from({ length: n }, (_, i) => {
        const offset = i * MESO_CELL_LENGTH;
        return { id: i, length: Math.min(MESO_CELL_LENGTH, length - offset), offset };
    });
}
