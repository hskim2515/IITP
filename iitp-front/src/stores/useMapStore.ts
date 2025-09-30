import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";

export type BaseMapType = 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight' | string | undefined;

interface State {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    currentBaseMap: BaseMapType;
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setCurrentBaseMap: (baseMap: BaseMapType) => void;
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
            setCurrentBaseMap: (baseMap: BaseMapType) => set({currentBaseMap: baseMap}),
        })
    )
);