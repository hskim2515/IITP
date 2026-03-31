import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import {layerNameToStoreMap} from "@hooks/useLayerInit";
import { Feature } from "ol";
import {
    FEATURE_TYPE,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER
} from "@type/Signal";
import { useLayerStore } from "@stores/useLayerStore";
import {
    findFeatureByProperties,
    getCoordinateByOffset,
} from "@utils/feature";
import { fromLonLat, toLonLat } from "ol/proj";
import { Point } from "ol/geom";
import { generateGUIDWithType } from "@utils/guid";
import deepEqual from "deep-equal";
import {SignalData} from "@type/Signal";

export class SignalFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "signal";
    private unsubscribe: () => void;

    constructor() {
        const source = new VectorSource();
        const layerManager = useLayerStore.getState().layerManager
        super({
            source,
            visible: true,
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
            if (!updated) return;
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

                            feature.setGeometry(new Point(fromLonLat([ lng, lat ])));
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
    }

    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentJsonData = store.getState().currentJsonData;
        if (!currentJsonData) return;
        const { signals } = currentJsonData;

        const source = this.source;
        source.clear();

        const features = signals
            .map((data) => this.createFeature(data))
            .filter((f): f is Feature => !!f); // undefined 필터링

        source.addFeatures(features);

    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: SignalData): Feature | undefined {

        const props: SignalData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.SIGNAL,
        };
        const feature = new Feature();

        feature.setProperties(props);

        return feature;
    }


    public createDto(): SignalData {
        const guid = generateGUIDWithType(this.getFeatureType());

        const dto: SignalData = {
            id: undefined,
            __guid: guid,
            featureType: FEATURE_TYPE.SIGNAL,
            nodeId: undefined,
            turning: null,
            type: null,
            connectionId: undefined,
        };

        return dto;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record: Record<string, unknown>): SignalData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType())
        const dto = {
            ...(cleaned as Omit<SignalData, "featureType" | "__guid">),
            featureType: FEATURE_TYPE.SIGNAL,
            __guid: guid
        } as SignalData;
        return dto
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
        return FEATURE_TYPE.SIGNAL;
    }

    public destroy() {
        this.unsubscribe();
    }
}
