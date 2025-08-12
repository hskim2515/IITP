import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";
import { LayerManager } from "../managers/LayerManager";

interface State {
    activeLayerName: Array<string> | null; // heatmap, trip
    activeLayerGroupName: Array<string> | null; // 배경지도, 분석, 시설물

    layerManager: LayerManager | null;
}

interface Actions {
    setActiveLayerName: (state: Array<string> | null) => void;
    addActiveLayerName: (layerName: string) => void;
    removeActiveLayerName: (layerName: string) => void;
    toggleActiveLayerName: (layerName: string) => void;

    setActiveLayerGroupName: (state: Array<string> | null) => void;
    addActiveLayerGroupName: (groupName: string) => void;
    removeActiveLayerGroupName: (groupName: string) => void;
    toggleActiveLayerGroupName: (groupName: string) => void;

    setLayerManager: (state: LayerManager | null) => void;
}

const initialState: State = {
    activeLayerName: [],
    activeLayerGroupName: null,
    layerManager: null,
}

export const useLayerStore = createSelectors(
    create<State & Actions>(
        (set, get) => ({
            ...initialState,
            setActiveLayerName: (state) => set({activeLayerName: state}),
            addActiveLayerName: (layerName) => {
                const current = get().activeLayerName ?? [];
                if (!current.includes(layerName)) {
                    set({activeLayerName: [...current, layerName]});
                }
            },
            removeActiveLayerName: (layerName) => {
                const current = get().activeLayerName ?? [];
                set({activeLayerName: current.filter(name => name !== layerName)});
            },
            toggleActiveLayerName: (layerName) => {
                const current = get().activeLayerName ?? [];
                if (current.includes(layerName)) {
                    set({activeLayerName: current.filter(name => name !== layerName)});
                } else {
                    set({activeLayerName: [...current, layerName]});
                }
            },

            setActiveLayerGroupName: (state) => set({activeLayerGroupName: state}),
            addActiveLayerGroupName: (groupName) => {
                const current = get().activeLayerGroupName ?? [];
                if (!current.includes(groupName)) {
                    set({activeLayerGroupName: [...current, groupName]});
                }
            },
            removeActiveLayerGroupName: (groupName) => {
                const current = get().activeLayerGroupName ?? [];
                set({activeLayerGroupName: current.filter(name => name !== groupName)});
            },
            toggleActiveLayerGroupName: (groupName) => {
                const current = get().activeLayerGroupName ?? [];
                if (current.includes(groupName)) {
                    set({activeLayerGroupName: current.filter(name => name !== groupName)});
                } else {
                    set({activeLayerGroupName: [...current, groupName]});
                }
            },

            setLayerManager: (state) => set({layerManager: state}),
        })
    )
);

