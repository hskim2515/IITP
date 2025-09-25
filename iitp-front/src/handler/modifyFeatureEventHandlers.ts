import { useMessageStore } from "@stores/useMessageStore";
import { useEventStore } from "@stores/useEventStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useLayerStore } from "@stores/useLayerStore";
import { filterFeaturesByKey, getFeaturesByProperties } from "@utils/feature";
import Feature from "ol/Feature";
import Collection from "ol/Collection";
import { useNetworkStore } from "@stores/useNetworkStore";
import { BusStationData, RailStationData, RailStationExitData } from "@type/Station";
import { Coordinates } from "@type/openapi.gen";
import { useBusStationHistoryStore, useBusStationStore } from "@stores/useBusStationStore";
import Point from "ol/geom/Point";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { ModifyEvent } from "ol/interaction/Modify";
import { pickFromOpenLayers } from "@utils/pick";
import { fromLonLat } from "ol/proj";
import { projectPointOntoSegmentOl } from "@utils/offset";
import { createCoordinatesFromOl } from "@utils/coordinates";
import Geometry from "ol/geom/Geometry";
import { useRailStationHistoryStore, useRailStationStore } from "@stores/useRailStationStore";

const setMessage = useMessageStore.getState().setMessage;

const modifyFeatureHandlersInternal = {
    nodes: () => {
    },

    links: () => {
    },

    busStations: (featureType: string) => {
        const network = useNetworkStore.getState().currentJsonData;

        if (!network) {
            setMessage({type: "warn", text: "수정이 반영될 네트워크가 존재하지 않습니다."});
            return;
        }

        function processAndStoreStation(
            record: BusStationData,
            linkRef: number | string,
            laneRef: number | string,
            offset: number,
        ) {
            const newStation: BusStationData = {
                ...record,
                linkRef,
                laneRef,
                offset,
            } as BusStationData;

            const {updateCurrentJsonData} = useBusStationStore.getState();
            const historyStore = useBusStationHistoryStore;
            updateCurrentJsonData(newStation, historyStore);
            console.log(`[${featureType}] projected modifyend`, {newStation});
            setMessage({
                type: "info",
                text: `버스정류장이 수정되었습니다.`,
            });
        }

        const snapFeatureType = "lane-edit"
        const snapLayerName = "network"
        const layerName = "busStation"
        const layer = useLayerStore.getState().layerManager?.getLayerByName(layerName)
        if (!layer) return;

        const olModifyend = (e: ModifyEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const modified = e.features.item(0);
            const {geometry, ...record} = modified.getProperties();

            const geom = modified.getGeometry()
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "정류장 Point가 없습니다."});
                return;
            }

            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord)
            const laneFeature = pickFromOpenLayers(
                olMap,
                pixel,
                (feature) => feature.get('featureType')=='lane'
            );

            if (!laneFeature) {
                setMessage({type: "warn", text: "정류장은 차선 위에만 위치할 수 있습니다."});
                return;
            }
            const laneData = laneFeature.getProperties();
            const laneStart = laneData.laneSource
            const laneEnd = laneData.laneTarget

            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const {offset, offsetPosition} = projectPointOntoSegmentOl(laneStart, laneEnd, coord);

            geom.setCoordinates(offsetPosition)
            processAndStoreStation(<BusStationData>record, parentLink.id, laneData.id, offset);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olModifyHandler = (e: ModifyEvent) => {
            olModifyend(e);

        }
        const cleanup = () => {
            try {
                olEventManager?.unbind(`modify:${featureType}:end`, olModifyHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
        };

        const selectedGuid = useSelectionStore.getState().selectedGuid

        const modifyFeatures = new Collection<Feature>();
        const selected = filterFeaturesByKey(layer, selectedGuid) as Collection<Feature>;
        if (!selected || selected.getLength() === 0) {
            // 선택 없음
            return;
        }
        modifyFeatures.clear()
        selected.forEach(f => modifyFeatures.push(f))

        olEventManager?.bind(`modify:${featureType}:end`, olModifyHandler, {features: modifyFeatures});
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, {featureType: snapFeatureType})
        olEventManager?.bind(`snap:${featureType}`, olSnap, {features: snapFeatures ?? new Collection<Feature<Geometry>>});
        return cleanup;
    },

    railStations: (featureType: string) => {
        const network = useNetworkStore.getState().currentJsonData;

        if (!network) {
            setMessage({type: "warn", text: "수정이 반영될 네트워크가 존재하지 않습니다."});
            return;
        }

        function processAndStoreStation(
            record: RailStationData,
            coordinates: Coordinates
        ) {
            const newStation = {
                ...record,
                coordinates,

            } as BusStationData;

            const {updateCurrentJsonData} = useRailStationStore.getState();
            const historyStore = useRailStationHistoryStore;
            updateCurrentJsonData(newStation, historyStore);
            console.log(`[${featureType}] projected modifyend`, {newStation});
            setMessage({
                type: "info",
                text: `정류장이 수정되었습니다.`,
            });
        }

        const layerName = "railStation"
        const layer = useLayerStore.getState().layerManager?.getLayerByName(layerName)
        if (!layer) return;

        const olModifyend = (e: ModifyEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const modified = e.features.item(0);
            const {geometry, ...record} = modified.getProperties();

            const geom = modified.getGeometry()
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "정류장 Point가 없습니다."});
                return;
            }

            const coord = geom.getCoordinates();

            const coordinates = createCoordinatesFromOl(coord)
            if (!coordinates) return;

            processAndStoreStation(<RailStationData>record, coordinates);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olModifyHandler = (e: ModifyEvent) => {
            olModifyend(e);

        }
        const cleanup = () => {
            try {
                olEventManager?.unbind(`modify:${featureType}:end`, olModifyHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
        };

        const selectedGuid = useSelectionStore.getState().selectedGuid

        const modifyFeatures = new Collection<Feature>();
        const selected = filterFeaturesByKey(layer, selectedGuid) as Collection<Feature>;
        if (!selected || selected.getLength() === 0) {
            // 선택 없음
            return;
        }
        modifyFeatures.clear()
        selected.forEach(f => modifyFeatures.push(f))

        olEventManager?.bind(`modify:${featureType}:end`, olModifyHandler, {features: modifyFeatures});
        return cleanup;
    },

    exits: (featureType: string) => {
        const network = useNetworkStore.getState().currentJsonData;

        if (!network) {
            setMessage({type: "warn", text: "수정이 반영될 네트워크가 존재하지 않습니다."});
            return;
        }

        function processAndStoreStation(
            record: RailStationExitData,
            linkRef: number | string,
            offset: number,
        ) {
            const newStation: RailStationExitData = {
                ...record,
                linkRef,
                offset,
            } as RailStationExitData;

            const {updateCurrentJsonData} = useRailStationStore.getState();
            const historyStore = useRailStationHistoryStore;
            updateCurrentJsonData(newStation, historyStore);
            console.log(`[${featureType}] projected modifyend`, {newStation});
            setMessage({
                type: "info",
                text: `출구가 수정되었습니다.`,
            });
        }

        const snapFeatureType = "link-edit"
        const snapLayerName = "network"
        const layerName = "railStation"
        const layer = useLayerStore.getState().layerManager?.getLayerByName(layerName)
        if (!layer) return;

        const olModifyend = (e: ModifyEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const modified = e.features.item(0);
            console.log("modified:::", modified)
            const {geometry, ...record} = modified.getProperties();
            console.log("modified properties:::", record)

            const geom = modified.getGeometry()
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "출구 Point가 없습니다."});
                return;
            }
            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord)
            const linkFeature = pickFromOpenLayers(
                olMap,
                pixel,
                (feature) => feature.get('featureType') === 'link'
            );
            if (!linkFeature) {
                setMessage({type: "warn", text: "출구는 link 위에만 위치할 수 있습니다."});
                return;
            }
            const linkData = linkFeature.getProperties();
            const linkStart = fromLonLat([linkData.coordinates[0].lng, linkData.coordinates[0].lat]);
            const linkEnd = fromLonLat([linkData.coordinates[1].lng, linkData.coordinates[1].lat]);

            const {offset, offsetPosition} = projectPointOntoSegmentOl(linkStart, linkEnd, coord);

            geom.setCoordinates(offsetPosition)
            processAndStoreStation(<RailStationExitData>record, linkData.id, offset);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olModifyHandler = (e: ModifyEvent) => {
            olModifyend(e);

        }
        const cleanup = () => {
            try {
                olEventManager?.unbind(`modify:${featureType}:end`, olModifyHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
        };

        const selectedGuid = useSelectionStore.getState().selectedGuid

        const modifyFeatures = new Collection<Feature>();
        const selected = filterFeaturesByKey(layer, selectedGuid) as Collection<Feature>;
        if (!selected || selected.getLength() === 0) {
            // 선택 없음
            return;
        }
        modifyFeatures.clear()
        selected.forEach(f => modifyFeatures.push(f))

        olEventManager?.bind(`modify:${featureType}:end`, olModifyHandler, {features: modifyFeatures});
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, {featureType: snapFeatureType})
        olEventManager?.bind(`snap:${featureType}`, olSnap, {features: snapFeatures ?? new Collection<Feature<Geometry>>});
        return cleanup;
    },
};

/**
 * 피처 타입에 따라 수정 이벤트를 바인딩하는 메인 함수
 * @param featureType 수정할 피처의 타입
 */
export const modifyFeatureEventHandlers = (
    featureType: keyof typeof modifyFeatureHandlersInternal | string
) => {
    if (!featureType) {
        console.warn("`featureType` 인자는 필수입니다.");
        return;
    }
    const handler = modifyFeatureHandlersInternal[featureType];
    if (!handler) {
        console.warn("등록되지 않은 featureType:", featureType);
        return;
    }

    return handler(featureType);
};