import { create } from "zustand";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@stores/createSelectors";
import { JulianDate } from "cesium"; // 필요한 경우

interface State {
    isRunning: boolean;
    isStop: boolean;
    speed: number;

    // ⏱️ CZML Clock 관련 상태
    startTime?: JulianDate;
    endTime?: JulianDate;
    currentTime?: JulianDate;
}

interface Actions {
    start: () => void;
    pause: () => void;
    stop: () => void;
    setSpeed: (speed: number) => void;

    // ⏱️ Clock 정보 설정
    setClock: (start: JulianDate, end: JulianDate, current: JulianDate) => void;
    setCurrentTime: (current: JulianDate) => void;
}

const initialState: State = {
    isRunning: false,
    isStop: false,
    speed: 1,
    startTime: undefined,
    endTime: undefined,
    currentTime: undefined,
};

export const useSimulationStore = createSelectors(
    create<State & Actions>()(
        subscribeWithSelector(
            immer(
                combine(initialState, (set) => ({
                    start: () =>
                        set((state) => {
                            state.isRunning = true;
                            state.isStop = false;
                        }),
                    pause: () =>
                        set((state) => {
                            state.isRunning = false;
                        }),
                    stop: () =>
                        set((state) => {
                            state.isRunning = false;
                            state.isStop = true;
                            state.speed = 1;
                        }),
                    setSpeed: (speed) =>
                        set((state) => {
                            state.speed = speed;
                        }),

                    // Clock 상태 설정
                    setClock: (start, end, current) =>
                        set((state) => {
                            state.startTime = start;
                            state.endTime = end;
                            state.currentTime = current;
                        }),
                    setCurrentTime: (current) =>
                        set((state) => {
                            state.currentTime = current;
                        }),
                }))
            )
        )
    )
);
