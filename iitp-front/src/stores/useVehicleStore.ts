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
    refetchTrigger: number,
    /** viewport 내 차량이 상한(3천대) 초과 — 개별 차량 대신 집계 히트맵 가시화로 전환 */
    denseViewport: boolean,
    setDenseViewport: (v: boolean) => void;
    /** viewport 스트리밍 차량 수 표시 (지도 배지): shown=표시 중, total=창 내 전체. null=비스트리밍 */
    viewportVehicleInfo: { shown: number; total: number; dense: boolean } | null,
    setViewportVehicleInfo: (info: { shown: number; total: number; dense: boolean } | null) => void;
    setNumVehicle: (num: number) => void;
    setActiveVehicleCount: (count: number) => void;
    setSpeedFactor: (speed: number) => void;
    setCzml: (czml: object) => void;
    setVehicleData: (vehicleData: object) => void;
    setVehicleRoute: (vehicleRoute: object) => void;
    setFeatures: (features: object) => void;
    triggerRefetch: () => void;
}

export const useVehicleStore = create<VehicleState>(((set) => ({
    numVehicle: 100,
    activeVehicleCount: 0,
    speedFactor: 30,
    czml: '',
    vehicleData : '',
    vehicleRoute : '',
    features : '',
    refetchTrigger: 0,
    denseViewport: false,
    setDenseViewport: (v: boolean) => set({ denseViewport: v }),
    viewportVehicleInfo: null,
    setViewportVehicleInfo: (info) => set({ viewportVehicleInfo: info }),
    setNumVehicle: (state : VehicleState) => set({ numVehicle: state }),
    setActiveVehicleCount: (count: number) => set({ activeVehicleCount: count }),
    setSpeedFactor: (state: VehicleState) => set({ speedFactor: state }),
    setCzml: (state: VehicleState) => set({ czml: state }),
    setVehicleData: (state: VehicleState) => set({ vehicleData: state }),
    setVehicleRoute: (state: VehicleState) => set({ vehicleRoute: state }),
    setFeatures: (state: VehicleState) => set({ features: state }),
    triggerRefetch: () => set((s) => ({ refetchTrigger: s.refetchTrigger + 1 })),
})));
