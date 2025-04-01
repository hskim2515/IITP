import { create } from "zustand";
import Map from "ol/Map";
import {View} from "ol";
import {Layer} from "ol/layer";

interface MapState {
    map: Map | null;
    view: View | null;
    currentLayer: Layer | 'OSM';
    extent: object | null;
    setMap: (map: Map | null) => void;
    setView: (view: View | null) => void;
    setExtent: (extent: object | null) => void;
    setCurrentLayer: (layer: Layer | null) => void;

}

export const useOpenLayersStore = create<MapState>((set) => ({
    map: null,
    view: null,
    currentLayer: null,
    extends: null,
    setMap: (map) => set({ map }),
    setView: (view) => set({ view }),
    setExtent: (extent) => set({ extent }),
    setCurrentLayer: (layer) => set({ currentLayer: layer }),
}));
