import { create } from 'zustand';

/** 편집 가이드 한 줄: keys(키/마우스 칩) + 설명. em=지금 해야 할 단계 강조 */
export interface GuideStep {
    keys?: string[];
    text: string;
    em?: boolean;
}

/** 편집 모드 상시 안내 패널 내용 (MessagePopup 토스트는 2초 후 사라져 조작법 안내에 부적합) */
export interface EditGuide {
    title: string;
    steps: GuideStep[];
    tip?: string;
}

interface EditGuideState {
    guide: EditGuide | null;
    setGuide: (g: EditGuide | null) => void;
    clear: () => void;
}

export const useEditGuideStore = create<EditGuideState>((set) => ({
    guide: null,
    setGuide: (g) => set({ guide: g }),
    clear: () => set({ guide: null }),
}));
