import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { findLayerByKeyValue } from "@utils/olLayer";
import { DrawEvent } from "ol/interaction/Draw";

const setMessage = useMessageStore.getState().setMessage;

const featureTypeHandlersInternal = {
    nodes: (record) => {
        setMessage({
            type: "info",
            text: "지도 위에 node 위치를 클릭하여 점을 찍어주세요.",
        });

        const eventStore = useEventStore.getState();
        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;
        const dataSource = viewer.dataSources.getByName("network")[0];
        if (!dataSource) return;

        const onClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.scene.pickPosition(e.position);
            if (!cartesian) return;

            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const height = carto.height;

            record.geometry = { type: "Point", coordinates: [lon, lat, height] };

            const nodeEntity = new Cesium.Entity({
                id: record.__guid,
                position: cartesian,
                cylinder: {
                    length: 5.0,
                    topRadius: 0.5,
                    bottomRadius: 0.5,
                    material: Cesium.Color.YELLOW,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: record,
            });

            dataSource.entities.add(nodeEntity);
            eventStore.unbind("click", onClick);

        };

        eventStore.bind("click", onClick);
    },

    links: (record) => {
        setMessage({
            type: "info",
            text: "지도 위에 링크를 클릭하여 선을 그리세요. 우클릭으로 완료합니다.",
        });

        const eventStore = useEventStore.getState();
        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;
        const dataSource = viewer.dataSources.getByName("network")[0];
        if (!dataSource) return;

        const positions: Cesium.Cartesian3[] = [];

        const onClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.scene.pickPosition(e.position);
            if (cartesian) positions.push(cartesian);
        };

        const onRightClick = () => {
            if (positions.length < 2) return;

            const coords = positions.map((c) => {
                const carto = Cesium.Cartographic.fromCartesian(c);
                return [
                    Cesium.Math.toDegrees(carto.longitude),
                    Cesium.Math.toDegrees(carto.latitude),
                    carto.height,
                ];
            });

            record.geometry = { type: "LineString", coordinates: coords };

            const polylineEntity = new Cesium.Entity({
                id: record.__guid,
                polyline: { positions, width: 3, material: Cesium.Color.BLUE },
                properties: record,
            });

            dataSource.entities.add(polylineEntity);

            eventStore.unbind("LEFT_CLICK", onClick);
            eventStore.unbind("RIGHT_CLICK", onRightClick);

        };

        eventStore.bind("LEFT_CLICK", onClick);
        eventStore.bind("RIGHT_CLICK", onRightClick);
    },
    busStations: (record) => {
        setMessage({
            type: "info",
            text: "지도 위에 busStation 위치를 클릭하여 점을 찍어주세요.",
        });

        const eventStore = useEventStore.getState();
        const viewer = useCesiumStore.getState().viewer;
        if (!viewer) return;
        const dataSource = viewer.dataSources.getByName("busStation")[0];
        if (!dataSource) return;
        const onClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const cartesian = viewer.scene.pickPosition(e.position);
            if (!cartesian) return;

            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const height = carto.height;

            record.geometry = { type: "Point", coordinates: [lon, lat, height] };
            const busStationEntity = new Cesium.Entity({
                id: record.__guid,
                position: cartesian,
                cylinder: {
                    length: 5.0,
                    topRadius: 0.5,
                    bottomRadius: 0.5,
                    material: Cesium.Color.RED,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: record,
            });

            dataSource.entities.add(busStationEntity);
            eventStore.unbind("click", onClick);
        };

        eventStore.bind("click", onClick);

        const olMap = useOpenLayersStore.getState().map;
        if (!olMap) return;
        const layer = findLayerByKeyValue(olMap, "LAYER_NAME", "busStations")
        if (!layer) return;
        const onDrawEnd = (e: DrawEvent) => {

        }
    },
};

export const featureTypeEventHandlers = (record: Record<string, string | number | undefined>) => {
    if(!record.featureType) {
        console.warn("featureType 인자:", record.featureType)
        return;
    }
    const handler = featureTypeHandlersInternal[record.featureType];
    if (!handler) {
        console.warn("등록되지 않은 featureType:", record.featureType);
        return;
    }

    handler(record);
};
