import { create } from "zustand";

/**
 * 앱 전역 모드: 보기(view) / 편집(edit). 흩어져 있던 편집 판정(useNetworkDrawStore 플래그,
 * showTools 등)의 상위 단일 진실 소스.
 *
 * - view: 읽기 전용 탐색(로드뷰는 네이버 배경 선택 시). 편집 툴 비활성.
 * - edit: 네트워크 편집. 3D 영역은 항상 로드뷰(참조), 2D 는 편집 대상(배경지도 변경 가능).
 */
export type AppMode = "view" | "edit";

interface ModeState {
    appMode: AppMode;
    setAppMode: (mode: AppMode) => void;
    toggleAppMode: () => void;
}

export const useModeStore = create<ModeState>((set) => ({
    appMode: "view",
    setAppMode: (mode) => set({ appMode: mode }),
    toggleAppMode: () => set((s) => ({ appMode: s.appMode === "view" ? "edit" : "view" })),
}));
