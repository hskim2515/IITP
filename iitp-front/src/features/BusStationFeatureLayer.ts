import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";

import {
    BUS_STATION_SNAP_FIELDS,
    BusStationData,
    BusStationSnapProperties,
    FEATURE_TYPE,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER,
    TRANSIT_MODE
} from "@type/Station";
import { generateTrafficTypesGUID } from "@utils/guid";
import { deepEqual } from "@utils/feature";

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "BUS_STATION";
    private unsubscribe: () => void;

    private readonly defaultStyle: Style;
    private readonly selectStyle: Style;
    private readonly modifyStyle: Style;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 410,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        this.source = source

        const store = menuCodeToStoreMap[this.LAYER_NAME];
        const listener = (
            updated: Record<string, Array<Record<string, unknown>>>,
            origin: Record<string, Array<Record<string, unknown>>>
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
                        feature.setProperties(dto);
                        feature.setGeometry(new Point(fromLonLat([dto.lng, dto.lat])));
                        feature.changed();
                    }
                });

                added.forEach((item) => {
                    const dto = this.recordToDto(item);
                    const feature = this.createFeature(dto);
                    src.addFeature(feature);
                    console.log(`[추가] __guid: ${dto.__guid}`);
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
        const store = menuCodeToStoreMap[this.LAYER_NAME];
        const { busStations } = store.getState().originData;

        const source = this.source;
        source.clear();

        const features = busStations.map((data) => this.createFeature(data));

        source.addFeatures(features);
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: BusStationData): Feature<Point> {
        const geom = new Point(fromLonLat([ data.lng, data.lat ]));
        const props: BusStationData = {
            ...data,
            transitMode: TRANSIT_MODE.BUS,
            featureType: FEATURE_TYPE.BUS_STATION,
        };
        const feature = new Feature<Point>(geom);
        feature.setProperties(props);
        return feature;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record: Record<string, unknown>): BusStationData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateTrafficTypesGUID(this.getFeatureType())
        const dto = {
            ...(cleaned as Omit<BusStationData, "transitMode" | "featureType" | "__guid">),
            transitMode: TRANSIT_MODE.BUS,
            featureType: FEATURE_TYPE.BUS_STATION,
            __guid: guid
        } as BusStationData;
        return dto
    }

    /**
     * 일반 객체 SnapProperty 추출
     */
    public recordToSnapProperties(record: Record<string, unknown>): BusStationSnapProperties | undefined {
        const properties = {} as BusStationSnapProperties;
        console.log("recordToSnapProperties featureType:::", record["featureType"])
        console.log("recordToSnapProperties record:::", record)
        console.log("recordToSnapProperties this.getSnapFeatureType():::", this.getSnapFeatureType())
        if (record["featureType"] == this.getSnapFeatureType()) {
            BUS_STATION_SNAP_FIELDS.forEach(field => {
                const v = record[field];
                if (v != null) {
                    if (field === '__guid' || field === 'id' || field.endsWith('Id')) {
                        properties[field] = String(v); // string 유지
                    } else {
                        properties[field] = Number(v); // 나머지는 number로 변환
                    }
                }
            });
        }
        return properties;
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

    public dispose(): void {
        this.unsubscribe();
        super.dispose();
    }

}
