import {create} from 'zustand';

interface SignalState {
    signalTimeline: object,
    setSignalTimeline: (signalTimeline: object) => void;
}

export const useSignalStore = create<SignalState>(((set) => ({
    setSignalTimeline: (state : SignalState) => set({ signalTimeline: state }),
})));
