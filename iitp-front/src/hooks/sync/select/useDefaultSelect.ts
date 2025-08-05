import { useEffect, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import { usePropertyStore } from "@stores/usePropertyStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { Feature } from "ol";

const useDefaultSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);

    const olMap = useOpenLayersStore((state) => state.map);
    const cesiumEventManager = useEventStore.getState().cesiumEventManager;
    const olEventManager = useEventStore.getState().olEventManager;

    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const setSelectedProps = usePropertyStore((state) => state.setSelectedProps);
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);

    const infoEntityRef = useRef(null);

    const handleCesiumSelect = (e) => {
        const picked = viewer.scene.pick(e.position);
        console.log(picked)
        if (Cesium.defined(picked) && picked.id?.properties) {
            const props: Record<string, any> = {};
            const cartesian = viewer.scene.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid);
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const longitude = Cesium.Math.toDegrees(cartographic.longitude);
                const latitude = Cesium.Math.toDegrees(cartographic.latitude);
                const height = cartographic.height;

                props.longitude = longitude;
                props.latitude = latitude;
                props.height = height; // 높이도 함께 포함
            }
            const propBag = picked.id.properties;
            propBag.propertyNames.forEach((key: string) => {
                props[key] = propBag[key].getValue(Cesium.JulianDate.now());
            });
            console.log("props:::", props)
            setSelectedProps(props);

            setSelectedGuid([props.__guid])

        } else {
            setSelectedProps(null);
        }
    }

    const handleOLSelect = (e) => {
        olMap.forEachFeatureAtPixel(e.pixel, function (feature: Feature, layer: unknown) {
            const guid = feature.get("__guid");
            if(guid) {
                setSelectedProps(feature.getProperties())
                setSelectedGuid([feature.get("__guid")])
                return true
            }
        });

    }

    useEffect(() => {


        cesiumEventManager?.bind('select', handleCesiumSelect);
        olEventManager?.bind('click', handleOLSelect);

        return () => {
            cesiumEventManager?.unbind?.('select', handleCesiumSelect);
            olEventManager?.unbind?.('click', handleOLSelect);
        };
    }, [viewer, olMap]);


};

export default useDefaultSelect;
