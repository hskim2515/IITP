import axiosInstance from "@api/axiosInstance";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { NETWORK_TILING } from "@utils/lodConstants";
import { getActiveVersionId } from "@utils/versionId";

/**
 * 더미(신호/노면표시) 생성용 전체 네트워크 확보.
 *
 * 타일 모드에서는 store.currentJsonData 가 viewport 분뿐이고 near tier 링크는
 * 차선(cells)까지 stripped 되어 있어 생성에 쓰면 교차로 누락/0건 생성이 된다.
 * → 서버에서 전체 네트워크를 1회 임시로 받아 생성에만 쓰고 store 에는 넣지 않는다
 * (타일 모드 메모리 원칙 유지). 전체-로드 모드에서는 기존대로 store 데이터를 반환.
 */
export async function getNetworkForDummyGeneration(): Promise<any | null> {
    const tileMode = NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode;
    if (!tileMode) return useNetworkStore.getState().currentJsonData;

    const versionId = getActiveVersionId();
    if (!versionId) return null;
    try {
        const res = await axiosInstance.get(`/network/${versionId}`);
        return res.data;
    } catch (err) {
        console.warn("[getNetworkForDummyGeneration] 전체 네트워크 fetch 실패:", err);
        return null;
    }
}
