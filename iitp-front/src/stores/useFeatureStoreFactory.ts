import { create } from 'zustand';
import { combine, subscribeWithSelector } from 'zustand/middleware';
import { createSelectors } from './createSelectors';
import { FetchFeatureDataType } from "@type/FeatureOptions";

export interface FeatureStoreFactoryType {
    getState: () => State & Actions;
    setState: (partial: Partial<State & Actions>, replace?: boolean) => void;
}

export interface State {
    // fetch 한 data
    originData: FetchFeatureDataType | undefined
    // fetch data 기반, 화면에 띄울 geojson 데이터
    currentGeojson: Record<string, unknown> | undefined
    // fetch data 기반, flatRow로 변환한 데이터
    flatRow: Record<string, unknown>[]
    // 변경 확인
    isChanged: boolean
}

export interface Actions {
    setOriginData: (data: FetchFeatureDataType) => void;
    setCurrentGeojson: (currentGeoJson: Record<string, unknown>) => void;
    setFlatRow: (flatRow: Record<string, unknown>[]) => void;
    setChange: () => boolean;
    initCurrentData: () => void;
}

const initialState: State = {
    originData: undefined,
    currentGeojson: undefined,
    flatRow: [],
    isChanged: false
};

const createFeatureStore = () =>
    createSelectors(
        create<State & Actions>(
            subscribeWithSelector(
                combine(initialState, (set, get) => ({
                    setOriginData: (data: FetchFeatureDataType) => set({ originData: data }),
                    setCurrentGeojson: (geojson: Record<string, unknown>) => {
                        set({ currentGeojson: { ...geojson } })
                    },
                    setFlatRow: (flatRow: Record<string, unknown>[]) => set({ flatRow: flatRow }),
                    setChange: (changed: boolean) => set({ isChanged: changed}),
                    initCurrentData: () => {
                        const origin = get().originData?.geojson;
                        if (origin) set({ currentGeojson: origin });
                    }
                }))
            ))
    );

export default createFeatureStore;
