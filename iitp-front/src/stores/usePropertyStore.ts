import { create } from "zustand";

interface PropertyState {
    selectedProps: string | null;
    setSelectedProps: (panel: string | null) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
    selectedProps: null,
    setSelectedProps: (props) => set({ selectedProps: props }),
}));
