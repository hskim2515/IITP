import { useMessageStore } from "@stores/useMessageStore";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { findLayerByKeyValue } from "@utils/olLayer";
import { ModifyEvent } from "ol/interaction/Modify";
import Collection from "ol/Collection";
import { Feature } from "ol";
import {
    filterFeaturesByKey,
    getFeaturesByProperties,
    getFromToCoordinates,
    getSnapFeature,
    getValuesFromFeatures
} from "@utils/feature";
import { useSelectionStore } from "@stores/useSelectionStore";

const setMessage = useMessageStore.getState().setMessage;

// 3. 핸들러 맵의 타입을 정의 (Record 유틸리티 타입 사용)
const modifyFeatureHandlersInternal: Record<string, (record) => void> = {
    nodes: (record) => {
        const featureType = record.featureType

        const eventStore = useEventStore.getState();
        const olMap = useOpenLayersStore.getState().map;
        if(!olMap) return;
        const selectedGuid = useSelectionStore.getState().selectedGuid;
        const layer = findLayerByKeyValue(olMap, "LAYER_NAME", "network")
        const selectedFeatures = filterFeaturesByKey(layer, selectedGuid)
        const snapLayer = findLayerByKeyValue(olMap, "LAYER_NAME", "network")
        const snapFeatureType = ""

        const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;

        const onModifyEnd = (e: ModifyEvent) => {
            console.log("onModifyEnd")
            const features: Collection<Feature> = e.features;
            const modifiedIds = getValuesFromFeatures<string>(features, "__guid")
            setSelectedGuid(modifiedIds)

            const modifiedFeature = e.features.getArray()[0]
            const {fromCoord} = getFromToCoordinates(modifiedFeature)

            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            // const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)
            //
            // const featureType = modifiedFeature.get("featureType")
            //
            // if (!featureType) {
            //     console.warn('featureType이 비어 있습니다.');
            // }
            // const snapProperties = snapFeature
            //     ? layer.recordToSnapProperties(snapFeature.getProperties(), featureType)
            //     : undefined;
            //
            // const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord)
            //
            // const modifiedRecord = layer.recordToDto(modifiedFeature.getProperties(), featureType)
            // const dto = layer.snapPropertiesToDto(metadata, modifiedRecord)
            // console.log("modify snappedProperties dto:::", dto)
            // store.getState().updateCurrentJsonData(dto, historyStore);
        eventStore.unbind("modifyend", onModifyEnd);
        }
        eventStore.bind("modifyend", onModifyEnd);

    },
    links: (record) => {
        const featureType = record.featureType
        const eventStore = useEventStore.getState();
        const olMap = useOpenLayersStore.getState().map;
        if(!olMap) return;
        const selectedGuid = useSelectionStore.getState().selectedGuid;
        const layer = findLayerByKeyValue(olMap, "LAYER_NAME", "network")
        const selectedFeatures = filterFeaturesByKey(layer, selectedGuid)
        const snapLayer = findLayerByKeyValue(olMap, "LAYER_NAME", "network")
        const snapFeatureType = ""

        const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;
        const onModifyEnd = (e: ModifyEvent) => {
            const features: Collection<Feature> = e.features;
            const modifiedIds = getValuesFromFeatures<string>(features, "__guid")
            setSelectedGuid(modifiedIds)

            const modifiedFeature = e.features.getArray()[0]
            const {fromCoord} = getFromToCoordinates(modifiedFeature)
            if (typeof layer.recordToSnapProperties !== "function") {
                console.error("레이어 내부에 공통 메서드 recordToSnapProperties 작성 필요 ")
                return
            }
            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)

            const featureType = modifiedFeature.get("featureType")

            if (!featureType) {
                console.warn('featureType이 비어 있습니다.');
            }
            const snapProperties = snapFeature
                ? layer.recordToSnapProperties(snapFeature.getProperties(), featureType)
                : undefined;

            const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord)

            const modifiedRecord = layer.recordToDto(modifiedFeature.getProperties(), featureType)
            const dto = layer.snapPropertiesToDto(metadata, modifiedRecord)
            console.log("modify snappedProperties dto:::", dto)
            store.getState().updateCurrentJsonData(dto, historyStore);
        }
    },
    busStations: (record) => {
        const featureType = record.featureType
        const eventStore = useEventStore.getState();
        const olMap = useOpenLayersStore.getState().map;
        if(!olMap) return;
        const selectedGuid = useSelectionStore.getState().selectedGuid;
        const layer = findLayerByKeyValue(olMap, "LAYER_NAME", "busStations")
        const selectedFeatures = filterFeaturesByKey(layer, selectedGuid)
        const snapLayer = findLayerByKeyValue(olMap, "LAYER_NAME", "network")
        const snapFeatureType = "lane-edit"

        const setSelectedGuid = useSelectionStore.getState().setSelectedGuid;
        const onModifyEnd = (e: ModifyEvent) => {
            const features: Collection<Feature> = e.features;
            const modifiedIds = getValuesFromFeatures<string>(features, "__guid")
            setSelectedGuid(modifiedIds)

            const modifiedFeature = e.features.getArray()[0]
            const {fromCoord} = getFromToCoordinates(modifiedFeature)
            if (typeof layer.recordToSnapProperties !== "function") {
                console.error("레이어 내부에 공통 메서드 recordToSnapProperties 작성 필요 ")
                return
            }
            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)

            const featureType = modifiedFeature.get("featureType")

            if (!featureType) {
                console.warn('featureType이 비어 있습니다.');
            }
            const snapProperties = snapFeature
                ? layer.recordToSnapProperties(snapFeature.getProperties(), featureType)
                : undefined;

            const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord)

            const modifiedRecord = layer.recordToDto(modifiedFeature.getProperties(), featureType)
            const dto = layer.snapPropertiesToDto(metadata, modifiedRecord)
            console.log("modify snappedProperties dto:::", dto)
            store.getState().updateCurrentJsonData(dto, historyStore);
        }
    }
};

// 4. 핸들러 함수의 타입을 명시
export const modifyFeatureEventHandlers = (record) => {
    const handler = modifyFeatureHandlersInternal[record.featureType];

    // 이 경우 타입 시스템에 의해 handler가 항상 존재하지만,
    // 동적 데이터에 대비한 방어 코드는 여전히 유용합니다.
    if (!handler) {
        console.warn("등록되지 않은 featureType:", record.featureType);
        return;
    }

    handler(record);
};