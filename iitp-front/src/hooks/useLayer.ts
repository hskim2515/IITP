import { useEffect, useRef } from "react";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { Heatmap } from "ol/layer";
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow } from "zustand/react/shallow";
import { useVehicleStore } from "@stores/useVehicleStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import * as Cesium from "cesium";

const useLayer = () => {
    const map = useOpenLayersStore((state) => state.map);
    const viewer = useCesiumStore((state) => state.viewer);

    const primitiveLayerManager = useLayerStore((state) => state.cesiumPrimitiveLayerManager);

    const activeLayerName = useLayerStore(useShallow((state) => state.activeLayerName));
    const activeLayerGroupName = useLayerStore(useShallow((state) => state.activeLayerGroupName));

    // features는 하위 레이어나 해당 그룹에 영향을 줄 수 있으므로 의존성에 포함
    const features = useVehicleStore(useShallow((state) => state.features));
    const olVehicleLayer = useLayerStore((state) => state.olVehicleLayer);
    const heatmapLayer = useLayerStore((state) => state.heatmapLayer);
    const tripLayer = useLayerStore((state) => state.tripLayer);


    function usePrevious<T>(value: T): T | undefined {
        const ref = useRef<T>();
        useEffect(() => {
            ref.current = value;
        }, [value]);
        return ref.current;
    }

    useEffect(() => {

        if (!map || !activeLayerGroupName) return;

        // activeLayerGroupName이 "layer"가 아닌 경우 로직 중단
        if (activeLayerGroupName !== "layer") return;

        // 그룹 레이어 찾기
        const groupLayer = map.getLayers().getArray().find(
            (layer) => layer.get("customGroupName") === activeLayerGroupName
        );

        // activeLayerName이 falsy (null, undefined, "")이면 그룹을 숨김
        // if (!activeLayerName) {
        //     groupLayer && groupLayer.setVisible(false);
        //     currentLayerRef.current = undefined;
        //     return;
        // }

        if (groupLayer) {
            // 그룹 내의 모든 하위 레이어를 순회하면서 activeLayerName과 일치하는 경우만 visible true, 나머지는 false로 설정
            groupLayer.getLayersArray().forEach((layer: Heatmap | VectorLayer | WebGLVectorLayer) => {
                layer.setVisible(false)
                activeLayerName?.forEach(layerName => {
                    if (layer.get("customName") === layerName) { // customName = MapInit에서 설정한 키
                        layer.setVisible(true);
                    }
                })

            });
            // 그룹은 activeLayerName이 존재할 때만 visible
            groupLayer.setVisible(true);
        }

        return () => {
        };
    }, [activeLayerName, activeLayerGroupName, map, features]);

    const prevLayerNames = usePrevious(activeLayerName) || [];

    useEffect(() => {
        if (!viewer || !activeLayerGroupName || activeLayerGroupName !== "layer") return;

        const added = activeLayerName?.filter(name => !prevLayerNames.includes(name)) || [];
        const removed = prevLayerNames?.filter(name => !activeLayerName?.includes(name)) || [];

        removed.forEach(name => {
            primitiveLayerManager.hide(activeLayerGroupName, name);
        });

        added.forEach(name => {
            primitiveLayerManager.show(activeLayerGroupName, name);
        });

    }, [activeLayerName, activeLayerGroupName, viewer]);

};

export default useLayer;
