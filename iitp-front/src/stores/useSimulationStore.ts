import { create } from "zustand";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@stores/createSelectors";

interface State {
    isRunning: boolean;
    isStop: boolean;
    speed: number;
}

interface Actions {
    start: () => void;
    pause: () => void;
    stop: () => void;
    setSpeed: (speed: number) => void;
}

const initialState: State = {
    isRunning: false,
    isStop: false,
    speed: 1,        // 기본 1×
};

export const useSimulationStore = createSelectors(create<State & Actions>(
    subscribeWithSelector(
        immer(
            combine(initialState, (set /* get */) => ({
                /** 재생 → draft 직접 변이 */
                start: () => set((state) => {
                    state.isRunning = true;
                    state.isStop = false;
                }),
                pause: () => set((state) => {
                    state.isRunning = false;
                }),
                stop: () => set((state) => {
                    state.isRunning = false;
                    state.isStop = true;
                    state.speed = 1;
                }),
                setSpeed: (speed) => set((state) => {
                    state.speed = speed;
                }),
            }))
        )
    ))
);