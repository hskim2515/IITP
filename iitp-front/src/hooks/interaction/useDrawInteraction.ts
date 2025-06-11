import { useMemo, useRef } from "react";
import { Feature } from "ol";
import { DrawEvent } from "ol/interaction/Draw";
import { useActiveInteraction } from "./useActiveInteraction";
import { DrawInteraction } from "../../interaction/DrawInteraction";
import { useLayerStore } from "@stores/useLayerStore";
import { setInteractionCondition } from "@utils/interaction";

import { DrawInteractionOption, InteractionEventOptions } from "@type/InteractionOptions";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";

/**
 * OpenLayers Draw Interaction 호출 hook
 *
 * @param layerName (필수) interaction 을 적용할 layer 이름
 * @param condition (필수) 조건 (좌클릭: OpenLayersScreenSpaceEventType.LEFT_CLICK, ...)
 * @param drawGeometryType (필수) draw GeometryType (포인트: GeometryType.POINT)
 * @param [onDrawStart] (선택) draw 시작 시 동작 메서드
 * @param [onDrawEnd] (선택) draw 종료 시 동작 메서드
 */
const useDrawInteraction = ({
                                layerName,
                                condition,
                                drawGeometryType,
                                onDrawStart,
                                onDrawEnd
                            }: DrawInteractionOption) => {

    const layerManager = useLayerStore.state.layerManager()
    const olMap = useOpenLayersStore.state.map()
    const layer = layerManager.getLayerByName(layerName)
    /** 외부에서 사용될 feature */
    const featureRef = useRef<Feature>(undefined);

    const event: InteractionEventOptions | null = useMemo(() => {
        if (!layer) {
            console.warn(`[useDrawInteraction] Layer "${ layerName }" not found.`);
            return null;
        }

        const handleDrawStart = (callback?: (e: DrawEvent) => Feature) => {
            return (e: DrawEvent) => {
                callback?.(e);
            };
        };

        const handleDrawEnd = (callback?: (e: DrawEvent) => Feature) => {
            return (e: DrawEvent) => {
                const feature = callback?.(e) ?? e.feature;
                if (feature) featureRef.current = feature;
            };
        };

        const interaction = new DrawInteraction(
            layer,
            drawGeometryType,
            setInteractionCondition(condition),
            handleDrawStart(onDrawStart),
            handleDrawEnd(onDrawEnd)
        );

        return interaction;
    }, [ layer, drawGeometryType, condition, onDrawStart, onDrawEnd ]);

    useActiveInteraction(event)
    event?.deactivate(olMap)
    return {
        ref: featureRef,
        activate: () => event?.activate(olMap),
        deactivate: () => event?.deactivate(olMap)
    };
}

export default useDrawInteraction;