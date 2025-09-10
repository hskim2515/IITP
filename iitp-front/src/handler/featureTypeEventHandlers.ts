import * as Cesium from "cesium";
import { Viewer } from "cesium";
import { useEventStore } from "@stores/useEventStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { BusStationData, RailStationData, RailStationExitData } from "@type/Station";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useBusStationHistoryStore, useBusStationStore } from "@stores/useBusStationStore";
import { fromLonLat, toLonLat } from "ol/proj";
import { Geometry, LineString } from "ol/geom";
import Feature from "ol/Feature";
import { Map as OLMap, MapBrowserEvent } from "ol";
import { useRailStationHistoryStore, useRailStationStore } from "@stores/useRailStationStore";

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

            record.geometry = {type: "Point", coordinates: [lon, lat, height]};

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

            record.geometry = {type: "LineString", coordinates: coords};

            const polylineEntity = new Cesium.Entity({
                id: record.__guid,
                polyline: {positions, width: 3, material: Cesium.Color.BLUE},
                properties: record,
            });

            dataSource.entities.add(polylineEntity);

            eventStore.unbind("LEFT_CLICK", onClick);
            eventStore.unbind("RIGHT_CLICK", onRightClick);

        };

        eventStore.bind("LEFT_CLICK", onClick);
        eventStore.bind("RIGHT_CLICK", onRightClick);
    },
    busStations: (record: Partial<BusStationData>) => {
        const processAndStoreStation = (record: BusStationData, linkRef, laneRef, offset, coordinates) => {
            const newStation: BusStationData = {
                ...record,
                coordinates,
                linkRef,
                laneRef,
                offset,
            } as BusStationData;

            const {updateCurrentJsonData} = useBusStationStore.getState();
            const historyStore = useBusStationHistoryStore;
            updateCurrentJsonData(newStation, historyStore);

            setMessage({
                type: "info",
                text: `버스정류장이 추가되었습니다.`,
            });
        };

        const handleCesiumClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent, record, viewer, processAndStoreStation) => {

            const pickedObjects = viewer.scene.drillPick(e.position);
            const laneObject = pickedObjects?.find(p => p.id instanceof Cesium.Entity && p.id.id.startsWith("lanes-"));

            if (!laneObject) {
                setMessage({type: "warn", text: "정류장은 차선 위에만 추가할 수 있습니다."});
                return;
            }

            const userClickPosition = viewer.scene.pickPosition(e.position);
            if (!userClickPosition) return;

            const entity = laneObject.id;
            const laneData = entity.properties.getValue(viewer.clock.currentTime);
            const network = useNetworkStore.getState().currentJsonData;
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const laneStart = laneData.laneSource;
            const laneEnd = laneData.laneTarget;
            const laneVector = Cesium.Cartesian3.subtract(laneEnd, laneStart, new Cesium.Cartesian3());
            const clickVector = Cesium.Cartesian3.subtract(userClickPosition, laneStart, new Cesium.Cartesian3());
            const dotProduct = Cesium.Cartesian3.dot(clickVector, laneVector);
            const magnitudeSquared = Cesium.Cartesian3.magnitudeSquared(laneVector);
            let t = dotProduct / magnitudeSquared;
            t = Math.max(0, Math.min(1, t));

            const scaledLaneVector = Cesium.Cartesian3.multiplyByScalar(laneVector, t, new Cesium.Cartesian3());
            const centerlinePosition = Cesium.Cartesian3.add(laneStart, scaledLaneVector, new Cesium.Cartesian3());

            const offset = Cesium.Cartesian3.distance(laneStart, centerlinePosition);
            const carto = Cesium.Cartographic.fromCartesian(centerlinePosition);

            processAndStoreStation(
                record,
                parentLink.id,
                laneData.id,
                offset,
                {lng: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude)}
            );
        };

        const handleOpenLayersClick = (e: MapBrowserEvent<UIEvent>, record, olMap, processAndStoreStation) => {

            let laneFeature: Feature | undefined;

            olMap.forEachFeatureAtPixel(e.pixel, (feature: Feature<Geometry>) => {
                if (feature.get('__guid')?.startsWith('lanes-')) {
                    laneFeature = feature as Feature;
                    return true;
                }
                return false;
            });

            if (!laneFeature) {
                setMessage({type: "warn", text: "정류장은 차선 위에만 추가할 수 있습니다."});
                return;
            }

            const laneData = laneFeature.getProperties();
            let centerlineGeom: LineString;
            const geometry = laneFeature.getGeometry();

            if (geometry instanceof LineString) {
                centerlineGeom = geometry;
            } else {
                const source = laneData.laneSource;
                const target = laneData.laneTarget;
                if (!source || !target) {
                    setMessage({type: "error", text: "차선 중심선 정보를 찾을 수 없습니다."});
                    return;
                }
                centerlineGeom = new LineString([source, target]);
            }

            const centerlineCoord = centerlineGeom.getClosestPoint(e.coordinate);
            const network = useNetworkStore.getState().currentJsonData;
            const parentLink = network.links.find(link => link.lanes.some(lane => lane.__guid === laneData.__guid));

            if (!parentLink) {
                setMessage({type: "error", text: "링크 정보를 찾는 데 실패했습니다."});
                return;
            }

            const offset = new LineString([centerlineGeom.getFirstCoordinate(), centerlineCoord]).getLength();
            const lonLat = toLonLat(centerlineCoord);

            processAndStoreStation(
                record,
                parentLink.id,
                laneData.id,
                offset,
                {lng: lonLat[0], lat: lonLat[1]}
            );
        };

        setMessage({
            type: "info",
            text: "지도 위의 차선을 클릭하여 정류장을 추가하세요.",
        });

        const eventStore = useEventStore.getState();

        // [개선] 맵 타입에 따른 핸들러 맵(객체) 정의
        const mapClickHandlers = {
            cesium: (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => handleCesiumClick(e, record, useCesiumStore.getState().viewer, processAndStoreStation),
            ol: (e: MapBrowserEvent<UIEvent>) => handleOpenLayersClick(e, record, useOpenLayersStore.getState().map, processAndStoreStation),
        };

        const unifiedClickHandler = (e: any) => {
            // 현재 활성화된 맵 타입을 가져옴
            const activeMap = useEventStore.getState().activeMap;

            // 이벤트 핸들러 해제
            eventStore.unbind('singleclick', unifiedClickHandler);

            // 맵 타입에 맞는 핸들러를 찾아 실행
            const handler = mapClickHandlers[activeMap];
            if (handler) {
                handler(e);
            } else {
                console.warn(`[busStations] activeMap '${activeMap}'에 대한 핸들러가 없습니다.`);
            }
        };

        eventStore.bind('singleclick', unifiedClickHandler);
    },
    railStations: (record: Partial<RailStationData>) => {
        const processAndStoreStation = (record: Partial<RailStationData>, coordinates) => {
            const newStation: RailStationData = {
                ...record,
                coordinates,
            } as RailStationData;

            const {updateCurrentJsonData} = useRailStationStore.getState();
            const historyStore = useRailStationHistoryStore;
            updateCurrentJsonData(newStation, historyStore);

            setMessage({
                type: "info",
                text: `철도정류장이 추가되었습니다.`,
            });
        };

        const handleCesiumClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent, record: Partial<RailStationData>, viewer: Viewer, processAndStoreStation) => {

            const cartesian = viewer.scene.pickPosition(e.position);
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const coordinates = {
                lng: Cesium.Math.toDegrees(carto.longitude),
                lat: Cesium.Math.toDegrees(carto.latitude)
            };

            processAndStoreStation(record, coordinates);
        };

        const handleOpenLayersClick = (e: MapBrowserEvent<UIEvent>, record: Partial<RailStationData>, olMap: OLMap | null, processAndStoreStation) => {
            // 특정 피처를 찾을 필요 없이, 클릭 이벤트의 맵 좌표를 바로 사용합니다.
            const coordinate = e.coordinate;

            // 좌표를 경도/위도(EPSG:4326)로 변환
            const lonLat = toLonLat(coordinate);
            const coordinates = { lng: lonLat[0], lat: lonLat[1] };

            processAndStoreStation(record, coordinates);
        };

        // --- 4. 이벤트 등록 및 관리 로직 (기존 구조 유지) ---
        setMessage({
            type: "info",
            text: "지도 위에 철도 정류장 위치를 클릭하여 점을 찍어주세요.",
        });

        const eventStore = useEventStore.getState();

        const mapClickHandlers = {
            cesium: (e) => handleCesiumClick(e, record, useCesiumStore.getState().viewer, processAndStoreStation),
            ol: (e) => handleOpenLayersClick(e, record, useOpenLayersStore.getState().map, processAndStoreStation),
        };

        const unifiedClickHandler = (e: any) => {
            const activeMap = useEventStore.getState().activeMap;

            eventStore.unbind('singleclick', unifiedClickHandler);

            const handler = mapClickHandlers[activeMap];
            if (handler) {
                handler(e);
            } else {
                console.warn(`[railStations] activeMap '${activeMap}'에 대한 핸들러가 없습니다.`);
            }
        };

        eventStore.bind('singleclick', unifiedClickHandler);
    },
    exits: (record: Partial<RailStationExitData>) => {
        console.log("record:::", record)
        // 1. [수정] 부모 RailStation을 찾아 exit를 추가하고 스토어를 업데이트하는 함수
        const processAndStoreExit = (record, linkRef, offset, coordinates) => {
            const { currentJsonData, updateCurrentJsonData } = useRailStationStore.getState();
            const historyStore = useRailStationHistoryStore;
            if(!currentJsonData) return;
            // 새로운 출구 데이터를 완성합니다.
            const newExit: RailStationExitData = {
                ...record,
                linkRef,
                offset,
                coordinates,
            } as RailStationExitData;




            // 최종적으로 업데이트된 전체 데이터를 스토어에 저장합니다.
            updateCurrentJsonData(newExit, historyStore);

            setMessage({
                type: "info",
                text: `철도 정류장 출구가 추가되었습니다.`,
            });
        };

        // --- 2. Cesium/OpenLayers 핸들러 (대상을 link로 변경) ---

        const handleCesiumClick = (e, record, viewer, processAndStoreExit) => {
            const pickedObjects = viewer.scene.drillPick(e.position);
            // [수정] 'lanes-' 대신 'links-' guid를 가진 Entity를 찾습니다 (link의 guid 규칙에 따라 조정 필요).
            const linkObject = pickedObjects?.find(p => p.id instanceof Cesium.Entity && p.id.id.startsWith("links-"));

            if (!linkObject) {
                setMessage({ type: "warn", text: "출구를 추가할 링크(도로)를 클릭해주세요." });
                return;
            }

            const userClickPosition = viewer.scene.pickPosition(e.position);
            if (!userClickPosition) return;

            const linkEntity = linkObject.id;
            const linkData = linkEntity.properties.getValue(viewer.clock.currentTime);

            // 링크의 시작점과 끝점 좌표를 Cartesian3로 변환
            const linkStart = Cesium.Cartesian3.fromDegrees(linkData.coordinates[0].lng, linkData.coordinates[0].lat);
            const linkEnd = Cesium.Cartesian3.fromDegrees(linkData.coordinates[1].lng, linkData.coordinates[1].lat);

            // --- Vector Projection Calculation (Not Omitted) ---
            const linkVector = Cesium.Cartesian3.subtract(linkEnd, linkStart, new Cesium.Cartesian3());
            const clickVector = Cesium.Cartesian3.subtract(userClickPosition, linkStart, new Cesium.Cartesian3());
            const dotProduct = Cesium.Cartesian3.dot(clickVector, linkVector);
            const magnitudeSquared = Cesium.Cartesian3.magnitudeSquared(linkVector);

            let t = dotProduct / magnitudeSquared;
            // Clamp t to ensure the point lies on the line segment
            t = Math.max(0, Math.min(1, t));

            const scaledLinkVector = Cesium.Cartesian3.multiplyByScalar(linkVector, t, new Cesium.Cartesian3());
            const centerlinePosition = Cesium.Cartesian3.add(linkStart, scaledLinkVector, new Cesium.Cartesian3());
            // --- End of Calculation ---
            const offset = Cesium.Cartesian3.distance(linkStart, centerlinePosition);
            const carto = Cesium.Cartographic.fromCartesian(centerlinePosition);

            processAndStoreExit(
                record,
                linkData.id,
                offset,
                { lng: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
            );
        };

        const handleOpenLayersClick = (e, record, olMap, processAndStoreExit) => {
            let linkFeature: Feature | undefined;
            olMap.forEachFeatureAtPixel(e.pixel, (feature) => {
                // [수정] 'lanes-' 대신 'links-' guid를 가진 Feature를 찾습니다.
                if (feature.get('__guid')?.startsWith('links-')) {
                    linkFeature = feature as Feature;
                    return true;
                }
                return false;
            });

            if (!linkFeature) {
                setMessage({ type: "warn", text: "출구를 추가할 링크(도로)를 클릭해주세요." });
                return;
            }

            const linkData = linkFeature.getProperties();
            // 링크 피처의 좌표(lon/lat) 목록으로부터 중심선 LineString 생성
            const linkCoords = linkData.coordinates.map(c => fromLonLat([c.lng, c.lat]));
            const centerlineGeom = new LineString(linkCoords);

            const centerlineCoord = centerlineGeom.getClosestPoint(e.coordinate);
            const offset = new LineString([centerlineGeom.getFirstCoordinate(), centerlineCoord]).getLength();
            const lonLat = toLonLat(centerlineCoord);

            processAndStoreExit(
                record,
                linkData.id,
                offset,
                { lng: lonLat[0], lat: lonLat[1] }
            );
        };

        // --- 3. 이벤트 등록 및 관리 로직 (기존 구조와 동일) ---
        setMessage({
            type: "info",
            text: "지도 위에 출구가 위치할 링크(도로)를 클릭하세요.",
        });

        const eventStore = useEventStore.getState();

        const mapClickHandlers = {
            cesium: (e) => handleCesiumClick(e, record, useCesiumStore.getState().viewer, processAndStoreExit),
            ol: (e) => handleOpenLayersClick(e, record, useOpenLayersStore.getState().map, processAndStoreExit),
        };
        const unifiedClickHandler = (e: any) => {
            // 현재 활성화된 맵 타입을 가져옴
            const activeMap = useEventStore.getState().activeMap;
            eventStore.unbind('singleclick', unifiedClickHandler);
            const handler = mapClickHandlers[activeMap];
            if (handler) {
                handler(e);
            } else {
                console.warn(`[busStations] activeMap '${activeMap}'에 대한 핸들러가 없습니다.`);
            }
        };
        eventStore.bind('singleclick', unifiedClickHandler);
    },
};

export const featureTypeEventHandlers = (record) => {
    if (!record.featureType) {
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
