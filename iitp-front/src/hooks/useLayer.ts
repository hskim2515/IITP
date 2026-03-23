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
        ) return;

        const added = activeLayerName?.filter(name => !prevLayerNames.includes(name)) || [];
        const removed = prevLayerNames?.filter(name => !activeLayerName?.includes(name)) || [];

        // getLayerByName 은 VectorLayerManager 만 체크하므로,
        // Cesium-only 레이어(speed 등)를 포함하려면 getManagersByGroupAndLayerName 으로 존재 확인
        removed.forEach(name => {
            if (layerManager?.getManagersByGroupAndLayerName(activeLayerGroupName, name).length) {
                layerManager.hideLayer(activeLayerGroupName, name);
            }
        });

        added.forEach(name => {
            if (layerManager?.getManagersByGroupAndLayerName(activeLayerGroupName, name).length) {
                layerManager.showLayer(activeLayerGroupName, name);
            }
        });

    }, [activeLayerName, activeLayerGroupName, viewer]);

};

export default useLayer;
