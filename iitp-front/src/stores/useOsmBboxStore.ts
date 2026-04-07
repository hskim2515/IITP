import { create } from 'zustand';

export interface OsmBbox {
    south: number;
    west: number;
    north: number;
    east: number;
}

interface OsmBboxState {
    selecting: boolean;
    bbox: OsmBbox | null;
    setSelecting: (v: boolean) => void;
    setBbox: (bbox: OsmBbox | null) => void;
}

export const useOsmBboxStore = create<OsmBboxState>((set) => ({
    selecting: false,
    bbox: null,
    setSelecting: (selecting) => set({ selecting }),
    setBbox: (bbox) => set({ bbox, selecting: false }),
}));
