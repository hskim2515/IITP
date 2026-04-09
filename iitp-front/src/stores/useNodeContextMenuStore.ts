import { create } from 'zustand';

interface NodeContextMenuState {
    visible: boolean;
    screenX: number;
    screenY: number;
    nodeId: number | string | null;
    show: (screenX: number, screenY: number, nodeId: number | string) => void;
    hide: () => void;
}

export const useNodeContextMenuStore = create<NodeContextMenuState>((set) => ({
    visible: false,
    screenX: 0,
    screenY: 0,
    nodeId: null,
    show: (screenX, screenY, nodeId) => set({ visible: true, screenX, screenY, nodeId }),
    hide: () => set({ visible: false, nodeId: null }),
}));
