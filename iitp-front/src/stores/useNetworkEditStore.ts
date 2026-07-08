import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/**
 * 편집으로 변경된 링크 id 추적 (편집 델타 오버레이용).
 *
 * 타일/MVT 모드에선 도로 링크가 서버 벡터타일로 렌더되어, 방금 그리거나 수정한 링크가
 * 화면에 안 나온다(서버 타일엔 없음). 이 스토어가 "편집된 링크 id"를 모아두면,
 * NetworkFeatureLayer 가 그 링크만 currentJsonData 에서 OL 벡터로 MVT 위에 오버레이 렌더한다.
 *
 * 채우는 방식(무침습): NetworkFeatureLayer 가 편집 세션(isChanged) 시작 시점의 링크 스냅샷 대비
 * 현재 currentJsonData 를 diff → 추가/수정 링크 id = editedGuids, 사라진 링크 id = deletedGuids.
 * (편집 중 타일 동기화가 동결되므로 currentJsonData 변화 = 편집 결과로 간주 가능.)
 */
interface NetworkEditState {
    /** 추가/수정된 링크 id (String) — 오버레이로 그림. */
    editedLinkIds: Set<string>;
    /** 삭제된 링크 id (String) — MVT 에서 마스킹. */
    deletedLinkIds: Set<string>;
    /** 편집 세션 결과를 통째로 설정(diff 계산 결과 반영). */
    setEdits: (edited: Set<string>, deleted: Set<string>) => void;
    /** 삭제된 링크 id 누적(삭제 조작 지점에서 호출 — MVT 마스킹 대상). */
    addDeleted: (ids: (string | number)[]) => void;
    /** 저장/리로드 시 초기화. */
    clear: () => void;
}

export const useNetworkEditStore = create<NetworkEditState>()(
    subscribeWithSelector((set) => ({
        editedLinkIds: new Set<string>(),
        deletedLinkIds: new Set<string>(),
        setEdits: (edited, deleted) => set({ editedLinkIds: edited, deletedLinkIds: deleted }),
        addDeleted: (ids) => set((s) => {
            const next = new Set(s.deletedLinkIds);
            for (const id of ids) next.add(String(id));
            // 삭제된 링크는 편집(추가/수정) 대상에서 제외
            const edited = new Set(s.editedLinkIds);
            for (const id of ids) edited.delete(String(id));
            return { deletedLinkIds: next, editedLinkIds: edited };
        }),
        clear: () => set({ editedLinkIds: new Set<string>(), deletedLinkIds: new Set<string>() }),
    })),
);
