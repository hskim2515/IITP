import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";

export type BaseMapType = 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight' | string | undefined;
export type MapViewMode = '2D' | '3D' | 'split';

interface State {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    currentBaseMap: BaseMapType;
    mapViewMode: MapViewMode;
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setCurrentBaseMap: (baseMap: BaseMapType) => void;
    setMapViewMode: (mode: MapViewMode) => void;
}

const initialState: State = {
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    currentBaseMap: undefined,
    mapViewMode: 'split',
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
            setMapViewMode: (mode: MapViewMode) => set({mapViewMode: mode}),
        })
    )
);