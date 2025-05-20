import {create} from 'zustand';
import { devtools } from "zustand/middleware";

interface VehicleState {
    numVehicle: number,
    speedFactor: number,
    czml: object,
    vehicleData : object,
    vehicleRoute : object,
    features: object,
    setNumVehicle: (num: number) => void;
    setSpeedFactor: (speed: number) => void;
    setCzml: (czml: object) => void;
    setVehicleData: (vehicleData: object) => void;
    setVehicleRoute: (vehicleRoute: object) => void;
    setFeatures: (features: object) => void;
}

export const useVehicleStore = create<VehicleState>(((set) => ({
    numVehicle: 10,
    speedFactor: 30,
    czml: '',
    vehicleData : '',
    vehicleRoute : '',
    features : '',
    setNumVehicle: (state : VehicleState) => set({ numVehicle: state }),
    setSpeedFactor: (state: VehicleState) => set({ speedFactor: state }),
    setCzml: (state: VehicleState) => set({ czml: state }),
    setVehicleData: (state: VehicleState) => set({ vehicleData: state }),
    setVehicleRoute: (state: VehicleState) => set({ vehicleRoute: state }),
    setFeatures: (state: VehicleState) => set({ features: state }),
})));
