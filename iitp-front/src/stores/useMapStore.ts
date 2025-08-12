import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";

interface State {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    currentBaseMap: 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight';
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setCurrentBaseMap: (baseMap: 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight' | undefined) => void;
}

const initialState: State = {
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    currentBaseMap: 'osm',
}

export const useMapStore = createSelectors(
    create<State & Actions>(
        (set) => ({
            ...initialState,
            setCesiumSyncing: (syncing: boolean) => set({
                isCesiumSyncingState: syncing,
                isOLSyncingState: !syncing
            }),
            setOLSyncing: (syncing: boolean) => set({isCesiumSyncingState: !syncing, isOLSyncingState: syncing}),
            setCurrentBaseMap: (baseMap: 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight' | undefined) => set({currentBaseMap: baseMap}),
        })
    )
);