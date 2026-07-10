import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/**
 * 편집으로 변경된 링크/노드 id 추적 (편집 델타 오버레이 + MVT 마스킹 + 타일 동기화 보존용).
 *
 * 타일/MVT 모드에선 도로가 서버 벡터타일로 렌더되고 currentJsonData 는 viewport 타일과
 * 주기 동기화(scheduleStoreSync)된다. 이 스토어의 id 집합이 세 가지 역할을 한다:
 *  - editedLinkIds: 오버레이로 그림 + MVT 에서 원본 숨김(이중 렌더 방지) + 동기화 시 보존
 *  - deletedLinkIds: MVT 마스킹 + 동기화 시 제외
 *  - editedNodeIds / deletedNodeIds: 동기화 시 보존/제외 — 없으면 노드 이동·커넥션 편집이
 *    다음 타일 동기화에서 서버 원본으로 되돌아간다 (타일 모드 편집 유실의 근본 원인)
 *
 * 채우는 방식: 링크/노드 edited 는 NetworkFeatureLayer.updateEditDeltas 가 서버 타일 캐시와
 * 해시 비교로 자동 감지(모든 편집 경로 커버). deleted 는 삭제 조작 지점에서 명시 호출
 * (뷰포트 한계로 diff 로는 삭제를 신뢰성 있게 감지할 수 없음).
 */
interface NetworkEditState {
    /** 추가/수정된 링크 id (String) — 오버레이로 그림 + MVT 숨김 + 동기화 보존. */
    editedLinkIds: Set<string>;
    /** 삭제된 링크 id (String) — MVT 마스킹 + 동기화 제외. */
    deletedLinkIds: Set<string>;
    /** 추가/수정된 노드 id (String) — 동기화 시 서버 타일 대신 편집본 보존. */
    editedNodeIds: Set<string>;
    /** 삭제된 노드 id (String) — 동기화 시 제외 (없으면 삭제한 노드가 되살아남). */
    deletedNodeIds: Set<string>;
    /** 링크 편집 diff 결과 반영. */
    setEdits: (edited: Set<string>, deleted: Set<string>) => void;
    /** 노드 편집 diff 결과 반영. */
    setNodeEdits: (edited: Set<string>) => void;
    /** 삭제된 링크 id 누적(삭제 조작 지점에서 호출). */
    addDeleted: (ids: (string | number)[]) => void;
    /** 삭제된 노드 id 누적(삭제 조작 지점에서 호출). */
    addDeletedNodes: (ids: (string | number)[]) => void;
    /** 저장/리로드 시 초기화. */
    clear: () => void;
}

export const useNetworkEditStore = create<NetworkEditState>()(
    subscribeWithSelector((set) => ({
        editedLinkIds: new Set<string>(),
        deletedLinkIds: new Set<string>(),
        editedNodeIds: new Set<string>(),
        deletedNodeIds: new Set<string>(),
        setEdits: (edited, deleted) => set({ editedLinkIds: edited, deletedLinkIds: deleted }),
        setNodeEdits: (edited) => set({ editedNodeIds: edited }),
        addDeleted: (ids) => set((s) => {
            const next = new Set(s.deletedLinkIds);
            for (const id of ids) next.add(String(id));
            // 삭제된 링크는 편집(추가/수정) 대상에서 제외
            const edited = new Set(s.editedLinkIds);
            for (const id of ids) edited.delete(String(id));
            return { deletedLinkIds: next, editedLinkIds: edited };
        }),
        addDeletedNodes: (ids) => set((s) => {
            const next = new Set(s.deletedNodeIds);
            for (const id of ids) next.add(String(id));
            const edited = new Set(s.editedNodeIds);
            for (const id of ids) edited.delete(String(id));
            return { deletedNodeIds: next, editedNodeIds: edited };
        }),
        clear: () => set({
            editedLinkIds: new Set<string>(), deletedLinkIds: new Set<string>(),
            editedNodeIds: new Set<string>(), deletedNodeIds: new Set<string>(),
        }),
    })),
);
