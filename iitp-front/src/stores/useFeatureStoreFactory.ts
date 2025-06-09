import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { createSelectors } from './createSelectors';
import { FetchFeatureDataType } from "@type/FeatureOptions";

export interface FeatureStoreFactoryType {
    getState: () => State & Actions;
    setState: (partial: Partial<State & Actions>, replace?: boolean) => void;
    subscribe: (listener: (state: State & Actions) => void) => () => void;
}

export interface State {
    // fetch 한 data
    originData: FetchFeatureDataType | undefined
    // fetch data 기반, 화면에 띄울 geojson 데이터
    currentGeojson: Record<string, unknown> | undefined
    // fetch data 기반, flatRow로 변환한 데이터
    flatRow: Record<string, unknown>[]
}

export interface Actions {
    setOriginData: (data: FetchFeatureDataType) => void;
    setCurrentGeojson: (currentGeoJson: Record<string, unknown>) => void;
    setFlatRow: (flatRow: Record<string, unknown>[]) => void; // flatRow로 변환하는 로직은 Grid를 호출하는 컴포넌트에서 진행하도록 하자.
    isChanged: () => boolean; // originData.geojson과 currentGeojson 비교
    initCurrentData: () => void; // originData의 geojson으로 rollback
}

const initialState: State = {
    originData: undefined,
    currentGeojson: undefined,
    flatRow: [],
};

const createFeatureStore = () =>
    createSelectors(
        create<State & Actions>(
            combine(initialState, (set, get) => ({
                setOriginData: (data: FetchFeatureDataType) => set({ originData: data }),
                setCurrentGeojson: (geojson: Record<string, unknown>) => {
                    set({currentGeojson: { ...geojson}})
                },
                setFlatRow: (flatRow: Record<string, unknown>[]) => set({ flatRow: flatRow }),
                isChanged: () => {
                    const { originData, currentGeojson } = get();
                    return JSON.stringify(originData?.geojson) !== JSON.stringify(currentGeojson);
                },
                initCurrentData: () => {
                    const origin = get().originData?.geojson;
                    if (origin) set({ currentGeojson: origin });
                }
            }))
        )
    );

export default createFeatureStore;
