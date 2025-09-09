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
    RailPublicStationResponse,
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
import { FeatureLayerAPI } from "@features/FeatureLayerAPI";
import CircleStyle from "ol/style/Circle";
import { FeatureLike } from "ol/Feature";
import { diff } from "deep-object-diff";

export default class RailStationFeatureLayer extends VectorLayer implements FeatureLayerAPI {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation"
    private unsubscribe: (() => void) | undefined;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 400,
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
            const railPublicStationResponse: RailPublicStationResponse | undefined = store.getState().currentJsonData
            if (!railPublicStationResponse) return;
            const railStations = railPublicStationResponse.railStations
            const featureBuffer: Feature[] = [];

            for (const railStation of railStations) {
                const exits = railStation.exits;
                const stationFeature = this.createFeature(railStation);
                if (stationFeature) featureBuffer.push(stationFeature);

                for (const exit of exits ?? []) {
                    const exitFeature = this.createExitFeatureWithContext(exit, railStation);
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
            featureType: FEATURE_TYPE.RAIL_STATION,
            menuCode: MENU_CODE.RAIL_STATION
        };

        if (!rest.coordinates.lng || !rest.coordinates.lat) return;
        const point = fromLonLat([rest.coordinates.lng, rest.coordinates.lat])
        const geom = new Point(point)

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
            props.coordinates = {lng, lat};
            geom = new Point(fromLonLat([lng, lat]));
        } else {
            console.warn("[createRailStationExitFeature] 유효한 offset 좌표를 계산하지 못했습니다.", props);
            props.coordinates = {lng: null, lat: null};
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

    getDefaultStyle(): Style | undefined {
        return undefined;
    }

    getFeatureType(): string | undefined {
        return undefined;
    }

    getSelectStyle(): Style | undefined {
        return undefined;
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        super.dispose();
    }
}