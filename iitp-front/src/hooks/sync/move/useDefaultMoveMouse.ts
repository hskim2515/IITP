import { useEffect} from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import throttle from 'lodash/throttle';
import { useSelectionStore } from "@stores/useSelectionStore";
import {defaultEventHandlers} from "@handler/defaultEventHandler";
import debounce from "lodash.debounce";

const useDefaultMoveMouse = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const olManager = useEventStore((state) => state.olEventManager);
    const cesiumManager = useEventStore((state) => state.cesiumEventManager);

    const selectedGuid = useSelectionStore((state) => state.selectedGuid)

    const THROTTLE_MS = 16
    const DEBOUNCE_MS = 100

    // const hoverLayerName = useMemo(() => {
    //     if (!activeSubmenu) {
    //         return undefined;
    //     }
    //     return propertyFormSchema[activeSubmenu.menuCode].layer;
    // }, [activeSubmenu]);

    useEffect(() => {
        if (!olMap || !olManager) return;

        const optimizedOlHover = throttle(debounce(defaultEventHandlers.handleOlHover, DEBOUNCE_MS), THROTTLE_MS);

        olManager.bind("pointermove", optimizedOlHover);

        return () => {
            optimizedOlHover.cancel();
            olManager.unbind("pointermove", optimizedOlHover);
        };
    }, [olMap, olManager, selectedGuid]);

    useEffect(() => {
        if (!viewer || !cesiumManager) return;
        const throttledCesiumHover = throttle(defaultEventHandlers.handleCesiumHover, THROTTLE_MS);
        cesiumManager.bind("move", throttledCesiumHover);
        return () => {
            cesiumManager.unbind("move", throttledCesiumHover);
            throttledCesiumHover.cancel()
        };
    }, [viewer, cesiumManager, selectedGuid]);

};

export default useDefaultMoveMouse;