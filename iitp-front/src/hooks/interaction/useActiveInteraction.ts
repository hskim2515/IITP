import { useEffect } from "react";
import { Map as OlMap } from "ol"
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { InteractionEventOptions } from "@type/InteractionOptions";

/**
 * events 목록을 받아서 Openlayers map 에 등록
 * @param event : Interaction SelectInteraction, ModifyInteraction, DrawInteraction, SnapInteraction, DeleteInteraction 입력한 Event 만 등록
 */
export const useActiveInteraction = (
    event: InteractionEventOptions | null,
) => {
    const map = useOpenLayersStore.state.map() as OlMap;
    useEffect(() => {
        if (!map || !event) return;

        const interaction = event.getInteraction();

        const alreadyExists = map.getInteractions().getArray().includes(interaction);
        if (!alreadyExists) {
            map.addInteraction(interaction);
        }

        return () => {
            map.removeInteraction(interaction);
        };
    }, [map, event]);
};

