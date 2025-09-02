import {create} from 'zustand';

export interface Timeline {
    startTime: string;
    endTime: string;
    activeTurns: number[];
    signalState: "green" | "yellow" | "red";
}

export interface SignalTimelineResponse {
    nodeId: string;
    signalTimeline: Timeline[];
    turnInfo: { id: number; connList: string[] }[];
}

export interface SignalState {
    signalTimeline: SignalTimelineResponse[];
    setSignalTimeline: (timeline: SignalTimelineResponse[]) => void;
}

export const useSignalTimelineStore = create<SignalState>(((set) => ({
    setSignalTimeline: (state : SignalState) => set({ signalTimeline: state }),
})));
