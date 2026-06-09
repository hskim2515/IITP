import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { createSelectors } from './createSelectors';

interface State {
    vehicle: {
        pointRadius: number;
        pointOpacity: number;
        highlightedType: string;
    };
    trip:    { trailLength: number };
    od:      { opacity: number };
    speed:   { opacity: number };
    dwellTime: {
        metric: 'dwell' | 'slowCount' | 'stopGo';
    };
    iconBubble: {
        vehicleType: 'ALL' | 'CAR' | 'TAXI' | 'BUS' | 'TRUCK' | 'MOTO';
    };
    intersectionPulse: {
        metric: 'incoming' | 'waiting' | 'outgoing';
    };
    flowBar: {
        metric: 'volume' | 'avgSpeed' | 'dwell';
    };
    vectorField: {
        showGlyphs: boolean;
        showParticles: boolean;
        glyphScale: number;
        glyphStep: number;
        particleOpacity: number;
        trailWidth: number;
        colors: string[];
    };
}

interface Actions {
    setVehicle: (s: Partial<State['vehicle']>) => void;
    setTrip:    (s: Partial<State['trip']>)    => void;
    setOd:      (s: Partial<State['od']>)      => void;
    setSpeed:   (s: Partial<State['speed']>)   => void;
    setDwellTime: (s: Partial<State['dwellTime']>) => void;
    setIconBubble: (s: Partial<State['iconBubble']>) => void;
    setIntersectionPulse: (s: Partial<State['intersectionPulse']>) => void;
    setFlowBar: (s: Partial<State['flowBar']>) => void;
    setVectorField: (s: Partial<State['vectorField']>) => void;
}

const initial: State = {
    vehicle: { pointRadius: 4, pointOpacity: 0.9, highlightedType: 'ALL' },
    trip:    { trailLength: 50 },
    od:      { opacity: 0.7 },
    speed:   { opacity: 0.8 },
    dwellTime: { metric: 'dwell' },
    iconBubble: { vehicleType: 'ALL' },
    intersectionPulse: { metric: 'waiting' },
    flowBar: { metric: 'volume' },
    vectorField: {
        showGlyphs: false,
        showParticles: true,
        glyphScale: 1.1,
        glyphStep: 2,
        particleOpacity: 0.24,
        trailWidth: 2.0,
        colors: [ "#2d7bff", "#60cfff", "#b7efff", "#f5fdff" ],
    },
};

export const useAnalysisSettingStore = createSelectors(
    create(combine(initial, (set) => ({
        setVehicle: (s) => set((st) => ({ vehicle: { ...st.vehicle, ...s } })),
        setTrip:    (s) => set((st) => ({ trip:    { ...st.trip,    ...s } })),
        setOd:      (s) => set((st) => ({ od:      { ...st.od,      ...s } })),
        setSpeed:   (s) => set((st) => ({ speed:   { ...st.speed,   ...s } })),
        setDwellTime: (s) => set((st) => ({ dwellTime: { ...st.dwellTime, ...s } })),
        setIconBubble: (s) => set((st) => ({ iconBubble: { ...st.iconBubble, ...s } })),
        setIntersectionPulse: (s) => set((st) => ({ intersectionPulse: { ...st.intersectionPulse, ...s } })),
        setFlowBar: (s) => set((st) => ({ flowBar: { ...st.flowBar, ...s } })),
        setVectorField: (s) => set((st) => ({ vectorField: { ...st.vectorField, ...s } })),
    })))
);
