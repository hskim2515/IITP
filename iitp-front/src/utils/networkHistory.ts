import type { UpdateLogEntry } from "@type/HistoryTypes";
import { NETWORK_TILING } from "@utils/lodConstants";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useNetworkEditStore } from "@stores/useNetworkEditStore";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";

/**
 * 타일 모드 네트워크 undo/redo 후 삭제 상태 정합.
 *
 * <p>undo/redo 는 currentJsonData 만 되돌리는데, 타일 모드의 삭제는 두 곳에 더 기록된다:
 *  - useNetworkEditStore.deletedLink/NodeIds — MVT 마스킹(서버 타일의 옛 형상 숨김)
 *  - store.deletedRecords — diff 저장 시 서버로 보낼 삭제 목록
 *
 * <p>이걸 함께 되돌리지 않으면: 삭제 undo 후에도 링크가 MVT 에서 계속 숨겨져 "복원됐는데
 * 안 보이고", 저장 시 deletedRecords 에 남아 **복원한 링크가 서버에서 삭제**된다.
 * 반대로 삭제 redo 는 마스크/삭제 목록을 재적용해야 저장 시 삭제가 유실되지 않는다.
 */
export function reconcileNetworkHistoryTileState(entry: UpdateLogEntry, isUndo: boolean): void {
    if (!NETWORK_TILING.ENABLED && !useNetworkTileStore.getState().tileMode) return;
    const deleted = entry.deleted ?? [];
    if (deleted.length === 0) return;

    // 삭제 로그는 필드별로 흩어져 있음(guid 당 field/oldValue 목록) → guid 별 객체로 복원
    const byGuid = new Map<string, Record<string, any>>();
    for (const c of deleted) {
        const key = String(c.guid);
        if (!byGuid.has(key)) byGuid.set(key, {});
        if (c.field != null) byGuid.get(key)![c.field] = c.oldValue;
    }

    const linkIds: string[] = [];
    const nodeIds: string[] = [];
    const guids: string[] = [];
    const records: any[] = [];
    for (const [guid, rec] of byGuid) {
        // 마스킹/diff 삭제 대상은 링크/노드만 (lane/port 등 하위 요소는 부모 upsert 로 반영됨)
        if ((rec.featureType !== "links" && rec.featureType !== "nodes") || rec.id == null) continue;
        (rec.featureType === "links" ? linkIds : nodeIds).push(String(rec.id));
        guids.push(guid);
        records.push(rec);
    }
    if (guids.length === 0) return;

    const editStore = useNetworkEditStore.getState();
    const netStore = useNetworkStore.getState() as any;
    if (isUndo) {
        // 삭제 취소: MVT 마스크 해제 + diff 삭제 목록에서 제거
        editStore.removeDeleted(linkIds);
        editStore.removeDeletedNodes(nodeIds);
        netStore.removeDeletedRecordsByGuid?.(guids);
    } else {
        // 삭제 재적용(redo): 마스크 + diff 삭제 목록 재누적
        if (linkIds.length) editStore.addDeleted(linkIds);
        if (nodeIds.length) editStore.addDeletedNodes(nodeIds);
        netStore.addDeletedRecords?.(records);
    }
}
