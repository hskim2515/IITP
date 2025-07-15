import { useEffect, useRef } from "react";
import {useCesiumStore} from "@stores/useCesiumStore";
import {usePropertyStore} from "@stores/usePropertyStore";
import * as Cesium from "cesium";
import {useEventStore} from "@stores/useEventStore";

const useDefaultSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);

    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const setSelectedProps = usePropertyStore((state) => state.setSelectedProps);

    const infoEntityRef = useRef(null);

    useEffect(() => {

        useEventStore.getState().cesiumEventManager?.bind('select', (e) => {
            const picked = viewer.scene.pick(e.position);
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
                setSelectedProps(props);

            } else {
                setSelectedProps(null);
            }
        });
    }, [viewer]);


};

export default useDefaultSelect;
