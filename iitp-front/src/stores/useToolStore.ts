import { create } from "zustand";

interface ToolState {
    showTools: boolean;
    toggleTools: () => void;
}

export const useToolStore = create<ToolState>((set) => ({
    showTools: false,
    toggleTools: () => set((state) => ({ showTools: !state.showTools })),
}));
