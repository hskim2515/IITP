import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Feature } from "ol";
import { Fill, Stroke, Style } from "ol/style";
import { LineString, Point } from "ol/geom";
import {
    FEATURE_TYPE,
    MENU_CODE,
    RAIL_STATION_EXIT_SNAP_FIELDS,
    RAIL_STATION_SNAP_FIELDS,
    RailStationData,
    RailStationExitData,
    RailStationExitFeature,
    RailStationExitSnapProperties,
    RailStationFeature,
    RailStationSnapProperties,
    TRANSIT_MODE
} from "@type/Station";
import { fromLonLat, toLonLat } from "ol/proj";
import { findFeatureByProperties, getCoordinateByOffset, getOffsetByCoordinate } from "@utils/feature";
import { Coordinate } from "ol/coordinate";
import Geometry from "ol/geom/Geometry";
import { generateGUIDWithType } from "@utils/guid";
import { collectGuidsOfTargetAndChildren } from "@utils/json";
import { FeatureLayerAPI } from "@features/FeatureLayerAPI";
import CircleStyle from "ol/style/Circle";
import { FeatureLike } from "ol/Feature";
import deepEqual from "deep-equal";

export default class RailStationFeatureLayer extends VectorLayer implements FeatureLayerAPI {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation"

    private unsubscribe: () => void;

    constructor() {
        const source = new VectorSource();
        const layerManager = useLayerStore.getState().layerManager
        super({
            source,
            visible: false,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
            zIndex: 400,
        });
        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.source = source;
        const listener = (
            updated: Record<string, Array<RailStationData>>,
            origin: Record<string, Array<RailStationData>>
        ) => {
            if (!updated) {
                return;
            }

            Object.keys(updated).forEach((objectName) => {
                const updatedList = updated[objectName] ?? [];
                const originList = origin?.[objectName] ?? [];
                const updatedMap = new Map<string, RailStationData>();
                const originMap = new Map<string, RailStationData>();

                updatedList.forEach((item) => {
                    if (item.__guid) updatedMap.set(item.__guid, item);
                });
                originList.forEach((item) => {
                    if (item.__guid) originMap.set(item.__guid, item);
                });

                const src = this.source;
                const existing = src.getFeatures();

                // 역 삭제 + 하위 exit도 함께 삭제
                originMap.forEach((originItem, guid) => {
                    const updatedItem = updatedMap.get(guid);

                    if (!updatedItem) {
                        // originList에서 자신 + 하위 객체의 guid들을 모두 수집
                        collectGuidsOfTargetAndChildren(originItem, guid)
                            // 해당 guid를 가진 모든 feature를 삭제
                            .forEach(guidToDelete => {
                                const feature = existing.find(f => f.get("__guid") === guidToDelete);
                                if (feature) {
                                    src.removeFeature(feature);
                                }
                            });
                    }
                });

                // 역 수정
                originMap.forEach((originItem, guid) => {
                    const updatedItem = updatedMap.get(guid);
                    if (updatedItem && !deepEqual(originItem, updatedItem)) {
                        const feature = existing.find(f => f.get("__guid") === guid);
                        if (feature) {
                            const dto = this.recordToDto(updatedItem, FEATURE_TYPE.RAIL_STATION);
                            if(!dto) return;
                            const coord = dto.coordinates?.[0];
                            if (coord?.lng != null && coord?.lat != null) {
                                feature.setGeometry(new Point(fromLonLat([coord.lng, coord.lat])));
                            }
                            feature.setProperties(dto);
                        }
                    }
                });

                // 역 추가
                updatedMap.forEach((item, guid) => {
                    const existsInOrigin = originMap.has(guid);
                    const existsInSource = existing.some(f => f.get("__guid") === guid);
                    if (!existsInOrigin && !existsInSource) {
                        const feature = this.createFeature(item);
                        if (feature) src.addFeature(feature);
                    }
                });

                // exits 비교
                updatedList.forEach((station) => {
                    const originStation = originList.find(o => o.__guid === station.__guid);
                    const updatedExits = station.exits ?? [];
                    const originExits = originStation?.exits ?? [];

                    const updatedExitMap = new Map<string, RailStationExitData>();
                    const originExitMap = new Map<string, RailStationExitData>();

                    updatedExits.forEach((exit) => {
                        if (exit.__guid) updatedExitMap.set(exit.__guid, exit);
                    });
                    originExits.forEach((exit) => {
                        if (exit.__guid) originExitMap.set(exit.__guid, exit);
                    });

                    // exit 삭제
                    originExitMap.forEach((oldExit, guid) => {
                        if (!updatedExitMap.has(guid)) {
                            const feature = existing.find(f => f.get("__guid") === guid);
                            if (feature) src.removeFeature(feature);
                        }
                    });

                    // exit 수정
                    originExitMap.forEach((oldExit, guid) => {
                        const newExit = updatedExitMap.get(guid);
                        if (newExit && !deepEqual(oldExit, newExit)) {
                            const feature = existing.find(f => f.get("__guid") === guid);
                            if (feature) {
                                const updated = this.createRailStationExitFeature(newExit);
                                if (updated?.getGeometry()) {
                                    feature.setGeometry(updated.getGeometry());
                                    feature.setProperties(updated.getProperties());
                                }
                            }
                        }
                    });

                    // exit 추가
                    updatedExitMap.forEach((newExit, guid) => {
                        const existsInOrigin = originExitMap.has(guid);
                        const existsInSource = existing.some(f => f.get("__guid") === guid);
                        if (!existsInOrigin && !existsInSource) {
                            const newFeature = this.createExitFeatureWithContext(newExit, station);
                            if (newFeature) src.addFeature(newFeature);
                        }
                    });
                });
            });
        };


        this.unsubscribe = store.subscribe(
            // 구독할 값: currentJsonData 배열
            state => state.currentJsonData,
            listener,
            {fireImmediately: true}
        );


    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const props = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        if (geom instanceof Point && props.featureType === "railStations") {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({color: "rgb(0,102,255)"}), // 빨간색
                        stroke: new Stroke({color: "rgba(0,0,0,0)", width: 1}),
                    }),
                })
            );
        }

        if (geom instanceof Point && props.featureType === "exits") {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({color: "rgb(153,0,255)"}), // 빨간색
                        stroke: new Stroke({color: "rgba(0,0,0,0)", width: 1}),
                    }),
                })
            );
        }

        if (geom instanceof LineString && props.featureType === "railStationCorridors") {
            styles.push(
                new Style({
                    stroke: new Stroke({color: '#56bf26', width: Math.min(6, 0.5 / resolution)}),
                })
            );
        }
        return styles;
    }


    public async load(): Promise<void> {

        const store = layerNameToStoreMap[this.LAYER_NAME]

        try {
            const {railStations} = store.getState().currentJsonData

            const featureBuffer: Feature[] = [];

            for (const railStation of railStations) {
                const {exits, ...station} = railStation;

                const stationFeature = this.createFeature(station);
                if (stationFeature) featureBuffer.push(stationFeature);

                for (const exit of exits ?? []) {
                    const exitFeature = this.createExitFeatureWithContext(exit, station);
                    if (exitFeature) {
                        featureBuffer.push(exitFeature);

                        // 연결 라인 추가
                        // const stationCoord = station.coordinates?.[0];
                        // const exitCoord = exitFeature.getGeometry()?.getCoordinates();
                        // if (stationCoord && exitCoord) {
                        //     const line = new LineString([
                        //         fromLonLat([stationCoord.lng!, stationCoord.lat!]),
                        //         exitCoord,
                        //     ]);
                        //     const lineFeature = new Feature<LineString>(line);
                        //     lineFeature.setProperties({
                        //         featureType: "railStationCorridors",
                        //         stationRef: station.id,
                        //         stationGuidRef: station.__guid,
                        //         exitRef: exit.id,
                        //         menuCode: MENU_CODE.RAIL_STATION
                        //     });
                        //     featureBuffer.push(lineFeature);
                        // }
                    }
                }
            }

            this.source.clear();
            this.source.addFeatures(featureBuffer);


        } catch (e) {
            console.error("RailStationLayer.load 에러:", e);
        }
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: RailStationData | RailStationExitData): Feature<Point> | undefined {
        switch (data.featureType) {
            case FEATURE_TYPE.RAIL_STATION:
                return this.createRailStationFeature(data as RailStationData);
            case FEATURE_TYPE.RAIL_STATION_EXIT:
                return this.createRailStationExitFeature(data as RailStationExitData);
            default:
                console.warn("[createFeature] 인자로 받은 data의 featureType이 올바르지 않습니다.");
                return undefined;
        }
    }

    /**
     * RailStationFeature 생성 (exits 제외)
     */
    private createRailStationFeature(data: RailStationData): Feature<Point> | undefined {
        const {exits, ...rest} = data; // exits 제거

        const props: RailStationFeature = {
            ...rest,
            transitMode: rest.transitMode ?? TRANSIT_MODE.SUBWAY,
            featureType: FEATURE_TYPE.RAIL_STATION,
            menuCode: MENU_CODE.RAIL_STATION
        };

        const coord = props.coordinates?.[0];
        const hasValidCoordinate = coord && typeof coord.lng === 'number' && typeof coord.lat === 'number';

        const geom = hasValidCoordinate
            ? new Point(fromLonLat([coord.lng!, coord.lat!]))
            : undefined;

        const feature = new Feature<Point>(geom);
        feature.setProperties(props);
        return feature;
    }

    /**
     * RailStationExitFeature 생성
     */
    private createRailStationExitFeature(data: RailStationExitData): Feature<Point> | undefined {
        const props: RailStationExitFeature = {
            ...data,
            featureType: FEATURE_TYPE.RAIL_STATION_EXIT,
            exitRef: data.id,
            menuCode: MENU_CODE.RAIL_STATION
        };

        // 스냅 기준 레이어에서 링크 기준 feature 찾기
        const baseLayer = useLayerStore.getState().layerManager?.getLayerByName(this.getSnapLayerKey());
        const baseFeature = findFeatureByProperties(baseLayer, {
            featureType: this.getSnapFeatureType(),
            linkRef: props.linkRef,
        });
        const offset = props.offset ?? 0;
        const coord = getCoordinateByOffset(baseFeature, offset);
        let geom: Point;
        if (coord) {
            const [lng, lat] = toLonLat(coord);
            props.coordinates[0] = {lng, lat};
            geom = new Point(fromLonLat([lng, lat]));
        } else {
            console.warn("[createRailStationExitFeature] 유효한 offset 좌표를 계산하지 못했습니다.", props);
            props.coordinates[0] = {lng: null, lat: null};
            geom = new Point([NaN, NaN]);
        }

        const feature = new Feature<Point>(geom);
        feature.setProperties(props);
        return feature;
    }

    public createExitFeatureWithContext(
        exit: RailStationExitData,
        station: RailStationData
    ): Feature<Point> | undefined {
        const enriched: RailStationExitData = {
            ...exit,
            exitRef: exit.id,
            menuCode: MENU_CODE.RAIL_STATION
        };

        return this.createFeature(enriched);
    }


    /**
     * Snap 된 일반 객체 Property 추출
     * @param record Snap 된 객체
     * @param featureType Snap 객체의 값을 기반으로 변경할 dto
     */
    public recordToSnapProperties(record: Record<string, unknown>, featureType: string): RailStationSnapProperties | RailStationExitSnapProperties | undefined {

        if (!featureType) {
            console.warn("snap한 객체를 FeatureType DTO에 맞게 변경하기 위해 featureType인자를 넣어주세요")
            return
        } else {
            switch (featureType) {
                case FEATURE_TYPE.RAIL_STATION:
                    return this.recordToRailStationSnapProperties(record);
                case FEATURE_TYPE.RAIL_STATION_EXIT:
                    return this.recordToRailStationExitSnapProperties(record);
                default:
                    console.warn("[createFeature] 인자로 받은 data의 featureType이 올바르지 않습니다.");
                    return undefined;
            }
            return
        }
    }

    public recordToRailStationSnapProperties(record: Record<string, unknown>): RailStationSnapProperties | undefined {
        const properties: Partial<RailStationSnapProperties> = {};
        RAIL_STATION_SNAP_FIELDS.forEach(field => {
            const v = record[field];
            if (v != null) {
                if (field === '__guid' || field === 'id') {
                    properties[field] = String(v); // string 유지
                } else {
                    properties[field] = Number(v); // 나머지는 number로 변환
                }
            }
        });
        if (Object.keys(properties).length === 0) {
            return undefined;
        }
        return properties as RailStationSnapProperties;
    }

    public recordToRailStationExitSnapProperties(record: Record<string, unknown>): RailStationExitSnapProperties | undefined {
        const properties: Partial<RailStationExitSnapProperties> = {};
        RAIL_STATION_EXIT_SNAP_FIELDS.forEach(field => {
            const v = record[field];
            if (v != null) {
                if (field === '__guid' || field === 'id') {
                    properties[field] = String(v); // string 유지
                } else {
                    properties[field] = Number(v); // 나머지는 number로 변환
                }
            }
        });
        if (Object.keys(properties).length === 0) {
            return undefined;
        }
        return properties as RailStationExitSnapProperties;
    }

    public getSnapLayerKey(): string {
        return "network"
    }

    public getSnapFeatureType(): string {
        return "link-edit";
    }

    public computeMetadata(
        targetFeature: Feature<Geometry>,
        basedProperties: Record<string, unknown> | undefined,
        fromCoord: Coordinate
    ): Record<string, unknown> {
        const offset = getOffsetByCoordinate(targetFeature, fromCoord);
        const [lng, lat] = toLonLat(fromCoord);

        const computeProperties: Record<string, unknown> = {
            ...(basedProperties ?? {}),
            offset: offset ?? null,
            coordinates: lng != null && lat != null ? [{lat, lng}] : [],
        };

        return computeProperties;
    }

    public recordToDto(record: RailStationFeature | RailStationExitFeature, featureType: string | undefined): RailStationData | RailStationExitData | undefined {
        switch (featureType) {
            case FEATURE_TYPE.RAIL_STATION:
                return this.recordToRailStationDto(record as RailStationFeature);
            case FEATURE_TYPE.RAIL_STATION_EXIT:
                return this.recordToRailStationExitDto(record as RailStationExitFeature);
            default:
                console.warn("[createFeature] 인자로 받은 data의 featureType이 올바르지 않습니다.");
                return undefined;
        }
    }

    public recordToRailStationDto(record: RailStationFeature): RailStationData {
        const {geometry, ...cleaned} = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(FEATURE_TYPE.RAIL_STATION)
        const dto = {
            ...(cleaned as unknown as Omit<RailStationData, "transitMode" | "featureType" | "__guid">),
            transitMode: TRANSIT_MODE.SUBWAY,
            featureType: FEATURE_TYPE.RAIL_STATION,
            __guid: guid
        } as RailStationData;
        return dto
    }

    public recordToRailStationExitDto(record: RailStationExitFeature): RailStationExitData {
        const {geometry, ...cleaned} = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(FEATURE_TYPE.RAIL_STATION_EXIT)
        const dto = {
            ...(cleaned as unknown as Omit<RailStationExitData, "transitMode" | "featureType" | "__guid">),
            featureType: FEATURE_TYPE.RAIL_STATION_EXIT,
            __guid: guid
        } as RailStationExitData;
        return dto
    }

    /**
     * Snap 속성을 기존 BusStationData에 병합
     */
    public snapPropertiesToDto<T extends object>(
        snapProperties: Omit<T, "id"> & {id?: string | number},
        baseDto: T
    ): T {
        const {id: _ignored, ...props} = snapProperties;
        return {
            ...baseDto,
            ...props,
        };
    }

    public createDto(featureType: string): RailStationData | RailStationExitData | undefined {
        switch (featureType) {
            case FEATURE_TYPE.RAIL_STATION:
                return this.createRailStationDto(featureType);
            case FEATURE_TYPE.RAIL_STATION_EXIT:
                return this.createRailStationExitDto(featureType);
            default:
                console.warn("[createFeature] 인자로 받은 data의 featureType이 올바르지 않습니다.");
                return undefined;
        }
    }

    public createRailStationDto(featureType: string): RailStationData {
        const guid = generateGUIDWithType(featureType);

        const dto: RailStationData = {
            __guid: guid,
            featureType: featureType,
            id: undefined,
            transitMode: TRANSIT_MODE.SUBWAY,
            linkRef: undefined,
            address: null,
            coordinates: [{
                lng: null,
                lat: null
            }],
            exits: null,
            menuCode: "RAIL_STATION",
        };

        return dto;
    }

    public createRailStationExitDto(featureType: string): RailStationExitData {
        const guid = generateGUIDWithType(featureType);

        const dto: RailStationExitData = {
            __guid: guid,
            featureType: FEATURE_TYPE.RAIL_STATION_EXIT,
            id: undefined,
            linkRef: null,
            exitRef: undefined,
            offset: null,
            accessTime: null,
            coordinates: [{
                lng: null,
                lat: null,
            }],
            menuCode: "RAIL_STATION",
        };

        return dto;
    }

    getDefaultStyle(): Style | undefined {
        return undefined;
    }

    getFeatureType(): string | undefined {
        return undefined;
    }

    getSelectStyle(): Style | undefined {
        return undefined;
    }
}