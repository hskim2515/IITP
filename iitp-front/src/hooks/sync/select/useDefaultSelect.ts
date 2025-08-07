import { useEffect, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import { usePropertyStore } from "@stores/usePropertyStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { MapBrowserEvent } from "ol";
import { useMenuStore } from "@stores/useMenuStore";
import { propertyFormSchema } from "../../../component/form/propertyFormSchema";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { getFeaturesByGuidPrefix } from "@utils/feature";
import { Fill, Stroke, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";

const useDefaultSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);

    const olMap = useOpenLayersStore((state) => state.map)
    const cesiumEventManager = useEventStore.getState().cesiumEventManager;
    const olEventManager = useEventStore.getState().olEventManager;

    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const setSelectedProps = usePropertyStore((state) => state.setSelectedProps);
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);

    const infoEntityRef = useRef(null);

    const handleCesiumSelect = (e:Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (!viewer) return
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

            setSelectedGuid([props.__guid])

        } else {
            setSelectedProps(null);
        }
    }

    const handleOLSelect = (e: MapBrowserEvent<UIEvent>) => {
        if (!olMap) {
            setSelectedProps(null);
            setSelectedGuid([]);
            return;
        }
        let isFeatureExist = false
        olMap.forEachFeatureAtPixel(e.pixel, function (feature) {
            const guid = feature.get("__guid");
            if (guid) {
                isFeatureExist = true;
                setSelectedProps(feature.getProperties())
                setSelectedGuid([feature.get("__guid")])
                return true
            }
        });
        if(!isFeatureExist) {
            setSelectedProps(null)
            setSelectedGuid([])
        }
    }

    useEffect(() => {
        cesiumEventManager?.bind('select', handleCesiumSelect);
        olEventManager?.bind('click', handleOLSelect);

        return () => {
            cesiumEventManager?.unbind?.('select', handleCesiumSelect);
            olEventManager?.unbind?.('click', handleOLSelect);
        };
    }, [viewer, olMap]);

    useEffect(() => {
        const activeSubmenu = useMenuStore.getState().activeSubmenu;
        if (activeSubmenu) {
            const layerName = propertyFormSchema[activeSubmenu.menuCode].layer
            const viewer = useCesiumStore.getState().viewer;
            if (!layerName || !viewer) return
            selectedGuid.forEach(guid => {
                console.log("guid:::", guid)
                const map = useOpenLayersStore.getState().map
                if (!map) return
                const olLayer = map.getLayers().getArray().find((layer) => {
                    if (
                        (layer instanceof VectorLayer
                            || layer instanceof WebGLVectorLayer
                        ) && layer.get("layer") === layerName) {
                        return true;
                    }
                    return false;
                }) as (VectorLayer<VectorSource> | WebGLVectorLayer | undefined); // 반환 타입 명시
                const features = getFeaturesByGuidPrefix(olLayer, guid);
                features?.getArray().forEach((feature) => {
                    feature.setStyle(
                        new Style({
                            stroke: new Stroke({
                                color: 'rgb(31,255,0)',

                            }),
                            zIndex: 200,
                            fill: new Fill({
                                color: 'rgb(31,255,0)',
                            }),
                            image: new CircleStyle({
                                radius: 7,
                                fill: new Fill({color: 'rgb(31,255,0)'}),
                                stroke: new Stroke({color: 'white', width: 3}),
                            }),
                        }),
                    );
                });
                viewer?.dataSources?.getByName(layerName)[0]?.entities.values.forEach(entity => {
                    if (entity.id === guid) {

                        const blinkingColor = new Cesium.CallbackProperty((time) => {
                            // 현재 시간(ms 기준)
                            const currentTime = Date.now();

                            // 0.5초마다 색상 전환
                            const isYellow = Math.floor(currentTime / 500) % 2 === 0;

                            return isYellow
                                ? Cesium.Color.YELLOW.withAlpha(1.0)
                                : Cesium.Color.RED.withAlpha(1.0);
                        }, false);

                        const blinkingMaterial = new Cesium.ColorMaterialProperty(blinkingColor);

                        let originalMaterial: Cesium.MaterialProperty | undefined = undefined;
                        let originalColor: Cesium.Property | undefined = undefined;

                        if (entity.polyline) {
                            originalMaterial = entity.polyline.material;
                            entity.polyline.material = blinkingMaterial;
                        } else if (entity.corridor) {
                            originalMaterial = entity.corridor.material;
                            entity.corridor.material = blinkingMaterial;
                        } else if (entity.point) {
                            originalColor = entity.point.color;
                            entity.point.color = blinkingColor;
                        } else if (entity.polygon) {
                            originalMaterial = entity.polygon.material;
                            entity.polygon.material = blinkingColor;
                        }

                        setTimeout(() => {
                            if (entity.polyline && originalMaterial) {
                                entity.polyline.material = originalMaterial;
                            } else if (entity.corridor && originalMaterial) {
                                entity.corridor.material = originalMaterial;
                            } else if (entity.point && originalColor) {
                                entity.point.color = originalColor;
                            } else if (entity.polygon && originalMaterial) {
                                entity.polygon.material = originalMaterial;
                            }
                        }, 5000);


                        // 카메라 이동
                        if (entity.point && entity.position) {
                            const entityPosition = entity.position.getValue(Cesium.JulianDate.now());
                            if(!entityPosition) return
                            viewer.camera.flyTo({
                                destination: entityPosition,
                                duration: 2.0,
                            });
                        } else if (entity.polyline && entity.polyline.positions) {
                            const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
                            const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
                            viewer.camera.flyToBoundingSphere(boundingSphere, {
                                duration: 2.0,
                                offset: new Cesium.HeadingPitchRange(0, -0.7, boundingSphere.radius * 2.0),
                            });
                        } else if (entity.corridor && entity.corridor.positions) {
                            const positions = entity.corridor.positions.getValue(Cesium.JulianDate.now());
                            const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
                            viewer.camera.flyToBoundingSphere(boundingSphere, {
                                duration: 2.0,
                                offset: new Cesium.HeadingPitchRange(0, -0.7, boundingSphere.radius * 2.0),
                            });
                        } else if (entity.ellipse && entity.position) {
                            const position = entity.position.getValue(Cesium.JulianDate.now());
                            const semiMajor = entity.ellipse.semiMajorAxis?.getValue(Cesium.JulianDate.now()) ?? 10;
                            const semiMinor = entity.ellipse.semiMinorAxis?.getValue(Cesium.JulianDate.now()) ?? 10;

                            const radius = Math.max(semiMajor, semiMinor);
                            const boundingSphere = new Cesium.BoundingSphere(position, radius);
                            viewer.camera.flyToBoundingSphere(boundingSphere, {
                                duration: 2.0,
                                offset: new Cesium.HeadingPitchRange(0, -0.7, radius * 2.0),
                            });
                        } else if (entity.cylinder && entity.position) {
                            const position = entity.position.getValue(Cesium.JulianDate.now());
                            const topRadius = entity.cylinder.topRadius?.getValue(Cesium.JulianDate.now()) ?? 1.0;
                            const bottomRadius = entity.cylinder.bottomRadius?.getValue(Cesium.JulianDate.now()) ?? 1.0;
                            const length = entity.cylinder.length?.getValue(Cesium.JulianDate.now()) ?? 10;

                            // 반지름과 길이를 고려한 대략적인 반경 계산
                            const radius = Math.sqrt(Math.max(topRadius, bottomRadius) ** 2 + (length / 2) ** 2);
                            const boundingSphere = new Cesium.BoundingSphere(position, radius);
                            viewer.camera.flyToBoundingSphere(boundingSphere, {
                                duration: 2.0,
                                offset: new Cesium.HeadingPitchRange(0, -0.7, radius * 2.0),
                            });
                        }

                    }
                })
            })
        }
    }, [selectedGuid]);

};

export default useDefaultSelect;
