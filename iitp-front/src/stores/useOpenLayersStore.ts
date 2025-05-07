import { create } from "zustand";
import Map from "ol/Map";
import {View} from "ol";

interface MapState {
    map: Map | null;
    view: View | null;
    extent: object | null;
    setMap: (map: Map | null) => void;
    setView: (view: View | null) => void;
    setExtent: (extent: object | null) => void;
}

export const useOpenLayersStore = create<MapState>((set) => ({
    map: null,
    view: null,
    extends: null,
    setMap: (map) => set({ map }),
    setView: (view) => set({ view }),
    setExtent: (extent) => set({ extent })
}));
