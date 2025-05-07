import { create } from "zustand";

interface UseMapState {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    currentBaseMap: 'osm' | 'satellite' | 'hybrid' | 'base';
    setCurrentBaseMap: (baseMap: string | null) => void;
}

export const useMapStore = create<UseMapState>((set) => ({
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    currentBaseMap: 'osm',
    setCesiumSyncing: (syncing: boolean) => set({ isCesiumSyncingState: syncing, isOLSyncingState: !syncing }),
    setOLSyncing: (syncing: boolean) => set({ isCesiumSyncingState: !syncing, isOLSyncingState: syncing }),
    setCurrentBaseMap: (baseMap:string) => set({ currentBaseMap: baseMap }),
}));