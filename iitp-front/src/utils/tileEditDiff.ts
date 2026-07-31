/** 레코드 내용 서명 — 그대로 직렬화(레코드 자체가 유일 id 기준이라 순서 문제 없음). */
function recordSignature(r: any): string {
    return JSON.stringify(r);
}

/**
 * 타일링된 시설물의 "미저장 로컬 편집" 항목을 자동으로 찾아낸다 — 마운트 시점 서버 원본
 * (originData)과 지금 스토어(currentJsonData)를 고유 id 기준으로 비교해 새로 생기거나
 * 바뀐 레코드 / 완전히 지워진 레코드를 계산한다.
 *
 * 네트워크(NetworkFeatureLayer.updateEditDeltas)·신호(diffSignalEditsByNode, @utils/signal)와
 * 같은 발상이지만, 이 시설물들(버스/철도정류장, 노면표시)은 레코드 하나하나가 독립된 렌더
 * 단위(점 하나 = 레코드 하나)라 신호처럼 nodeId로 그룹핑할 필요 없이 id 단위로 바로 비교하면
 * 충분하다 — generateXForNode 같은 개별 mutation 호출부를 계측할 필요 없이 모든 편집 경로를
 * 자동으로 잡아낸다.
 */
export function diffRecordEditsById(
    originRecords: any[] | undefined,
    currentRecords: any[] | undefined,
    idField: string = 'id',
): { editedIds: Set<string>; deletedIds: Set<string> } {
    const origById = new Map<string, any>();
    for (const r of originRecords ?? []) {
        const k = String(r?.[idField] ?? '');
        if (k) origById.set(k, r);
    }
    const curById = new Map<string, any>();
    for (const r of currentRecords ?? []) {
        const k = String(r?.[idField] ?? '');
        if (k) curById.set(k, r);
    }
    const editedIds = new Set<string>();
    for (const [id, curRec] of curById) {
        const origRec = origById.get(id);
        if (!origRec || recordSignature(origRec) !== recordSignature(curRec)) editedIds.add(id);
    }
    const deletedIds = new Set<string>();
    for (const id of origById.keys()) {
        if (!curById.has(id)) deletedIds.add(id);
    }
    return { editedIds, deletedIds };
}
