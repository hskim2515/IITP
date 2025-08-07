import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import type { Extent } from 'ol/extent';
import { Map, View } from "ol";
import { OLEventAdapter } from '@adaptor/OLEventAdapter';
import { EventManager } from '@managers/EventManager';
import { useEventStore } from './useEventStore';
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
    combine(initialState, (set) => ({
            setMap: (map) => {
                if (!map) return;
                const adapter = new OLEventAdapter(map);
                const manager = new EventManager(adapter);
                useEventStore.getState().setOlManager(manager);

                set({map});
            },
            setView: (view) => set({view}),
            setExtent: (extent) => set({extent}),
            reset: () => set(() => ({...initialState})),
        })
    ))
);