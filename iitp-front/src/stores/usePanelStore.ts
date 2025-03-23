import { create } from "zustand";

interface PanelState {
    activePanel: string | null;
    setActivePanel: (panel: string | null) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
    activePanel: null,
    setActivePanel: (panel) => set({ activePanel: panel }),
}));
