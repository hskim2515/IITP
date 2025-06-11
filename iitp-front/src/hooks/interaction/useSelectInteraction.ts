import { useMemo, useRef } from "react";
import { Feature } from "ol";
import { useActiveInteraction } from "./useActiveInteraction";
import { useLayerStore } from "@stores/useLayerStore";
import { setInteractionCondition } from "@utils/interaction";

import { InteractionEventOptions, SelectInteractionOption } from "@type/InteractionOptions";
import { SelectInteraction } from "../../interaction/SelectInteraction";
import { SelectEvent } from "ol/interaction/Select";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";

/**
 * OpenLayers Select Interaction 호출 hook
 *
 * @param layerName (필수) interaction 을 적용할 layer 이름
 * @param condition (필수) 조건 (좌클릭: OpenLayersScreenSpaceEventType.LEFT_CLICK, ...)
 * @param [onSelect] (선택) 동작 메서드
 */
const useSelectInteraction = ({
                                  layerName,
                                  condition,
                                  onSelect
                              }: SelectInteractionOption) => {

    const layerManager = useLayerStore.state.layerManager()
    const olMap = useOpenLayersStore.state.map()
    const layers = [layerManager.getLayerByName(layerName)];
    /** 외부에서 사용될 feature */
    const featureRef = useRef<Feature[]>([]);

    const event: InteractionEventOptions | null = useMemo(() => {
        if (layers.length < 1) {
            console.warn(`[useSelectInteraction] Layer "${ layerName }" not found.`);
            return null;
        }

        const handleSelect = (callback?: (e: SelectEvent) => Feature[]) => {
            return (e: SelectEvent) => {
                const features = callback?.(e) ?? e.selected;
                featureRef.current = features;
            };
        };

        return new SelectInteraction(
            layers,
            setInteractionCondition(condition),
            handleSelect(onSelect),
        );
    }, [ layers, condition, onSelect]);

    useActiveInteraction(event)

    return {
        ref: featureRef,
        activate: () => event?.activate(olMap),
        deactivate: () => event?.deactivate(olMap)
    };
}

export default useSelectInteraction;