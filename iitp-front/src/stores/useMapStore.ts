import { create } from "zustand";

interface UseMapState {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
}

export const useMapStore = create<UseMapState>((set) => ({
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    setCesiumSyncing: (syncing: boolean) => set({ isCesiumSyncingState: syncing, isOLSyncingState: !syncing }),
    setOLSyncing: (syncing: boolean) => set({ isCesiumSyncingState: !syncing, isOLSyncingState: syncing }),
}));