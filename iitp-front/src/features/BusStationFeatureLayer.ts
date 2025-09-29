import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

import { BusPublicStationResponse } from "@type/Station";
import { FeatureLike } from "ol/Feature";
import { useSchemaStore } from "@stores/useSchemaStore";
import { PublicTransitResponse } from "@type/openapi.gen";
import { diff } from "deep-object-diff";
import { computePositionAtOffsetOl } from "@utils/offset";
import { useLayerStore } from "@stores/useLayerStore";
import { findFeatureByProperties } from "@utils/feature";

export default class BusStationFeatureLayer extends VectorLayer {
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
                (state: {currentJsonData: BusPublicStationResponse;}) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load(); // 데이터가 변경되면 레이어를 다시 로드합니다.
                },
                {equalityFn: (a: BusPublicStationResponse, b: BusPublicStationResponse) => diff(a, b) === undefined}
            );
        }


        this.defaultStyle = new Style({
            image: new CircleStyle({
                radius: 6,
                fill: new Fill({color: "rgba(255, 0, 0, 1)"}), // 빨간색
                stroke: new Stroke({color: "rgba(0,0,0,0)", width: 1}),
            }),
        });

        this.selectStyle = new Style({
            image: new CircleStyle({
                radius: 8,
                fill: new Fill({color: "rgba(0, 255, 0, 1)"}), // 초록색
                stroke: new Stroke({color: "rgba(255, 0, 0, 1)", width: 2}),
            }),
        });

        this.modifyStyle = new Style({
            image: new CircleStyle({
                radius: 8,
                fill: new Fill({color: "rgba(255, 255, 0, 1)"}), // 노란색
                stroke: new Stroke({color: "rgba(0, 0, 0, 1)", width: 2}),
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
                        fill: new Fill({color: "rgb(255,0,0)"}),
                        stroke: new Stroke({color: "rgba(0,0,0,0)", width: Math.min(3, 0.5 / resolution)}),
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
        console.log("current?:::", store.getState().currentJsonData)
        const networkStore = layerNameToStoreMap["network"];
        const generateTemplateWithLayerNameAndFeatureType = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType
        const template = generateTemplateWithLayerNameAndFeatureType('busStation', 'busStations')
        if (!store || !networkStore) return; // 스토어가 없으면 중단
        const busPublicStationResponse: PublicTransitResponse = store.getState().currentJsonData;

        // 데이터가 없는 경우를 대비한 방어 코드
        if (!busPublicStationResponse || !busPublicStationResponse.busStations) {
            this.source.clear();
            return;
        }

        const networkLayer = useLayerStore.getState().layerManager?.getLayerByName("network")
        if (!networkLayer) {
            return;
        }
        const networkSource = networkLayer.getSource();
        const busStations = busPublicStationResponse.busStations;
        const featureBuffer: Feature[] = [];

        for (const busStation of busStations) {
            const linkRef = busStation.linkRef
            const laneRef = busStation.laneRef

            const lane = findFeatureByProperties(networkSource?.getFeatures(), {
                featureType: "lane-edit",
                linkRef,
                laneRef
            });

            const laneGeom = lane?.getGeometry()
            if (!(laneGeom instanceof LineString)) continue;
            const laneCoord = laneGeom.getCoordinates();
            if (!laneCoord || !laneCoord[0] || !laneCoord[1]) continue;

            const laneStart = laneCoord[0]
            const laneEnd = laneCoord[1]
            const offset = busStation.offset
            if (!offset) {
                console.warn(`${busStation.id} 의 offset 이 존재하지 않습니다`)
                return;
            }
            const {offsetPosition} = computePositionAtOffsetOl(laneStart, laneEnd, offset)

            const busStationPoint = new Point(offsetPosition)
            const busStationPointFeature = new Feature(busStationPoint);
            busStationPointFeature.setProperties({...template, ...busStation})
            if (busStationPointFeature) featureBuffer.push(busStationPointFeature);
        }

        this.source.clear();
        this.source.addFeatures(featureBuffer);
        console.log("BusStationLayer: 로드 완료:::", featureBuffer);
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        super.dispose();
    }
}