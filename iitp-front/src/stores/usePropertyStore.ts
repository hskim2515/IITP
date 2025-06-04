import { create } from "zustand";

interface PropertyState {
    selectedProps: string | null;
    setProperty: (panel: string | null) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
    selectedProps: null,
    setProperty: (props) => set({ selectedProps: props }),
}));
