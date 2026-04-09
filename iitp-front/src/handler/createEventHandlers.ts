import * as Cesium from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { BusStationData, RailStationData, RailStationExitData } from "@type/Station";
import { useNetworkStore, useNetworkHistoryStore } from "@stores/useNetworkStore";
import { useBusStationHistoryStore, useBusStationStore } from "@stores/useBusStationStore";
import { fromLonLat } from "ol/proj";
import { useRailStationHistoryStore, useRailStationStore } from "@stores/useRailStationStore";
import { Coordinates } from "@type/openapi.gen";
import { projectPointOntoSegmentCesium, projectPointOntoSegmentOl } from "@utils/offset";
import { pickFromCesium, pickFromOpenLayers } from "@utils/pick";
import { createCoordinatesFromCesium, createCoordinatesFromOl } from "@utils/coordinates";
import { getFeaturesByProperties } from "@utils/feature";
import Collection from "ol/Collection";
import Feature from "ol/Feature";
import Geometry from "ol/geom/Geometry";
import { useLayerStore } from "@stores/useLayerStore";
import { DrawEvent } from "ol/interaction/Draw";
import Point from "ol/geom/Point";
import GeometryType from "@type/FeatureOptions";
import {PavementMarkingData} from "@type/PavementMarking";
import {usePavementMarkingHistoryStore, usePavementMarkingStore} from "@stores/usePavementMarkingStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";
import { useSignalStore, useSignalHistoryStore } from "@stores/useSignalStore";
import { useSelectionStore } from "@stores/useSelectionStore";

const setMessage = useMessageStore.getState().setMessage;

/** 공간 정보 없이 테이블에 직접 레코드를 추가하는 공통 헬퍼 */
function addTabularRecord(record: Record<string, any>): void {
    const layerName: string = record.layerName;
    if (!layerName) {
        setMessage({ type: "error", text: "레이어 정보가 없습니다." });
        return;
    }
    const store = layerNameToStoreMap[layerName];
    const historyStore = layerNameToHistoryStoreMap[layerName];
    if (!store) {
        setMessage({ type: "error", text: `스토어를 찾을 수 없습니다: ${layerName}` });
        return;
    }
    store.getState().updateCurrentJsonData(record, historyStore as any);
    // 추가 후 해당 행으로 포커스 이동 (GridTable의 selectedGuid 기반 스크롤)
    if (record.__guid) {
        setTimeout(() => useSelectionStore.getState().setSelectedGuid([record.__guid]), 50);
    }
    setMessage({ type: "info", text: "항목이 추가되었습니다. 테이블에서 값을 편집하세요." });
}

const featureTypeHandlersInternal = {
    nodes: (record: Record<string, any>) => {
        // network 이외의 레이어(e.g. signalTod)는 테이블에 직접 추가
        if (record.layerName && record.layerName !== 'network') {
            addTabularRecord(record);
            return;
        }
        setMessage({
            type: "info",
            text: "지도 위에 node 위치를 클릭하여 점을 찍어주세요.",
        });

        const { olEventManager, cesiumEventManager } = useEventStore.getState();

        const processAndStoreNode = (lng: number, lat: number) => {
            const newNode: Record<string, any> = { ...record, coordinates: { lng, lat } };
            useNetworkStore.getState().updateCurrentJsonData(newNode, useNetworkHistoryStore);
            if (newNode.__guid) {
                setTimeout(() => useSelectionStore.getState().setSelectedGuid([newNode.__guid as string]), 50);
            }
            setMessage({ type: "info", text: `노드가 추가되었습니다. (${lng.toFixed(6)}, ${lat.toFixed(6)})` });
        };

        const olDrawend = (e: DrawEvent) => {
            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) return;
            const coord = geom.getCoordinates();
            const coordinates = createCoordinatesFromOl(coord);
            if (!coordinates || coordinates.lng == null || coordinates.lat == null) return;
            processAndStoreNode(coordinates.lng, coordinates.lat);
            e.target.abortDrawing();
        };

        const cesiumClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;
            const cartesian = viewer.scene.pickPosition(e.position);
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lng = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            processAndStoreNode(lng, lat);
        };

        const olDrawHandler = (e: DrawEvent) => {
            try { olDrawend(e); } finally { cleanup(); }
        };
        const cesiumClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try { cesiumClick(e); } finally { cleanup(); }
        };

        const cleanup = () => {
            try { olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler); } catch {}
            try { cesiumEventManager?.unbind("singleclick", cesiumClickHandler); } catch {}
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, { drawGeometryType: GeometryType.POINT });
        cesiumEventManager?.bind("singleclick", cesiumClickHandler);

        return cleanup;
    },
    links: (record: Record<string, any>) => {
        setMessage({
            type: "info",
            text: "지도 위에 링크 경로를 클릭하여 선을 그리세요. 우클릭으로 완료합니다.",
        });

        const { olEventManager, cesiumEventManager } = useEventStore.getState();
        const cesiumPositions: Cesium.Cartesian3[] = [];

        const processAndStoreLink = (coords: { lng: number; lat: number }[]) => {
            if (coords.length < 2) {
                setMessage({ type: "warn", text: "링크는 최소 2개 이상의 점이 필요합니다." });
                return;
            }
            const newLink: Record<string, any> = { ...record, coordinates: coords };
            useNetworkStore.getState().updateCurrentJsonData(newLink, useNetworkHistoryStore);
            if (newLink.__guid) {
                setTimeout(() => useSelectionStore.getState().setSelectedGuid([newLink.__guid as string]), 50);
            }
            setMessage({ type: "info", text: `링크가 추가되었습니다. (${coords.length}개 점)` });
        };

        const olDrawend = (e: DrawEvent) => {
            const geom = e.feature.getGeometry();
            if (!geom) return;
            // LineString geometry의 좌표를 {lng, lat} 배열로 변환
            const olCoords = (geom as any).getCoordinates?.() as [number, number][] | undefined;
            if (!olCoords || olCoords.length < 2) return;
            const coords = olCoords.map(([x, y]) => {
                const c = createCoordinatesFromOl([x, y]);
                return c ? { lng: c.lng, lat: c.lat } : null;
            }).filter(Boolean) as { lng: number; lat: number }[];
            processAndStoreLink(coords);
        };

        const cesiumLeftClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;
            const cartesian = viewer.scene.pickPosition(e.position);
            if (cartesian) cesiumPositions.push(cartesian);
        };

        const cesiumRightClick = () => {
            if (cesiumPositions.length < 2) {
                setMessage({ type: "warn", text: "링크는 최소 2개 이상의 점이 필요합니다." });
                return;
            }
            const coords = cesiumPositions.map((c) => {
                const carto = Cesium.Cartographic.fromCartesian(c);
                return {
                    lng: Cesium.Math.toDegrees(carto.longitude),
                    lat: Cesium.Math.toDegrees(carto.latitude),
                };
            });
            processAndStoreLink(coords);
            cleanup();
        };

        const olDrawHandler = (e: DrawEvent) => {
            try { olDrawend(e); } finally { cleanup(); }
        };

        const cleanup = () => {
            try { olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler); } catch {}
            try { cesiumEventManager?.unbind("singleclick", cesiumLeftClick); } catch {}
            try { cesiumEventManager?.unbind("rightClick", cesiumRightClick); } catch {}
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, { drawGeometryType: GeometryType.LINE_STRING });
        cesiumEventManager?.bind("singleclick", cesiumLeftClick);
        cesiumEventManager?.bind("rightClick", cesiumRightClick);

        return cleanup;
    },
    busStations: (record: BusStationData) => {
        const network = useNetworkStore.getState().currentJsonData;
        if (!network) {
            setMessage({type: "warn", text: "정류장을 추가할 네트워크가 존재하지 않습니다."});
            return;
        }

        const processAndStoreStation = (linkRef: number | string, laneRef: number | string, offset: number, coordinates: Coordinates) => {
            const newStation: BusStationData = {
                ...record,
                coordinates,
                linkRef,
                laneRef,
                offset,
            } as BusStationData;
            const {updateCurrentJsonData} = useBusStationStore.getState();
            updateCurrentJsonData(newStation, useBusStationHistoryStore);
            setMessage({type: "info", text: `버스정류장이 추가되었습니다.`});
        };

        const snapFeatureType = "lane-edit"
        const snapLayerName = "network"

        setMessage({type: "info", text: "지도 위의 차선을 클릭하여 정류장을 추가하세요."});

        const olDrawend = (e: DrawEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "정류장 Point가 없습니다."});
                return;
            }

            // coord 를 저장하는 것이 아니라 offset을 계산하여 저장함.

            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord)
            const laneFeature = pickFromOpenLayers(
                olMap,
                pixel,
                (feature) => feature.get('featureType')===('lanes')
            );

            if (!laneFeature) {
                setMessage({type: "warn", text: "정류장은 차선 위에만 추가할 수 있습니다."});
                return;
            }
            const laneData = laneFeature.getProperties();

            const laneStart = laneData.laneSource;
            const laneEnd = laneData.laneTarget;
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const {offset, offsetPosition} = projectPointOntoSegmentOl(laneStart, laneEnd, coord);
            const coordinates = createCoordinatesFromOl(offsetPosition)
            if (!coordinates) return;
            processAndStoreStation(parentLink.id, laneData.id, offset, coordinates);
            e.target.abortDrawing()
        }
        const cesiumSingleClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;

            const laneObject = pickFromCesium(
                viewer,
                e.position,
                (p) => p.id instanceof Cesium.Entity && p.id.properties.getValue().featureType === ("lanes")
            );

            if (!laneObject) {
                setMessage({type: "warn", text: "정류장은 차선 위에만 추가할 수 있습니다."});
                return;
            }

            const userClickPosition = viewer.scene.pickPosition(e.position);
            if (!userClickPosition) return;

            const entity = laneObject.id;
            const laneData = entity.properties.getValue(viewer.clock.currentTime);
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const {
                offset,
                offsetPosition
            } = projectPointOntoSegmentCesium(laneData.laneSource, laneData.laneTarget, userClickPosition);
            const coordinates = createCoordinatesFromCesium(offsetPosition)
            if (!coordinates) return;

            processAndStoreStation(parentLink.id, laneData.id, offset, coordinates);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olDrawHandler = (e: DrawEvent) => {
            try {
                olDrawend(e);
            } finally {
                cleanup();
            }
        }
        const cesiumSingleClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try {
                cesiumSingleClick(e)
            } finally {
                cleanup();
            }
        }

        const cleanup = () => {
            try {
                olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${record.featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
            try {
                cesiumEventManager?.unbind("singleclick", cesiumSingleClickHandler);
            } catch (error) {
                console.error(error)
            }
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, {drawGeometryType: GeometryType.POINT});
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, {featureType: snapFeatureType})
        olEventManager?.bind(`snap:${record.featureType}`, olSnap, {features: snapFeatures ?? new Collection<Feature<Geometry>>});
        cesiumEventManager?.bind("singleclick", cesiumSingleClickHandler);

        return cleanup;
    },
    railStations: (record: RailStationData) => {
        const processAndStoreStation = (coordinates: Coordinates) => {
            const newStation: RailStationData = {...record, coordinates} as RailStationData;
            const {updateCurrentJsonData} = useRailStationStore.getState();
            updateCurrentJsonData(newStation, useRailStationHistoryStore);
            setMessage({type: "info", text: `철도정류장이 추가되었습니다.`});
        };

        setMessage({type: "info", text: "지도 위에 철도 정류장 위치를 클릭하여 점을 찍어주세요."});

        const olDrawend = (e: DrawEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "정류장 Point가 없습니다."});
                return;
            }
            const coord = geom.getCoordinates();
            const coordinates = createCoordinatesFromOl(coord)
            if (!coordinates) return;
            processAndStoreStation(coordinates);

            e.target.abortDrawing()
        }

        const cesiumSingleClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;
            const cartesian = viewer.scene.pickPosition(e.position);
            if (!cartesian) return;

            const coordinates = createCoordinatesFromCesium(cartesian)
            if (!coordinates) return;

            processAndStoreStation(coordinates);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olDrawHandler = (e: DrawEvent) => {
            try {
                olDrawend(e);
            } finally {
                cleanup();
            }
        }

        const cesiumSingleClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try {
                cesiumSingleClick(e)
            } finally {
                cleanup();
            }
        }

        const cleanup = () => {
            try {
                olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                cesiumEventManager?.unbind("singleclick", cesiumSingleClickHandler);
            } catch (error) {
                console.error(error)
            }
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, {drawGeometryType: GeometryType.POINT});
        cesiumEventManager?.bind("singleclick", cesiumSingleClickHandler);
        return cleanup;
    },
    exits: (record: RailStationExitData) => {
        const network = useNetworkStore.getState().currentJsonData;
        if (!network) {
            setMessage({type: "warn", text: "출구를 추가할 네트워크가 존재하지 않습니다."});
            return;
        }

        const processAndStoreExit = (
            linkRef: string | number,
            offset: number,
            coordinates: Coordinates
        ) => {
            const {updateCurrentJsonData} = useRailStationStore.getState();
            const newExit: RailStationExitData = {...record, linkRef, offset, coordinates} as RailStationExitData;
            updateCurrentJsonData(newExit, useRailStationHistoryStore);
            setMessage({type: "info", text: `철도 정류장 출구가 추가되었습니다.`});
        };

        const snapFeatureType = "link-edit"
        const snapLayerName = "network"

        setMessage({type: "info", text: "지도 위에 출구가 위치할 링크(도로)를 클릭하세요."});

        const olDrawend = (e: DrawEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "출구 Point가 없습니다."});
                return;
            }
            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord)
            const linkFeature = pickFromOpenLayers(
                olMap,
                pixel,
                (feature) => feature.get('featureType')===('links')
            );
            if (!linkFeature) {
                setMessage({type: "warn", text: "정류장은 링크 위에만 추가할 수 있습니다."});
                return;
            }

            const linkData = linkFeature.getProperties();
            const linkStart = fromLonLat([linkData.coordinates[0].lng, linkData.coordinates[0].lat]);
            const linkEnd = fromLonLat([linkData.coordinates[1].lng, linkData.coordinates[1].lat]);

            const {offset, offsetPosition} = projectPointOntoSegmentOl(linkStart, linkEnd, coord);
            const coordinates = createCoordinatesFromOl(offsetPosition)
            if (!coordinates) return;
            processAndStoreExit(linkData.id, offset, coordinates);
            e.target.abortDrawing()
        }
        const cesiumSingleClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;

            const linkObject = pickFromCesium(
                viewer,
                e.position,
                (p) => p.id instanceof Cesium.Entity && p.id.id.startsWith("links-")
            );

            if (!linkObject) {
                setMessage({type: "warn", text: "출구를 추가할 링크(도로)를 클릭해주세요."});
                return;
            }

            const userClickPosition = viewer.scene.pickPosition(e.position);
            if (!userClickPosition) return;

            const linkEntity = linkObject.id;
            const linkData = linkEntity.properties.getValue(viewer.clock.currentTime);
            const linkStart = Cesium.Cartesian3.fromDegrees(linkData.coordinates[0].lng, linkData.coordinates[0].lat);
            const linkEnd = Cesium.Cartesian3.fromDegrees(linkData.coordinates[1].lng, linkData.coordinates[1].lat);

            const {offset, offsetPosition} = projectPointOntoSegmentCesium(linkStart, linkEnd, userClickPosition);
            const coordinates = createCoordinatesFromCesium(offsetPosition)
            if (!coordinates) return;
            processAndStoreExit(linkData.id, offset, coordinates);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();
        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olDrawHandler = (e: DrawEvent) => {
            try {
                olDrawend(e);
            } finally {
                cleanup();
            }
        }
        const cesiumSingleClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try {
                cesiumSingleClick(e)
            } finally {
                cleanup();
            }
        }

        const cleanup = () => {
            try {
                olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${record.featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
            try {
                cesiumEventManager?.unbind("singleclick", cesiumSingleClickHandler);
            } catch (error) {
                console.error(error)
            }
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, {drawGeometryType: GeometryType.POINT});
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, {featureType: snapFeatureType})
        olEventManager?.bind(`snap:${record.featureType}`, olSnap, {features: snapFeatures ?? new Collection<Feature<Geometry>>});
        cesiumEventManager?.bind("singleclick", cesiumSingleClickHandler);

        return cleanup;
    },
    pavementMarkings: (record:PavementMarkingData) => {
        const network = useNetworkStore.getState().currentJsonData;
        if (!network) {
            setMessage({type: "warn", text: "노면마킹을 추가할 네트워크가 존재하지 않습니다."});
            return;
        }
        const processAndStorepavementMarking = (linkRef: number | string, laneRef: number | string, offset: number, coordinates: Coordinates) => {
            const newPavementMarking: PavementMarkingData = {
                ...record,
                coordinates,
                linkRef,
                laneRef,
                offset,
            } as PavementMarkingData;
            const {updateCurrentJsonData} = usePavementMarkingStore.getState();
            updateCurrentJsonData(newPavementMarking, usePavementMarkingHistoryStore);
            setMessage({type: "info", text: `노면마킹이 추가되었습니다.`});
        };

        const snapFeatureType = "lane-edit"
        const snapLayerName = "network"

        setMessage({type: "info", text: "지도 위의 차선을 클릭하여 노면마킹을 추가하세요."});

        const olDrawend = (e: DrawEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;

            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) {
                setMessage({type: "error", text: "정류장 Point가 없습니다."});
                return;
            }
            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord)
            const laneFeature = pickFromOpenLayers(
                olMap,
                pixel,
                (feature) => feature.get('featureType')===('lanes')
            );

            if (!laneFeature) {
                setMessage({type: "warn", text: "노면마킹은 차선 위에만 추가할 수 있습니다."});
                return;
            }
            const laneData = laneFeature.getProperties();

            const laneStart = laneData.laneSource;
            const laneEnd = laneData.laneTarget;
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const {offset, offsetPosition} = projectPointOntoSegmentOl(laneStart, laneEnd, coord);
            const coordinates = createCoordinatesFromOl(offsetPosition)
            if (!coordinates) return;
            processAndStorepavementMarking(parentLink.id, laneData.id, offset, coordinates);
            e.target.abortDrawing()
        }
        const cesiumSingleClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;

            const laneObject = pickFromCesium(
                viewer,
                e.position,
                (p) => p.id instanceof Cesium.Entity && p.id.properties.getValue().featureType === ("lanes")
            );

            if (!laneObject) {
                setMessage({type: "warn", text: "노면마킹은 차선 위에만 추가할 수 있습니다."});
                return;
            }

            const userClickPosition = viewer.scene.pickPosition(e.position);
            if (!userClickPosition) return;

            const entity = laneObject.id;
            const laneData = entity.properties.getValue(viewer.clock.currentTime);
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const {
                offset,
                offsetPosition
            } = projectPointOntoSegmentCesium(laneData.laneSource, laneData.laneTarget, userClickPosition);
            const coordinates = createCoordinatesFromCesium(offsetPosition)
            if (!coordinates) return;

            processAndStorepavementMarking(parentLink.id, laneData.id, offset, coordinates);
        }

        const {olEventManager, cesiumEventManager} = useEventStore.getState();

        const olSnap = () => {
            // snap event 제거 시, 동일한 객체로 매핑하기 위한 참조
        };

        const olDrawHandler = (e: DrawEvent) => {
            try {
                olDrawend(e);
            } finally {
                cleanup();
            }
        }
        const cesiumSingleClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try {
                cesiumSingleClick(e)
            } finally {
                cleanup();
            }
        }

        const cleanup = () => {
            try {
                olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler);
            } catch (error) {
                console.error(error)
            }
            try {
                olEventManager?.unbind(`snap:${record.featureType}`, olSnap);
            } catch (error) {
                console.error(error)
            }
            try {
                cesiumEventManager?.unbind("singleclick", cesiumSingleClickHandler);
            } catch (error) {
                console.error(error)
            }
        };

        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, {drawGeometryType: GeometryType.POINT});
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, {featureType: snapFeatureType})
        olEventManager?.bind(`snap:${record.featureType}`, olSnap, {features: snapFeatures ?? new Collection<Feature<Geometry>>});
        cesiumEventManager?.bind("singleclick", cesiumSingleClickHandler);

        return cleanup;
    },

    /** 신호 추가: 교차로 노드를 클릭하여 신호 배치 */
    signals: (record: Record<string, any>) => {
        setMessage({ type: "info", text: "신호를 배치할 교차로 노드를 클릭하세요." });

        const { olEventManager, cesiumEventManager } = useEventStore.getState();

        const processAndStoreSignal = (nodeId: string | number) => {
            const newSignal: Record<string, any> = { ...record, nodeId: String(nodeId) };
            useSignalStore.getState().updateCurrentJsonData(newSignal, useSignalHistoryStore);
            if (newSignal.__guid) {
                setTimeout(() => useSelectionStore.getState().setSelectedGuid([newSignal.__guid as string]), 50);
            }
            setMessage({ type: "info", text: `신호가 추가되었습니다. (노드 ID: ${nodeId})` });
        };

        const olDrawend = (e: DrawEvent) => {
            const olMap = useOpenLayersStore.getState().map;
            if (!olMap) return;
            const geom = e.feature.getGeometry();
            if (!(geom instanceof Point)) return;
            const coord = geom.getCoordinates();
            const pixel = olMap.getPixelFromCoordinate(coord);
            const nodeFeature = pickFromOpenLayers(olMap, pixel, (f) => f.get('featureType') === 'nodes');
            if (!nodeFeature) {
                setMessage({ type: "warn", text: "네트워크 노드 위를 클릭해주세요." });
                return;
            }
            processAndStoreSignal(nodeFeature.get('id'));
            e.target.abortDrawing();
        };

        const cesiumClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            const viewer = useCesiumStore.getState().viewer;
            if (!viewer) return;
            const picked = pickFromCesium(
                viewer, e.position,
                (p) => p.id instanceof Cesium.Entity && p.id.properties?.getValue()?.featureType === 'nodes'
            );
            if (!picked) {
                setMessage({ type: "warn", text: "네트워크 노드를 클릭해주세요." });
                return;
            }
            const nodeData = picked.id.properties.getValue(viewer.clock.currentTime);
            processAndStoreSignal(nodeData.id);
        };

        const olDrawHandler = (e: DrawEvent) => {
            try { olDrawend(e); } finally { cleanup(); }
        };
        const cesiumClickHandler = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
            try { cesiumClick(e); } finally { cleanup(); }
        };
        const olSnap = () => {};

        const cleanup = () => {
            try { olEventManager?.unbind(`draw:${record.featureType}:end`, olDrawHandler); } catch {}
            try { olEventManager?.unbind(`snap:${record.featureType}`, olSnap); } catch {}
            try { cesiumEventManager?.unbind("singleclick", cesiumClickHandler); } catch {}
        };

        const snapLayerName = "network";
        olEventManager?.bind(`draw:${record.featureType}:end`, olDrawHandler, { drawGeometryType: GeometryType.POINT });
        const snapLayer = useLayerStore.getState().layerManager?.getLayerByName(snapLayerName);
        const snapFeatures = getFeaturesByProperties(snapLayer ?? undefined, { featureType: "nodes" });
        olEventManager?.bind(`snap:${record.featureType}`, olSnap, { features: snapFeatures ?? new Collection<Feature<Geometry>>() });
        cesiumEventManager?.bind("singleclick", cesiumClickHandler);

        return cleanup;
    },

    /** 버스 노선 추가: 테이블에 직접 추가 후 링크/노드 시퀀스 편집 */
    lines: (record: Record<string, any>) => {
        addTabularRecord(record);
    },

    /** 철도 노선 추가: 테이블에 직접 추가 후 역 시퀀스 편집 */
    routes: (record: Record<string, any>) => {
        addTabularRecord(record);
    },

    /** 시뮬레이션 시나리오 추가: 테이블에 직접 추가 후 편집 */
    scenarios: (record: Record<string, any>) => {
        addTabularRecord(record);
    },

    /** SignalTod plans 추가: 테이블에 직접 추가 */
    plans: (record: Record<string, any>) => {
        addTabularRecord(record);
    },
};

export const createEventHandlers = (record: Record<string, any>) => {
    const featureType: keyof typeof featureTypeHandlersInternal = record.featureType;
    if (!record.featureType) {
        console.warn("featureType 인자:", record.featureType)
        return;
    }
    const handler = featureTypeHandlersInternal[featureType];
    if (!handler) {
        console.warn("등록되지 않은 featureType:", record.featureType);
        return;
    }

    return handler(record as any);
};
