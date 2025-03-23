import { create } from "zustand";

interface SimulationState {
    isRunning: boolean;
    isStop: boolean;
    speed: number;
    start: () => void;
    pause: () => void;
    stop: () => void;
    setSpeed: (speed: number) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
    isRunning: false,
    speed: 1, // 기본 배속 1x
    isStop:false,
    start: () => set({ isRunning: true, isStop: false}),
    pause: () => set({ isRunning: false }),
    stop: () => set({ isRunning: false, isStop: true, speed: 1 }), // 정지 시 배속 초기화
    setSpeed: (speed) => set({ speed }),
}));
