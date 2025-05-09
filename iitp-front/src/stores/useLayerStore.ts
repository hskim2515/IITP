import { create } from "zustand";
import { combine, devtools, subscribeWithSelector } from "zustand/middleware";
import { createSelectors } from "@stores/createSelectors";
import { immer } from "zustand/middleware/immer";
import OlLayerManager from "@features/managers/OlLayerManager";
import {LayerManager} from "../managers/LayerManager";

interface State {
    activeLayerName: Array<string> | null; // heatmap, trip
    activeLayerGroupName: Array<string> | null; // 배경지도, 분석, 시설물

    layerManager: LayerManager | null;
    olLayerManager: OlLayerManager | null;
}

interface Actions {
    setActiveLayerName: (state: Array<string> | null) => void;
    setActiveLayerGroupName: (state: Array<string> | null) => void;

    setLayerManager: (state: LayerManager | null) => void;
    setOlLayerManager: (state: OlLayerManager | null) => void;

}

const initialState: State = {
    activeLayerName: [],
    activeLayerGroupName: null,

    layerManager: null,
    olLayerManager: null,
}

export const useLayerStore = createSelectors(create<State & Actions>(
        (
            subscribeWithSelector(
                immer(
                    combine(initialState, (set, get) => ({
                        setActiveLayerName: (state) => set({ activeLayerName: state }),
                        addActiveLayerName: (layerName) => {
                            const current = get().activeLayerName ?? [];
                            if (!current.includes(layerName)) {
                                set({ activeLayerName: [ ...current, layerName ] });
                            }
                        },
                        removeActiveLayerName: (layerName) => {
                            const current = get().activeLayerName ?? [];
                            set({ activeLayerName: current.filter(name => name !== layerName) });
                        },
                        toggleActiveLayerName: (layerName) => {
                            const current = get().activeLayerName ?? [];
                            if (current.includes(layerName)) {
                                set({ activeLayerName: current.filter(name => name !== layerName) });
                            } else {
                                set({ activeLayerName: [ ...current, layerName ] });
                            }
                        },

                        setActiveLayerGroupName: (state) => set({ activeLayerGroupName: state }),
                        addActiveLayerGroupName: (groupName) => {
                            const current = get().activeLayerGroupName ?? [];
                            if (!current.includes(groupName)) {
                                set({ activeLayerGroupName: [ ...current, groupName ] });
                            }
                        },
                        removeActiveLayerGroupName: (groupName) => {
                            const current = get().activeLayerGroupName ?? [];
                            set({ activeLayerGroupName: current.filter(name => name !== groupName) });
                        },
                        toggleActiveLayerGroupName: (groupName) => {
                            const current = get().activeLayerGroupName ?? [];
                            if (current.includes(groupName)) {
                                set({ activeLayerGroupName: current.filter(name => name !== groupName) });
                            } else {
                                set({ activeLayerGroupName: [ ...current, groupName ] });
                            }
                        },

                        setLayerManager: (state) => set({ layerManager: state }),
                        setOlLayerManager: (state) => set({ olLayerManager: state }),
                    }))
                )
            )
        )
    )
);

