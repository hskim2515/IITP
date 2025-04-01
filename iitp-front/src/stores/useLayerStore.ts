import { create } from "zustand";
import { devtools } from "zustand/middleware";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { Heatmap } from "ol/layer";


interface LayerState {
    //state
    activeLayerName: string | null; // heatmap, trip
    activeLayerGroupName: string | null; // 배경지도, 레이어, 시설물

    olVehicleLayer: WebGLVectorLayer | null;
    heatmapLayer: Heatmap | null;
    tripLayer: WebGLVectorLayer | null;
    //set
    setActiveLayerName: (state: string | null) => void;
    setActiveLayerGroupName: (state: string | null) => void;

    setOlVehicleLayer: (state: WebGLVectorLayer | null) => void;
    setHeatmapLayer: (state: Heatmap | null) => void;
    setTripLayer: (state: WebGLVectorLayer | null) => void;
}

export const useLayerStore = create<LayerState>((
    (set) => ({
        activeLayerName: null,
        activeLayerGroupName: null,

        olVehicleLayer: null,
        heatmapLayer: null,
        tripLayer: null,

        setActiveLayerName: (state: LayerState) => set({ activeLayerName: state }),
        setActiveLayerGroupName: (state: LayerState) => set({ activeLayerGroupName: state }),

        setOlVehicleLayer: (state: LayerState) => set({ olVehicleLayer: state }),
        setHeatmapLayer: (state: LayerState) => set({ heatmapLayer: state }),
        setTripLayer: (state: LayerState) => set({ tripLayer: state }),
    })
));
