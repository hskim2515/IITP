import { useEffect, useMemo, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { MapBrowserEvent } from "ol";
import Feature, { FeatureLike } from "ol/Feature";
import { Layer } from "ol/layer";
import { StyleFunction, StyleLike } from "ol/style/Style";
import { isVectorLayer, matchesCustomKeyValue } from "@utils/olLayer";
import CircleStyle from "ol/style/Circle";
import { Icon, Style } from "ol/style";
import { isFeature } from "@utils/feature";
import throttle from 'lodash/throttle';
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "@component/form/propertyFormSchema";
import { useSelectionStore } from "@stores/useSelectionStore";
import {defaultEventHandlers} from "../../../handler/defaultEventHandler";

const useDefaultMoveMouse = () => {

    const viewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map)

    const olManager = useEventStore((state) => state.olEventManager);
    const cesiumManager = useEventStore((state) => state.cesiumEventManager);

    const selectedGuid = useSelectionStore((state) => state.selectedGuid)

    const THROTTLE_MS = 16

    // const hoverLayerName = useMemo(() => {
    //     if (!activeSubmenu) {
    //         return undefined;
    //     }
    //     return propertyFormSchema[activeSubmenu.menuCode].layer;
    // }, [activeSubmenu]);

    useEffect(() => {
        if (!olMap || !olManager) return;
        const throttledOlHover = throttle(defaultEventHandlers.handleOlHover, THROTTLE_MS);
        olManager.bind("pointermove", throttledOlHover);
        return () => {
            throttledOlHover.cancel()
            olManager.unbind("pointermove", throttledOlHover);
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