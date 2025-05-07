import { create } from 'zustand';

interface HeatmapSettingState {
    colors: string[];
    exaggeration: number;
    setColors: (colors: string[]) => void;
    setExaggeration: (value: number) => void;
}

export const useHeatmapSettingStore = create<HeatmapSettingState>((set) => ({
    colors: ["#0000FF", "#00FF00", "#FFFF00", "#FF0000"],
    exaggeration: 1,
    setColors: (colors) => set({ colors }),
    setExaggeration: (value) => set({ exaggeration: value }),
}));
