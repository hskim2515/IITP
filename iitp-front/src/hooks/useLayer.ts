import { useEffect, useRef } from "react";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { Heatmap } from "ol/layer";
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow } from "zustand/react/shallow";
import { useVehicleStore } from "@stores/useVehicleStore";

const useLayer = () => {
    const map = useOpenLayersStore((state) => state.map);

    const activeLayerName = useLayerStore(useShallow((state) => state.activeLayerName));
    const activeLayerGroupName = useLayerStore(useShallow((state) => state.activeLayerGroupName));

    // features는 하위 레이어나 해당 그룹에 영향을 줄 수 있으므로 의존성에 포함
    const features = useVehicleStore(useShallow((state) => state.features));
    const olVehicleLayer = useLayerStore((state) => state.olVehicleLayer);
    const heatmapLayer = useLayerStore((state) => state.heatmapLayer);
    const tripLayer = useLayerStore((state) => state.tripLayer);

    const currentLayerRef = useRef<Heatmap | VectorLayer | WebGLVectorLayer>();

    useEffect(() => {
        if (!map || !activeLayerGroupName) return;

        // activeLayerGroupName이 "layer"가 아닌 경우 로직 중단
        if (activeLayerGroupName !== "layer") return;

        // 그룹 레이어 찾기
        const groupLayer = map.getLayers().getArray().find(
            (layer) => layer.get("customGroupName") === activeLayerGroupName
        );

        // activeLayerName이 falsy (null, undefined, "")이면 그룹을 숨김
        if (!activeLayerName) {
            groupLayer && groupLayer.setVisible(false);
            currentLayerRef.current = undefined;
            return;
        }

        if (groupLayer) {
            // 그룹 내의 모든 하위 레이어를 순회하면서 activeLayerName과 일치하는 경우만 visible true, 나머지는 false로 설정
            groupLayer.getLayersArray().forEach((layer: Heatmap | VectorLayer | WebGLVectorLayer) => {
                if (layer.get("customName") === activeLayerName) { // customName = MapInit에서 설정한 키
                    layer.setVisible(true);
                    currentLayerRef.current = layer;
                } else {
                    layer.setVisible(false);
                }
            });
            // 그룹은 activeLayerName이 존재할 때만 visible
            groupLayer.setVisible(true);
        }

        return () => {
            currentLayerRef.current = undefined;
        };
    }, [activeLayerName, activeLayerGroupName, map, features]);
};

export default useLayer;
