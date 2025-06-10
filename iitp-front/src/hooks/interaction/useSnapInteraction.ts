import { useMemo, useRef } from "react";
import { Feature } from "ol";
import { useActiveInteraction } from "./useActiveInteraction";
import { useLayerStore } from "@stores/useLayerStore";

import { InteractionEventOptions, SnapInteractionOption } from "@type/InteractionOptions";
import { SnapInteraction } from "../../interaction/SnapInteraction";

/**
 * OpenLayers Snap Interaction 호출 hook
 *
 * @param layerName (필수) interaction 을 적용할 layer 이름

 */
const useSnapInteraction = ({
                                  layerName,
                              }: SnapInteractionOption) => {

    const layerManager = useLayerStore.state.layerManager()
    const layer = layerManager.getLayerByName(layerName)
    /** 외부에서 사용될 feature */
    const featureRef = useRef<Feature[]>();

    const event: InteractionEventOptions | null = useMemo(() => {
        if (!layer) {
            console.warn(`[useSnapInteraction] Layer "${ layerName }" not found.`);
            return null;
        }
        return new SnapInteraction(
            layer.getSource(),
        );
    }, [ layer ]);


    useActiveInteraction(event)

    return featureRef;
}

export default useSnapInteraction;