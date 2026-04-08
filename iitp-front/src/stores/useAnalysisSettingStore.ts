import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { createSelectors } from './createSelectors';

interface State {
    vehicle: { pointRadius: number; pointOpacity: number };
    trip:    { trailLength: number };
    od:      { opacity: number };
    speed:   { opacity: number };
}

interface Actions {
    setVehicle: (s: Partial<State['vehicle']>) => void;
    setTrip:    (s: Partial<State['trip']>)    => void;
    setOd:      (s: Partial<State['od']>)      => void;
    setSpeed:   (s: Partial<State['speed']>)   => void;
}

const initial: State = {
    vehicle: { pointRadius: 4, pointOpacity: 0.9 },
    trip:    { trailLength: 50 },
    od:      { opacity: 0.7 },
    speed:   { opacity: 0.8 },
};

export const useAnalysisSettingStore = createSelectors(
    create(combine(initial, (set) => ({
        setVehicle: (s) => set((st) => ({ vehicle: { ...st.vehicle, ...s } })),
        setTrip:    (s) => set((st) => ({ trip:    { ...st.trip,    ...s } })),
        setOd:      (s) => set((st) => ({ od:      { ...st.od,      ...s } })),
        setSpeed:   (s) => set((st) => ({ speed:   { ...st.speed,   ...s } })),
    })))
);
