import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { Icon, Style } from "ol/style";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";
import { Feature } from "ol";
import {
    FEATURE_TYPE,
    PAVEMENT_MARKING_SNAP_FIELDS, PavementMarkingData, PavementMarkingSnapProperties,
    PavementMarkingType,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER
} from "@type/PavementMarking";
import { deepEqual } from "@utils/json";
import { useLayerStore } from "@stores/useLayerStore";
import {
    findFeatureByProperties,
    getCoordinateByOffset,
    getFeaturesByProperties,
    getOffsetByCoordinate
} from "@utils/feature";
import { fromLonLat, toLonLat } from "ol/proj";
import { Point } from "ol/geom";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import BaseLayer from "ol/layer/Base";
import { Coordinate } from "ol/coordinate";
import { generateGUIDWithType } from "@utils/guid";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";

export class PavementMarkingFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "pavementMarking";
    private unsubscribe: () => void;

    constructor() {
        const source = new VectorSource();
        const layerManager = useLayerStore.getState().layerManager
        super({
            source,
            visible: true,

            style: (feature: Feature, resolution: number) => {
                const baseResolution = 1.2;
                const scale = 0.05 * (baseResolution / resolution);
                const markingType = feature.get("markingType");
                const iconFile = PavementMarkingType[markingType];
                const url = `${ process.env.REACT_APP_FILE_BASE_URL }models/${ iconFile }`;

                const angle = feature.get("angle") || 0;
                return new Style({
                    image: new Icon({
                        src: url,
                        scale,
                        anchor: [ 0.5, 1 ],
                        rotateWithView: true,
                        rotation: angle,
                    }),
                });
            },
            zIndex: 400,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this.source = source;

        const store = layerNameToStoreMap[this.LAYER_NAME];

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
                        const baseLayer = layerManager?.getLayerByName(this.getSnapLayerKey())
                        const baseFeature = findFeatureByProperties(baseLayer, {
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
                            feature.setGeometry(new Point(fromLonLat([ lng, lat ])));
                        }

                        feature.setProperties(dto);
                    }
                });

                added.forEach((item) => {
                    console.log("add btn item:::", item)
                    const dto = this.recordToDto(item);
                    console.log("add btn dto:::", dto)
                    const feature = this.createFeature(dto);
                    console.log("add btn feature:::", feature)
                    src.addFeature(feature);
                    console.log(`[추가] __guid: ${ dto.__guid }`);
                });
            });
        };

        this.unsubscribe = store.subscribe(
            // 구독할 값: currentJsonData 배열
            state => state.currentJsonData,
            listener,
            { fireImmediately: true }
        );

    }

    public async load(): Promise<void> {
        console.log("load pavementMarking")
        const store = layerNameToStoreMap[this.LAYER_NAME];
        console.log("store.getState().currentJsonData:::", store.getState().currentJsonData)
        const { pavementMarkings } = store.getState().currentJsonData;

        const source = this.source;
        source.clear();

        const features = pavementMarkings
            .map((data) => this.createFeature(data))
            .filter((f): f is Feature<Point> => !!f); // undefined 필터링
        const mergedFeatures = interpolateByOffset(features);
        source.addFeatures(mergedFeatures);
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: PavementMarkingData): Feature<Point> | undefined {
        console.log("createFeature data:::", data);

        const props: PavementMarkingData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.PAVEMENT_MARKING,
        };
        const coord = Array.isArray(data.coordinates) ? data.coordinates[0] : undefined;
        const hasValidCoordinate =
            coord &&
            typeof coord.lng === 'number' &&
            typeof coord.lat === 'number';

        if (!hasValidCoordinate) {
            console.warn("Invalid or missing coordinates, skipping feature:", data);
            return undefined;
        }

        const geom = new Point(fromLonLat([coord.lng!, coord.lat!]));
        const feature = new Feature<Point>(geom);
        feature.setProperties(props);

        return feature;
    }

    public createDto(): PavementMarkingData {
        const guid = generateGUIDWithType(this.getFeatureType());

        const dto: PavementMarkingData = {
            id: undefined,
            __guid: guid,
            angle: null,
            featureType: FEATURE_TYPE.PAVEMENT_MARKING,
            linkRef: null,
            laneRef: null,
            offset: null,
            coordinates: [{
                lng: null,
                lat: null,
            }],
            markingType: null,
        };

        return dto;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record: Record<string, unknown>): PavementMarkingData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType())
        const dto = {
            ...(cleaned as Omit<PavementMarkingData, "featureType" | "__guid">),
            featureType: FEATURE_TYPE.PAVEMENT_MARKING,
            __guid: guid
        } as PavementMarkingData;
        return dto
    }

    /**
     * Snap 된 일반 객체 Property 추출
     */
    public recordToSnapProperties(record: Record<string, unknown>): PavementMarkingSnapProperties | undefined {
        if (record["featureType"] !== this.getSnapFeatureType()) return;

        const properties: Partial<PavementMarkingSnapProperties> = {};

        PAVEMENT_MARKING_SNAP_FIELDS.forEach(field => {
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

        return properties as PavementMarkingSnapProperties;
    }


    /**
     * Snap 속성을 기존 BusStationData에 병합
     */
    public snapPropertiesToDto(
        snapProperties: PavementMarkingSnapProperties,
        baseDto: PavementMarkingData
    ): PavementMarkingData {
        const { id: ignored, ...props } = snapProperties
        return {
            ...baseDto,
            ...props
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
        return FEATURE_TYPE.PAVEMENT_MARKING;
    }

    public computeMetadata(
        baseLayer: VectorLayer | WebGLVectorLayer | BaseLayer,
        basedProperties: Record<string, unknown> | undefined,
        fromCoord: Coordinate
    ): Record<string, unknown> {
        const filter = { featureType: this.getSnapFeatureType() };
        const features = getFeaturesByProperties(baseLayer, filter);
        const feature = findFeatureByProperties(features, basedProperties);
        const offset = getOffsetByCoordinate(feature, fromCoord);

        console.log("before snappedProperties compute:::", basedProperties);

        const computeProperties: Record<string, unknown> = {};
        const [ lng, lat ] = toLonLat(fromCoord)

        PAVEMENT_MARKING_SNAP_FIELDS.forEach((key) => {
            if (key === "offset") {
                computeProperties[key] = offset ?? null;
            } else if (key === "coordinates") {
                computeProperties[key] = lng != null && lat != null ? [ { lat, lng } ] : [];
            } else {
                computeProperties[key] = basedProperties?.[key] ?? null;
            }
        });

        console.log("after snappedProperties compute:::", computeProperties);
        return computeProperties;
    }

    public destroy() {
        this.unsubscribe();
    }
}
