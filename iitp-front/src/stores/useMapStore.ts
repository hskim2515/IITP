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
    /** 편집모드에서 로드뷰를 표시할지 — 기본 꺼짐(사용자가 명시적으로 켜야 나타남). */
    roadviewEnabledInEdit: boolean;
    /** true인 동안은 배경지도가 앱 테마를 따라간다(다크="midnight"/라이트="white") — 사용자가
     *  배경지도를 한 번도 명시적으로 고른 적 없을 때만 유지된다. BaseMap.tsx에서 사용자가
     *  직접 배경지도를 클릭하면 false로 내려가고, 그 뒤로는 테마 토글이 배경지도를 건드리지
     *  않는다. useBaseMapThemeSync.ts(앱 루트에서 상시 구독)가 이 값을 보고 실시간으로
     *  반응한다 — 예전엔 이 로직이 BaseMap.tsx(레이어 설정 팝업을 열어야만 마운트됨) 안에만
     *  있어서 "지도 탭을 열어야만 테마 전환이 반영되는" 버그가 있었다. */
    baseMapFollowsTheme: boolean;
}

interface Actions {
    setCesiumSyncing: (syncing: boolean) => void;
    setOLSyncing: (syncing: boolean) => void;
    setPanoramaActive: (active: boolean) => void;
    setRoadviewEnabledInEdit: (enabled: boolean) => void;
    setCurrentBaseMap: (baseMap: BaseMapType) => void;
    setBaseMapFollowsTheme: (follows: boolean) => void;
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
    roadviewEnabledInEdit: false,
    baseMapFollowsTheme: true,
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
            setRoadviewEnabledInEdit: (enabled: boolean) => set({ roadviewEnabledInEdit: enabled }),
            setCurrentBaseMap: (baseMap: BaseMapType) => set({currentBaseMap: baseMap}),
            setBaseMapFollowsTheme: (follows: boolean) => set({baseMapFollowsTheme: follows}),
            setMapViewMode: (mode: MapViewMode) => set({mapViewMode: mode}),
            startCoordPick: (cb) => set({ coordPickCallback: cb }),
            cancelCoordPick: () => set({ coordPickCallback: null }),
        })
    )
);