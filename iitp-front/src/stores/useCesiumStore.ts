import { create } from "zustand";
import { Viewer } from "cesium";

interface CesiumState {
    viewer: Viewer | null;
    setViewer: (viewer: Viewer | null) => void;
}

export const useCesiumStore = create<CesiumState>((set) => ({
    viewer: null,
    setViewer: (viewer) => set({ viewer }),
}));