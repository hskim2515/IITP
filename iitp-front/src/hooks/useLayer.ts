import { useEffect, useRef } from "react";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow } from "zustand/react/shallow";
import {useCesiumStore} from "@stores/useCesiumStore";

const useLayer = () => {
    const map = useOpenLayersStore((state) => state.map);
    const viewer = useCesiumStore((state) => state.viewer);

    const layerManager = useLayerStore((state) => state.layerManager);

    const activeLayerName = useLayerStore(useShallow((state) => state.activeLayerName));
    const activeLayerGroupName = useLayerStore(useShallow((state) => state.activeLayerGroupName));

    function usePrevious<T>(value: T): T | undefined {
        const ref = useRef<T>();
        useEffect(() => {
            ref.current = value;
        }, [value]);
        return ref.current;
    }

    const prevLayerNames = usePrevious(activeLayerName) || [];

    useEffect(() => {
        if (
            !viewer
            || !map
            || !activeLayerGroupName
            || activeLayerGroupName !== "layer"
        ) return;
        console.log("useLayer:::activeLayer", activeLayerGroupName, activeLayerName)
        const added = activeLayerName?.filter(name => !prevLayerNames.includes(name)) || [];
        const removed = prevLayerNames?.filter(name => !activeLayerName?.includes(name)) || [];

        removed.forEach(name => {
            layerManager?.hideLayer(activeLayerGroupName, name);
        });

        added.forEach(name => {
            layerManager?.showLayer(activeLayerGroupName, name);
        });

    }, [activeLayerName, activeLayerGroupName, viewer]);

};

export default useLayer;
