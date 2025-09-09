import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

import {
    BUS_STATION_SNAP_FIELDS,
    BusPublicStationResponse,
    BusStationData,
    BusStationFeature,
    BusStationSnapProperties,
    FEATURE_TYPE,
    MENU_CODE,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER,
    TRANSIT_MODE
} from "@type/Station";
import { generateGUIDWithType } from "@utils/guid";
import { getOffsetByCoordinate } from "@utils/feature";
import { Coordinate } from "ol/coordinate";
import Geometry from "ol/geom/Geometry";
import { FeatureLayerAPI } from "@features/FeatureLayerAPI";
import { FeatureLike } from "ol/Feature";
import { useSchemaStore } from "@stores/useSchemaStore";
import { diff } from "deep-object-diff";

export default class BusStationFeatureLayer extends VectorLayer implements FeatureLayerAPI {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busStation";

    private readonly defaultStyle: Style;
    private readonly selectStyle: Style;
    private readonly modifyStyle: Style;

    private unsubscribe: (() => void) | undefined;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 410,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        this.source = source;

        this.load(); // 초기 로드
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load(); // 데이터가 변경되면 레이어를 다시 로드합니다.
                },
                { equalityFn: (a, b) => Object.keys(diff(a, b)).length === 0  }
            );
        }


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
        return this.selectStyle;
    }

    public getDefaultStyle() {
        return this.defaultStyle;
    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const geom = feature.getGeometry();
        const styles: Style[] = [];
        if (geom instanceof Point) {
            styles.push(
                new Style({
                    image: new CircleStyle({
                        radius: 6,
                        fill: new Fill({ color: "rgb(255,0,0)" }),
                        stroke: new Stroke({ color: "rgba(0,0,0,0)", width: Math.min(3, 0.5 / resolution) }),
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
        if (!store) return; // 스토어가 없으면 중단

        const busPublicStationResponse: BusPublicStationResponse = store.getState().currentJsonData;

        // 데이터가 없는 경우를 대비한 방어 코드
        if (!busPublicStationResponse || !busPublicStationResponse.busStations) {
            this.source.clear();
            return;
        }

        const busStations = busPublicStationResponse.busStations;
        const featureBuffer: Feature[] = [];

        for (const busStation of busStations) {
            const stationFeature = this.createFeature(busStation);
            if (stationFeature) featureBuffer.push(stationFeature);
        }

        this.source.clear();
        this.source.addFeatures(featureBuffer);
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: BusStationData): Feature | undefined {
        const { lines, ...rest } = data;
        const props: BusStationFeature = {
            ...rest,
            featureType: data.featureType,
            menuCode: MENU_CODE.BUS_STATION
        };

        const feature = new Feature();
        feature.setProperties(props);
        if (props.coordinates && props.coordinates.lng && props.coordinates.lat) {
            const point = new Point(fromLonLat([props.coordinates.lng, props.coordinates.lat]));
            feature.setGeometry(point);
        }
        return feature;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record): BusStationData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType());
        const dto = {
            ...(cleaned as Omit<BusStationData, "transitMode" | "featureType" | "__guid">),
            transitMode: TRANSIT_MODE.BUS,
            featureType: FEATURE_TYPE.BUS_STATION,
            __guid: guid
        } as BusStationData;
        return dto;
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
        return {
            ...baseDto,
            ...snapProperties
        };
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
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        super.dispose();
    }
}