import { create } from "zustand";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

export type RouteDrawMode = 'none' | 'bus' | 'rail';
export type BusLineSet = 'busRoute' | 'busRouteWeekday' | 'busRouteWeekend';

export interface RouteDrawStop {
    guid: string;
    id: string | number;
    linkRef?: number | string;
}

interface State {
    mode: RouteDrawMode;
    draft: RouteDrawStop[];
    busLineSet: BusLineSet;
}

interface Actions {
    start: (mode: 'bus' | 'rail') => void;
    addStop: (stop: RouteDrawStop) => void;
    removeLast: () => void;
    reset: () => void;
    setBusLineSet: (key: BusLineSet) => void;
}

// "노선 그리기" — 정류장/역을 지도에서 순서대로 클릭해 버스/철도 노선을 그리는 모드.
// 도로망 배치모드(useNetworkDrawStore.placementMode)와 상호 배타적이라 start()에서
// 항상 그쪽을 'none'으로 리셋한다(반대 방향은 Facility.tsx의 배치 토글에서 처리).
export const useRouteDrawStore = create<State & Actions>((set, get) => ({
    mode: 'none',
    draft: [],
    busLineSet: 'busRoute',

    start: (mode) => {
        useNetworkDrawStore.getState().setPlacementMode('none');
        set({ mode, draft: [] });
    },

    addStop: (stop) => {
        const { draft } = get();
        if (draft.length > 0 && draft[draft.length - 1]!.guid === stop.guid) return; // 연속 중복 클릭 무시
        set({ draft: [...draft, stop] });
    },

    removeLast: () => set((s) => ({ draft: s.draft.slice(0, -1) })),

    reset: () => set({ mode: 'none', draft: [] }),

    setBusLineSet: (key) => set({ busLineSet: key }),
}));
