import {create} from 'zustand';

interface VehicleState {
    numVehicle: number,
    speedFactor: number,
    czml: object,
    vehicleData : object,
    vehicleRoute : object,
    setNumVehicle: (num: number) => void;
    setSpeedFactor: (speed: number) => void;
    setCzml: (czml: object) => void;
    setVehicleData: (vehicleData: object) => void;
    setVehicleRoute: (vehicleRoute: object) => void;
}

export const useVehicleStore = create<VehicleState>((set) => ({
    numVehicle: 3000,
    speedFactor: 30,
    czml: '',
    vehicleData : '',
    vehicleRoute : '',
    setNumVehicle: (num) => set({ numVehicle: num }),
    setSpeedFactor: (factor: any) => set({ speedFactor: factor }),
    setCzml: (factor: any) => set({ czml: factor }),
    setVehicleData: (factor: any) => set({ vehicleData: factor }),
    setVehicleRoute: (factor: any) => set({ vehicleRoute: factor }),
}));
