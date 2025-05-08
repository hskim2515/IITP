import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface State {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    currentBaseMap: 'osm' | 'satellite' | 'hybrid' | 'base';
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setCurrentBaseMap: (baseMap: string | null) => void;
}

const initialState: State = {
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    currentBaseMap: 'osm',
}

export const useMapStore = createSelectors(create<State & Actions>(
    subscribeWithSelector(
        immer(
            combine(initialState,(set) => ({
                    setCesiumSyncing: (syncing: boolean) => set({ isCesiumSyncingState: syncing, isOLSyncingState: !syncing }),
                    setOLSyncing: (syncing: boolean) => set({ isCesiumSyncingState: !syncing, isOLSyncingState: syncing }),
                    setCurrentBaseMap: (baseMap: string) => set({ currentBaseMap: baseMap }),
                })
            )
        )
    )
));