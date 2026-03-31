import { create } from 'zustand';
import { Coordinates } from '@type/Network';

interface NetworkDrawState {
    isActive: boolean;
    isConnectionActive: boolean;
    laneCount: number;
    linkWidth: number;
    maxSpd: number;
    isBidirectional: boolean;
    // 현재 그리기 시작점 (스냅된 노드 ID 또는 null)
    startNodeId: number | string | null;
    startNodeCoord: Coordinates | null;

    setActive: (active: boolean) => void;
    setConnectionActive: (active: boolean) => void;
    setLaneCount: (count: number) => void;
    setLinkWidth: (width: number) => void;
    setMaxSpd: (spd: number) => void;
    setBidirectional: (v: boolean) => void;
    setStartNode: (id: number | string | null, coord: Coordinates | null) => void;
    reset: () => void;
}

export const useNetworkDrawStore = create<NetworkDrawState>((set) => ({
    isActive: false,
    isConnectionActive: false,
    laneCount: 2,
    linkWidth: 7.0,
    maxSpd: 50,
    isBidirectional: false,
    startNodeId: null,
    startNodeCoord: null,

    setActive: (active) => set({ isActive: active, isConnectionActive: false }),
    setConnectionActive: (active) => set({ isConnectionActive: active, isActive: false }),
    setLaneCount: (count) => set({ laneCount: count }),
    setLinkWidth: (width) => set({ linkWidth: width }),
    setMaxSpd: (spd) => set({ maxSpd: spd }),
    setBidirectional: (v) => set({ isBidirectional: v }),
    setStartNode: (id, coord) => set({ startNodeId: id, startNodeCoord: coord }),
    reset: () => set({ isActive: false, isConnectionActive: false, startNodeId: null, startNodeCoord: null }),
}));
