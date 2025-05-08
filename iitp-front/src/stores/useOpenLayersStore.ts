import { create } from 'zustand';
import { combine, devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Extent } from 'ol/extent';
import { Map, View } from "ol";
import { createSelectors } from "@stores/createSelectors";

interface State {
    map: Map | null;
    view: View | null;
    extent: Extent | null;
}
interface Actions {
    setMap: (map: Map | null) => void;
    setView: (view: View | null) => void;
    setExtent: (extent: Extent | null) => void;
    reset: () => void;
}
const initialState: State = {
    map: null,
    view: null,
    extent: null,
}

export const useOpenLayersStore = createSelectors(create<State & Actions>(
    (
        subscribeWithSelector(
            immer(
                combine(initialState, (set) => ({
                        setMap: (map)   => set({ map }),
                        setView: (view) => set({ view }),
                        setExtent: (extent) => set({ extent }),
                        removeLayer: (key) => set((state) => { delete state.layers[key]; }),
                        reset: () => set(() => ({ ...initialState })),
                    })
                )
            )
        )
    )
));
