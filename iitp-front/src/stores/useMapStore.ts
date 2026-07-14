import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";

export type BaseMapType = 'osm' | 'satellite' | 'hybrid' | 'base' | 'midnight' | string | undefined;
export type MapViewMode = '2D' | '3D' | 'split';

interface State {
    isCesiumSyncingState: boolean;
    isOLSyncingState: boolean;
    currentBaseMap: BaseMapType;
    mapViewMode: MapViewMode;
    coordPickCallback: ((lat: number, lng: number) => void) | null;
    /** 네이버 파노라마(로드뷰) 표시 중 — Cesium 캔버스를 덮으므로 Cesium→OL 동기화 차단용 */
    panoramaActive: boolean;
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setPanoramaActive: (active: boolean) => void;
    setCurrentBaseMap: (baseMap: BaseMapType) => void;
    setMapViewMode: (mode: MapViewMode) => void;
    startCoordPick: (cb: (lat: number, lng: number) => void) => void;
    cancelCoordPick: () => void;
}

const initialState: State = {
    isCesiumSyncingState: false,
    isOLSyncingState: false,
    currentBaseMap: undefined,
    mapViewMode: 'split',
    coordPickCallback: null,
    panoramaActive: false,
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
            setPanoramaActive: (active: boolean) => set({ panoramaActive: active }),
            setCurrentBaseMap: (baseMap: BaseMapType) => set({currentBaseMap: baseMap}),
            setMapViewMode: (mode: MapViewMode) => set({mapViewMode: mode}),
            startCoordPick: (cb) => set({ coordPickCallback: cb }),
            cancelCoordPick: () => set({ coordPickCallback: null }),
        })
    )
);