import { useEffect, useRef } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";

const useDefaultMoveMouse = () => {
    const viewer = useCesiumStore((state) => state.viewer);

    const highlightedEntityRef = useRef<Cesium.Entity | null>(null);
    const originalSizeMap = useRef<WeakMap<Cesium.Entity, any>>(new WeakMap());

    useEffect(() => {
        const manager = useEventStore.getState().cesiumEventManager;
        if (!viewer || !manager) return;

        const scene = viewer.scene;
        const HIGHLIGHT_SCALE = 3;

        const handler = (e: any) => {
            const position = e.endPosition ?? e.position;
            if (!position) return;

            const cartesian = scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
            if (!cartesian) return;

            const pickedObject = scene.pick(position);
            const entity = pickedObject?.id as Cesium.Entity;
            if (!entity) {
                clearHighlight();
                return;
            }

            if (highlightedEntityRef.current !== entity) {
                highlightEntity(entity);
            }
        };

        const clearHighlight = () => {
            const entity = highlightedEntityRef.current;
            if (!entity) return;

            const original = originalSizeMap.current.get(entity);
            if (!original) return;

            if (entity.point && original.pixelSize !== undefined) {
                entity.point.pixelSize = new Cesium.ConstantProperty(original.pixelSize);
            }
            if (entity.model && original.scale !== undefined) {
                entity.model.scale = new Cesium.ConstantProperty(original.scale);
            }
            if (entity.polyline && original.width !== undefined) {
                entity.polyline.width = new Cesium.ConstantProperty(original.width);
            }
            if (entity.corridor && original.width !== undefined) {
                entity.corridor.width = new Cesium.ConstantProperty(original.width);
            }
            if (entity.polygon && original.extrudedHeight !== undefined) {
                entity.polygon.extrudedHeight = new Cesium.ConstantProperty(original.extrudedHeight);
            }

            highlightedEntityRef.current = null;
        };

        const highlightEntity = (entity: Cesium.Entity) => {
            clearHighlight(); // reset any previous entity

            const now = Cesium.JulianDate.now();
            const original: any = {};

            if (entity.point) {
                original.pixelSize = entity.point.pixelSize?.getValue(now) ?? 10;
                entity.point.pixelSize = new Cesium.ConstantProperty(original.pixelSize * HIGHLIGHT_SCALE);
            }

            if (entity.model) {
                original.scale = entity.model.scale?.getValue(now) ?? 1.0;
                entity.model.scale = new Cesium.ConstantProperty(original.scale * HIGHLIGHT_SCALE);
            }

            if (entity.polyline) {
                original.width = entity.polyline.width?.getValue(now) ?? 3.0;
                entity.polyline.width = new Cesium.ConstantProperty(original.width * HIGHLIGHT_SCALE);
            }

            if (entity.corridor) {
                original.width = entity.corridor.width?.getValue(now) ?? 3.0;
                entity.corridor.width = new Cesium.ConstantProperty(original.width * HIGHLIGHT_SCALE);
            }

            if (entity.polygon) {
                original.extrudedHeight = entity.polygon.extrudedHeight?.getValue(now) ?? 0;
                entity.polygon.extrudedHeight = new Cesium.ConstantProperty(original.extrudedHeight * HIGHLIGHT_SCALE);
            }

            originalSizeMap.current.set(entity, original);
            highlightedEntityRef.current = entity;
        };

        manager.bind("move", handler);
        return () => {
            manager.unbind("move", handler);
        };
    }, [viewer]);
};

export default useDefaultMoveMouse;
