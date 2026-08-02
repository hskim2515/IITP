import { create } from "zustand";
import axiosInstance from "@api/axiosInstance";
import { assignTileGuids } from "@utils/tileGuid";
import type { NetworkTilePayload } from "@managers/NetworkTileManager";

/**
 * NETWORK 편집 그리드 전용 전체 목록 스토어 (타일 모드).
 *
 * 타일 모드에서 useNetworkStore.currentJsonData 는 렌더/편집용 viewport working set 이라
 * (NetworkFeatureLayer.scheduleStoreSync 참고) 그리드 전체 목록의 원천으로 쓸 수 없다.
 * 이 스토어는 GET /network/{versionId}/grid 로 전체 links/nodes 를 별도 보관하며,
 * 렌더용 useNetworkStore 를 절대 덮어쓰지 않는다.
 *
 * guid 는 viewport 타일과 동일한 id 기반 규칙(assignTileGuids: T_L{id}/T_N{id})을 적용해
 * 그리드 선택 ↔ 지도 하이라이트가 같은 guid 로 매칭되게 한다.
 */
interface NetworkGridState {
    versionId: string | null;
    data: NetworkTilePayload | null;
    loading: boolean;
    error: string | null;
    loadedAt: number | null;
    /** 전체 그리드 목록 로드 (같은 versionId 로 이미 로드돼 있으면 스킵, force 로 강제 갱신) */
    load: (versionId: string, force?: boolean) => Promise<void>;
    /** 저장/임포트 후 무효화 — versionId 를 주면 해당 버전일 때만 비운다 */
    invalidate: (versionId?: string) => void;
}

export const useNetworkGridStore = create<NetworkGridState>()((set, get) => ({
    versionId: null,
    data: null,
    loading: false,
    error: null,
    loadedAt: null,

    load: async (versionId, force = false) => {
        const s = get();
        if (!force && s.versionId === versionId && s.data && !s.loading) return;
        if (s.loading && s.versionId === versionId && !force) return;
        set({ loading: true, error: null, versionId });
        try {
            const res = await axiosInstance.get(`/network/${versionId}/grid`);
            const payload = res?.data as NetworkTilePayload | null;
            if (!payload || !Array.isArray(payload.links) || !Array.isArray(payload.nodes)) {
                set({ data: null, loading: false, error: "빈 응답" });
                return;
            }
            assignTileGuids(payload);
            set({ data: payload, loading: false, error: null, loadedAt: Date.now() });
        } catch (e: any) {
            set({ loading: false, error: String(e?.message ?? e) });
        }
    },

    invalidate: (versionId) => {
        const s = get();
        if (versionId && s.versionId !== versionId) return;
        set({ data: null, loadedAt: null, error: null });
    },
}));
