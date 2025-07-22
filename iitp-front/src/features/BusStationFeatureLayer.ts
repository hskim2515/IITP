import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";

import {
    BUS_STATION_SNAP_FIELDS,
    BusStationData, BusStationFeature,
    BusStationSnapProperties,
    FEATURE_TYPE,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER,
    TRANSIT_MODE
} from "@type/Station";
import { generateGUIDWithType } from "@utils/guid";
import { deepEqual } from "@utils/json";
import {
    findFeatureByProperties,
    getCoordinateByOffset,
    getFeaturesByProperties,
    getOffsetByCoordinate
} from "@utils/feature";
import { useLayerStore } from "@stores/useLayerStore";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import BaseLayer from "ol/layer/Base";
import { Coordinate } from "ol/coordinate";
import GeometryType from "@type/FeatureOptions";
import Geometry from "ol/geom/Geometry";

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busStation";
    private unsubscribe: () => void;

    private readonly defaultStyle: Style;
    private readonly selectStyle: Style;
    private readonly modifyStyle: Style;

    constructor() {
        const source = new VectorSource();
        const layerManager = useLayerStore.getState().layerManager
        super({
            source,
            visible: false,
            zIndex: 410,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        this.source = source

        const store = layerNameToStoreMap[this.LAYER_NAME];
        const listener = (
            updated: Record<string, Array<BusStationData>>,
            origin: Record<string, Array<BusStationData>>
        ) => {
            Object.keys(updated).forEach((objectName) => {
                const updatedList = updated[objectName] ?? [];
                const originList = origin[objectName] ?? [];

                const updatedMap = new Map<string, Record<string, unknown>>();
                const originMap = new Map<string, Record<string, unknown>>();

                updatedList.forEach((item) => {
                    const guid = item?.__guid as string;
                    if (guid) updatedMap.set(guid, item);
                });

                originList.forEach((item) => {
                    const guid = item?.__guid as string;
                    if (guid) originMap.set(guid, item);
                });

                const added: Record<string, unknown>[] = [];
                const removed: Record<string, unknown>[] = [];
                const changed: Record<string, unknown>[] = [];

                originMap.forEach((originItem, guid) => {
                    const updatedItem = updatedMap.get(guid);
                    if (!updatedItem) {
                        removed.push(originItem);
                    } else if (!deepEqual(originItem, updatedItem)) {
                        changed.push(updatedItem);
                    }
                });

                updatedMap.forEach((updatedItem, guid) => {
                    if (!originMap.has(guid)) {
                        added.push(updatedItem);
                    }
                });

                const src = this.source;
                const existing = src.getFeatures();

                removed.forEach((item) => {
                    const guid = item.__guid;
                    const feature = existing.find(f => f.get("__guid") === guid);
                    if (feature) {
                        src.removeFeature(feature);
                    }
                });

                changed.forEach((item) => {
                    const dto = this.recordToDto(item);

                    const feature = existing.find(f => f.get("__guid") === dto.__guid);
                    if (feature) {
                        const baseLayer = layerManager?.getLayerByName(this.getSnapLayerKey())
                        const baseFeature = findFeatureByProperties(baseLayer,{
                            featureType: this.getSnapFeatureType(),
                            linkRef: item.linkRef,
                            laneRef: item.laneRef ?? 0,
                        })

                        const offset = item.offset ?? 0
                        const coord = getCoordinateByOffset(baseFeature, offset)
                        if (coord) {
                            const [ lng, lat ] = toLonLat(coord)
                            // 계산한 값을 json에 적용
                            item.coordinates.lng = lng
                            item.coordinates.lat = lat
                            feature.setGeometry(new Point(fromLonLat([lng, lat])));
                        }

                        feature.setProperties(dto);
                    }
                });

                added.forEach((item) => {
                    const dto = this.recordToDto(item);
                    const feature = this.createFeature(dto);
                    src.addFeature(feature);
                });
            });
        };

        this.unsubscribe = store.subscribe(
            // 구독할 값: currentJsonData 배열
            state => state.currentJsonData,
            listener,
            { fireImmediately: true }
        );

        this.defaultStyle = new Style({
            image: new CircleStyle({
                radius: 6,
                fill: new Fill({ color: "rgba(255, 0, 0, 1)" }), // 빨간색
                stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
            }),
        });

        this.selectStyle = new Style({
            image: new CircleStyle({
                radius: 8,
                fill: new Fill({ color: "rgba(0, 255, 0, 1)" }), // 초록색
                stroke: new Stroke({ color: "rgba(255, 0, 0, 1)", width: 2 }),
            }),
        });

        this.modifyStyle = new Style({
            image: new CircleStyle({
                radius: 8,
                fill: new Fill({ color: "rgba(255, 255, 0, 1)" }), // 노란색
                stroke: new Stroke({ color: "rgba(0, 0, 0, 1)", width: 2 }),
            }),
        });


    }

    public getSelectStyle() {
        return this.selectStyle
    }
    public getDefaultStyle() {
        return this.defaultStyle
    }
    public getInteractionStyle(type: "default" | "select" | "modify"): Style {
        switch (type) {
            case "select":
                return this.selectStyle;
            case "modify":
                return this.modifyStyle;
            case "default":
            default:
                return this.defaultStyle;
        }
    }

    private styleFunction(feature: Feature<Point>, resolution: number): Style[] {
        const geom = feature.getGeometry();
        const styles: Style[] = [];
        if (geom instanceof Point) {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({ color: "rgba(255,0,0,1)" }),
                        stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
                    }),
                })
            );
        }
        return styles;
    }

    /**
     * 스토어의 DTO 배열로부터 피처 생성 후 source에 추가
     */
    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const { busStations } = store.getState().currentJsonData;

        const source = this.source;
        source.clear();

        const features = busStations.map((data) => this.createFeature(data));

        source.addFeatures(features);
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: BusStationData): Feature<Point> | undefined {
        const props: BusStationFeature = {
            ...data,
            transitMode: data.transitMode ?? TRANSIT_MODE.BUS,
            featureType: data.featureType ?? FEATURE_TYPE.BUS_STATION,
        };
        const coord = data.coordinates[0];
        const hasValidCoordinate = typeof coord.lng === 'number' && typeof coord.lat === 'number';

        const geom = hasValidCoordinate ? new Point(fromLonLat([coord.lng!, coord.lat!])) : undefined;

        const feature = new Feature<Point>(geom);
        feature.setProperties(props);

        return feature;
    }

    public createDto(): BusStationData {
        const guid = generateGUIDWithType(this.getFeatureType());

        const dto: BusStationData = {
            id: undefined,
            __guid: guid,
            featureType: FEATURE_TYPE.BUS_STATION,
            transitMode: TRANSIT_MODE.BUS,
            linkRef: null,
            laneRef: null,
            offset: null,
            coordinates: [{
                lng: null,
                lat: null,
            }],
            type: null,
            address: '',
            parkingLots: null,
            menuCode: "BUS_STATION",
        };

        return dto;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record: BusStationFeature): BusStationData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType())
        const dto = {
            ...(cleaned as Omit<BusStationData, "transitMode" | "featureType" | "__guid">),
            transitMode: TRANSIT_MODE.BUS,
            featureType: FEATURE_TYPE.BUS_STATION,
            __guid: guid
        } as BusStationData;
        return dto
    }

    /**
     * Snap 된 일반 객체 Property 추출
     */
    public recordToSnapProperties(record: Record<string, unknown>): BusStationSnapProperties | undefined {
        if (record["featureType"] !== this.getSnapFeatureType()) return;

        const properties: Partial<BusStationSnapProperties> = {};

        BUS_STATION_SNAP_FIELDS.forEach(field => {
            const v = record[field];
            if (v != null) {
                if (field === '__guid' || field === 'id') {
                    properties[field] = String(v); // string 유지
                } else {
                    properties[field] = Number(v); // 나머지는 number로 변환
                }
            }
        });

        // 아무 필드도 채워지지 않았다면 undefined 반환
        if (Object.keys(properties).length === 0) {
            return undefined;
        }

        return properties as BusStationSnapProperties;
    }


    /**
     * Snap 속성을 기존 BusStationData에 병합
     */
    public snapPropertiesToDto(
        snapProperties: BusStationSnapProperties,
        baseDto: BusStationData
    ): BusStationData {
        const { id: ignored, ...props } = snapProperties
        return {
            ...baseDto,
            ...props
        };
    }


    public getBusStationTransitMode(): string {
        return TRANSIT_MODE.BUS;
    }

    /**
     * Snap 대상 레이어 키
     */
    public getSnapLayerKey(): string {
        return SNAP_LAYER;
    }

    /**
     * Snap 대상 featureType
     */
    public getSnapFeatureType(): string {
        return SNAP_FEATURE_TYPE;
    }

    public getFeatureType(): string {
        return FEATURE_TYPE.BUS_STATION;
    }

    public getGeometryType(featureType: string): GeometryType {
        switch (featureType){
            case "busStations" :
                return GeometryType.POINT
            default:
                return GeometryType.POINT
        }
    }

    /**
     * offset 계산 로직
     */
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
            coordinates: lng != null && lat != null ? [{ lat, lng }] : [],
        };

        return computeProperties;
    }

    public dispose(): void {
        this.unsubscribe();
        super.dispose();
    }

}
