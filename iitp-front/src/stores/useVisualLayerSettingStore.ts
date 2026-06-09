import { create } from 'zustand';
import { createSelectors } from "@stores/createSelectors";
import { combine, devtools } from "zustand/middleware";

interface State {
    guidewayColor: string;
    traceVehicleColor: string;
}

interface Actions {
    setGuidewayColor: (color: string) => void;
    setTraceVehicleColor: (color: string) => void;
}

const initialState: State = {
    guidewayColor: "#00e5ff",
    traceVehicleColor: "#00e5ff",
};

export const useVisualLayerSettingStore = createSelectors(create<State & Actions>(
    devtools(
        combine(
            initialState, (set) => ({
                setGuidewayColor: (guidewayColor: string) => set({ guidewayColor }),
                setTraceVehicleColor: (traceVehicleColor: string) => set({ traceVehicleColor }),
            })
        ),
    )
));
