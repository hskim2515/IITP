import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface PropertyState {
    selectedProps: Record<string, string | number | unknown> | null;
    setSelectedProps: (panel: Record<string, string | number | unknown> | null) => void;
}

// subscribeWithSelector: NetworkFeatureLayer 가 selectedProps 만 셀렉터 구독해 선택 하이라이트 재렌더.
export const usePropertyStore = create<PropertyState>()(
    subscribeWithSelector((set) => ({
        selectedProps: null,
        setSelectedProps: (props) => set({ selectedProps: props }),
    })),
);
