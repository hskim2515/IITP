import { create } from "zustand";

interface PropertyState {
    selectedProps: Record<string, string | number | unknown> | null;
    setSelectedProps: (panel: Record<string, string | number | unknown> | null) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
    selectedProps: null,
    setSelectedProps: (props) => set({ selectedProps: props }),
}));
