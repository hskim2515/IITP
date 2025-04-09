import { create } from "zustand";
import { devtools } from "zustand/middleware";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { Heatmap } from "ol/layer";
import LayerPrimitiveManager from "@primitives/PrimitiveLayerManager";

interface LayerState {
    //state
    activeLayerName: Array<string> | null; // heatmap, trip
    activeLayerGroupName: Array<string> | null; // 배경지도, 레이어, 시설물

    olVehicleLayer: WebGLVectorLayer | null;
    heatmapLayer: Heatmap | null;
    tripLayer: WebGLVectorLayer | null;

    cesiumPrimitiveLayerManager: LayerPrimitiveManager | null;

    //set
    setActiveLayerName: (state: Array<string> | null) => void;
    setActiveLayerGroupName: (state: Array<string> | null) => void;

    setOlVehicleLayer: (state: WebGLVectorLayer | null) => void;
    setHeatmapLayer: (state: Heatmap | null) => void;
    setTripLayer: (state: WebGLVectorLayer | null) => void;

    setCesiumPrimitiveLayerManager: (state: LayerPrimitiveManager | null) => void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
    activeLayerName: null,
    activeLayerGroupName: null,

    olVehicleLayer: null,
    heatmapLayer: null,
    tripLayer: null,

    cesiumPrimitiveLayerManager: null,

    setActiveLayerName: (state) => set({ activeLayerName: state }),
    addActiveLayerName: (layerName) => {
        const current = get().activeLayerName ?? [];
        if (!current.includes(layerName)) {
            set({ activeLayerName: [...current, layerName] });
        }
    },
    removeActiveLayerName: (layerName) => {
        const current = get().activeLayerName ?? [];
        set({ activeLayerName: current.filter(name => name !== layerName) });
    },
    toggleActiveLayerName: (layerName) => {
        const current = get().activeLayerName ?? [];
        if (current.includes(layerName)) {
            set({ activeLayerName: current.filter(name => name !== layerName) });
        } else {
            set({ activeLayerName: [...current, layerName] });
        }
    },

    setActiveLayerGroupName: (state) => set({ activeLayerGroupName: state }),
    addActiveLayerGroupName: (groupName) => {
        const current = get().activeLayerGroupName ?? [];
        if (!current.includes(groupName)) {
            set({ activeLayerGroupName: [...current, groupName] });
        }
    },
    removeActiveLayerGroupName: (groupName) => {
        const current = get().activeLayerGroupName ?? [];
        set({ activeLayerGroupName: current.filter(name => name !== groupName) });
    },
    toggleActiveLayerGroupName: (groupName) => {
        const current = get().activeLayerGroupName ?? [];
        if (current.includes(groupName)) {
            set({ activeLayerGroupName: current.filter(name => name !== groupName) });
        } else {
            set({ activeLayerGroupName: [...current, groupName] });
        }
    },

    setOlVehicleLayer: (state) => set({ olVehicleLayer: state }),
    setHeatmapLayer: (state) => set({ heatmapLayer: state }),
    setTripLayer: (state) => set({ tripLayer: state }),

    setCesiumPrimitiveLayerManager: (state) => set({ cesiumPrimitiveLayerManager: state }),
}));

