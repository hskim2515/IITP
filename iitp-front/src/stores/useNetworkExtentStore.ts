import { create } from "zustand";

interface State {
    /** 네트워크 전체 범위(가로/세로 중 큰 쪽, m). 시나리오/버전 로드 시 useLayerInit.ts가 채운다.
     *  차량 줌 티어(VEHICLE_ZOOM_TIER_PX_M) 임계값을 실제 네트워크 크기에 비례해 보정하는 데 쓴다
     *  (viewportMetrics.ts의 normalizePixelSizeM) — 부천 규모(수 km)든 광역(수십km)든 같은 상대적
     *  줌 단계에서 개별/flow/히트맵/OD가 전환되게 하기 위함. 아직 안 채워졌으면 null(보정 생략).
     */
    extentM: number | null;
}
interface Actions {
    setExtentM: (v: number | null) => void;
}

export const useNetworkExtentStore = create<State & Actions>((set) => ({
    extentM: null,
    setExtentM: (extentM) => set({ extentM }),
}));
