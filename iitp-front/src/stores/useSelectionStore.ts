import { create } from 'zustand';
import * as Cesium from "cesium";
import { CallbackProperty, Color, ColorMaterialProperty } from 'cesium';
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useMenuStore} from "@stores/useMenuStore";
import {propertyFormSchema} from "../component/form/propertyFormSchema";

type SelectionStore = {
    selectedGuid: (string | number) [];
    setSelectedGuid: (guids: (string | number)[]) => void;

    addSelectionId: (guid: string | number) => void;
    removeSelectionId: (guid: string | number) => void;
    clearSelected: () => void;
};

export const useSelectionStore = create<SelectionStore>((set, get) => ({
    selectedGuid: [],
    setSelectedGuid: (guids:(string | number)[]) => {
        set({ selectedGuid: guids })
        const activeSubmenu = useMenuStore.getState().activeSubmenu;
        if(activeSubmenu){
            const layerName = propertyFormSchema[activeSubmenu.menuCode].layer
            const viewer = useCesiumStore.getState().viewer;
            guids.forEach( guid =>{
                viewer?.dataSources?.getByName(layerName)[0]?.entities.values.forEach(entity => {
                    if(entity.id === guid) {

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

                        let originalMaterial = null;
                        let originalColor = null;

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
                            viewer.camera.flyTo({
                                destination: entity.position.getValue(Cesium.JulianDate.now()),
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

    },

    addSelectionId: (guid: string | number) => {
        const currentSelected = get().selectedGuid;
        if(!currentSelected.includes(guid)) set({selectedGuid: [...currentSelected, guid]});
    },
    removeSelectionId:(guid: string | number) => {
        const currentSelected = get().selectedGuid;
        set({selectedGuid: currentSelected.filter((id: string | number) => id !== guid)});
    },
    clearSelected: () => set({selectedGuid: []}),
}));
