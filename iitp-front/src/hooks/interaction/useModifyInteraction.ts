import { useMemo, useRef } from "react";
import { Feature } from "ol";
import { useActiveInteraction } from "./useActiveInteraction";
import { useLayerStore } from "@stores/useLayerStore";
import { setInteractionCondition } from "@utils/interaction";

import { InteractionEventOptions, ModifyInteractionOption } from "@type/InteractionOptions";
import { ModifyEvent } from "ol/interaction/Modify";
import { ModifyInteraction } from "../../interaction/ModifyInteraction";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";

/**
 * OpenLayers Modify Interaction 호출 hook
 *
 * @param layerName (필수) interaction 을 적용할 layer 이름
 * @param condition (필수) 조건 (좌클릭: OpenLayersScreenSpaceEventType.LEFT_CLICK, ...)
 * @param [onModifyStart] (선택) modify 시작 시 동작 메서드
 * @param [onModifyEnd] (선택) modify 종료 시 동작 메서드
 */
const useModifyInteraction = ({
                                  layerName,
                                  condition,
                                  onModifyStart,
                                  onModifyEnd
                              }: ModifyInteractionOption) => {

    const layerManager = useLayerStore.state.layerManager()
    const olMap = useOpenLayersStore.state.map()
    const layer = layerManager.getLayerByName(layerName)
    /** 외부에서 사용될 feature */
    const featureRef = useRef<Feature[]>([]);

    const event: InteractionEventOptions | null = useMemo(() => {
        if (!layer) {
            console.warn(`[useModifyInteraction] Layer "${ layerName }" not found.`);
            return null;
        }

        const handleModifyStart = (callback?: (e: ModifyEvent) => Feature[]) => {
            return (e: ModifyEvent) => {
                callback?.(e);
            };
        };

        const handleModifyEnd = (callback?: (e: ModifyEvent) => Feature[]) => {
            return (e: ModifyEvent) => {
                const features = callback?.(e) ?? e.features.getArray();
                featureRef.current = features;
            };
        };

        const interaction = new ModifyInteraction(
            layer,
            setInteractionCondition(condition),
            handleModifyStart(onModifyStart),
            handleModifyEnd(onModifyEnd)
        );
        interaction.deactivate(olMap)
        return interaction;
    }, [ layer, condition, onModifyStart, onModifyEnd ]);

    useActiveInteraction(event)

    return {
        ref: featureRef,
        activate: () => event?.activate(olMap),
        deactivate: () => event?.deactivate(olMap)
    };
}

export default useModifyInteraction;