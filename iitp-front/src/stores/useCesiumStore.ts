import { create } from "zustand";
import { Viewer } from "cesium";
import { createSelectors } from "@stores/createSelectors";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface State {
    viewer: Viewer | null;
}

interface Actions {
    setViewer: (viewer: Viewer | null) => void;
}

const initialState: State = {
    viewer: null
}

export const useCesiumStore = createSelectors(create<State & Actions>(
        subscribeWithSelector(
            immer(
                combine(initialState, (set) => ({
                        setViewer: (viewer) => set({ viewer }),
                    })
                )
            )
        )
    )
);