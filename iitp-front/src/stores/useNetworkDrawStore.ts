import { create } from 'zustand';
import { Coordinates } from '@type/Network';

interface NetworkDrawState {
    isActive: boolean;
    isConnectionActive: boolean;
    isSelectActive: boolean;
    laneCount: number;
    linkWidth: number;
    maxSpd: number;
    isBidirectional: boolean;
    // 현재 그리기 시작점 (스냅된 노드 ID 또는 null)
    startNodeId: number | string | null;
    startNodeCoord: Coordinates | null;
    // 교차로 편집 모드: 선택된 노드 ID
    connSelectedNodeId: number | string | null;
    // 교차로로 지정된 노드 ID 목록 (자동 connection 생성 대상)
    intersectionNodeIds: string[];
    // 그리기 리셋 트리거: 이 값이 바뀌면 draw effect가 재실행되어 refs 초기화
    drawResetKey: number;
    // 교차로 지정 후 draw effect가 시작점을 자동 설정할 노드 ID
    pendingStartNodeId: string | null;
    // 선택 모드: 단일 선택 (편집 핸들용)
    selectedLinkId: number | string | null;
    selectedNodeId: number | string | null;
    // 멀티셀렉트 (Shift+클릭, 박스 드래그)
    selectedLinkIds: string[];
    selectedNodeIds: string[];

    setActive: (active: boolean) => void;
    setConnectionActive: (active: boolean) => void;
    setSelectActive: (active: boolean) => void;
    setLaneCount: (count: number) => void;
    setLinkWidth: (width: number) => void;
    setMaxSpd: (spd: number) => void;
    setBidirectional: (v: boolean) => void;
    setStartNode: (id: number | string | null, coord: Coordinates | null) => void;
    setConnSelectedNodeId: (id: number | string | null) => void;
    addIntersectionNode: (id: number | string) => void;
    activateAndReset: (startNodeId?: string) => void;
    clearPendingStart: () => void;
    setSelectedLink: (id: number | string | null) => void;
    setSelectedNode: (id: number | string | null) => void;
    clearSelection: () => void;
    toggleSelectedLinkId: (id: string) => void;
    toggleSelectedNodeId: (id: string) => void;
    setSelectedLinkIds: (ids: string[]) => void;
    setSelectedNodeIds: (ids: string[]) => void;
    clearMultiSelection: () => void;
    reset: () => void;
}

export const useNetworkDrawStore = create<NetworkDrawState>((set) => ({
    isActive: false,
    isConnectionActive: false,
    isSelectActive: false,
    laneCount: 2,
    linkWidth: 7.0,
    maxSpd: 50,
    isBidirectional: false,
    startNodeId: null,
    startNodeCoord: null,
    connSelectedNodeId: null,
    intersectionNodeIds: [],
    drawResetKey: 0,
    pendingStartNodeId: null,
    selectedLinkId: null,
    selectedNodeId: null,
    selectedLinkIds: [],
    selectedNodeIds: [],

    setActive: (active) => set({ isActive: active, isConnectionActive: false, isSelectActive: false }),
    setConnectionActive: (active) => set({ isConnectionActive: active, isActive: false, isSelectActive: false, connSelectedNodeId: null }),
    setSelectActive: (active) => set({ isSelectActive: active, isActive: false, isConnectionActive: false, selectedLinkId: null, selectedNodeId: null }),
    setLaneCount: (count) => set({ laneCount: count }),
    setLinkWidth: (width) => set({ linkWidth: width }),
    setMaxSpd: (spd) => set({ maxSpd: spd }),
    setBidirectional: (v) => set({ isBidirectional: v }),
    setStartNode: (id, coord) => set({ startNodeId: id, startNodeCoord: coord }),
    setConnSelectedNodeId: (id) => set({ connSelectedNodeId: id }),
    addIntersectionNode: (id) => set((s) => ({
        intersectionNodeIds: s.intersectionNodeIds.includes(String(id))
            ? s.intersectionNodeIds
            : [...s.intersectionNodeIds, String(id)],
    })),
    activateAndReset: (startNodeId?) => set((s) => ({
        isActive: true,
        isConnectionActive: false,
        drawResetKey: s.drawResetKey + 1,
        pendingStartNodeId: startNodeId ?? null,
    })),
    clearPendingStart: () => set({ pendingStartNodeId: null }),
    setSelectedLink: (id) => set({ selectedLinkId: id, selectedNodeId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    setSelectedNode: (id) => set({ selectedNodeId: id, selectedLinkId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    clearSelection: () => set({ selectedLinkId: null, selectedNodeId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    toggleSelectedLinkId: (id) => set(s => ({
        selectedLinkId: null, selectedNodeId: null,
        selectedLinkIds: s.selectedLinkIds.includes(id)
            ? s.selectedLinkIds.filter(x => x !== id)
            : [...s.selectedLinkIds, id],
        selectedNodeIds: [],
    })),
    toggleSelectedNodeId: (id) => set(s => ({
        selectedLinkId: null, selectedNodeId: null,
        selectedNodeIds: s.selectedNodeIds.includes(id)
            ? s.selectedNodeIds.filter(x => x !== id)
            : [...s.selectedNodeIds, id],
        selectedLinkIds: [],
    })),
    setSelectedLinkIds: (ids) => set({ selectedLinkIds: ids, selectedNodeIds: [], selectedLinkId: null, selectedNodeId: null }),
    setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids, selectedLinkIds: [], selectedLinkId: null, selectedNodeId: null }),
    clearMultiSelection: () => set({ selectedLinkIds: [], selectedNodeIds: [] }),
    reset: () => set({ isActive: false, isConnectionActive: false, isSelectActive: false, startNodeId: null, startNodeCoord: null, connSelectedNodeId: null, selectedLinkId: null, selectedNodeId: null, selectedLinkIds: [], selectedNodeIds: [] }),
}));
