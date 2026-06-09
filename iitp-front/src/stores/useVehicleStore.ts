import {create} from 'zustand';
import { devtools } from "zustand/middleware";

interface VehicleState {
    numVehicle: number,
    activeVehicleCount: number,
    speedFactor: number,
    czml: object,
    vehicleData : object,
    vehicleRoute : object,
    features: object,
    latestPositions: Array<number[] | null>,
    setNumVehicle: (num: number) => void;
    setActiveVehicleCount: (count: number) => void;
    setSpeedFactor: (speed: number) => void;
    setCzml: (czml: object) => void;
    setVehicleData: (vehicleData: object) => void;
    setVehicleRoute: (vehicleRoute: object) => void;
    setFeatures: (features: object) => void;
    setLatestPositions: (positions: Array<number[] | null>) => void;
}

export const useVehicleStore = create<VehicleState>(((set) => ({
    numVehicle: 10,
    activeVehicleCount: 0,
    speedFactor: 30,
    czml: '',
    vehicleData : '',
    vehicleRoute : '',
    features : '',
    latestPositions: [],
    setNumVehicle: (state : VehicleState) => set({ numVehicle: state }),
    setActiveVehicleCount: (count: number) => set({ activeVehicleCount: count }),
    setSpeedFactor: (state: VehicleState) => set({ speedFactor: state }),
    setCzml: (state: VehicleState) => set({ czml: state }),
    setVehicleData: (state: VehicleState) => set({ vehicleData: state }),
    setVehicleRoute: (state: VehicleState) => set({ vehicleRoute: state }),
    setFeatures: (state: VehicleState) => set({ features: state }),
    setLatestPositions: (positions) => set({ latestPositions: positions }),
})));
