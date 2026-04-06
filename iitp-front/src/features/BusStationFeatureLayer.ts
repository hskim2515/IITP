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
import { getDistance } from "ol/sphere";
import { toLonLat } from "ol/proj";
import { Coordinate } from "ol/coordinate";

const PARKING_LOT_LENGTH_M = 14;

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busStation";
    // private readonly LOTS_SIZE = 15;
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

    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const geom = feature.getGeometry();
        const styles: Style[] = [];
        if (!(geom instanceof Point)) return styles;

        // 중심 점
        styles.push(
            new Style({
                image: new CircleStyle({
                    radius: 4,
                    fill: new Fill({color: "rgb(255,0,0)"}),
                    stroke: new Stroke({color: "rgba(0,0,0,0)", width: 0}),
                }),
            })
        );

        // 정류장 라인: modify 중에는 기존 위치 고정(stored coords), modifyend 후 load()로 갱신
        const lineStart = feature.get('__lineStart') as Coordinate | undefined;
        const lineEnd = feature.get('__lineEnd') as Coordinate | undefined;

        if (lineStart && lineEnd) {
            styles.push(
                new Style({
                    geometry: new LineString([lineStart, lineEnd]),
                    stroke: new Stroke({color: "rgb(255,0,0)", width: 4}),
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

            const laneStart = laneCoord[0] as Coordinate;
            const laneEnd = laneCoord[1] as Coordinate;
            const offset = busStation.offset
            if (!offset) {
                console.warn(`${busStation.id} 의 offset 이 존재하지 않습니다`)
                return;
            }
            const {offsetPosition} = computePositionAtOffsetOl(laneStart, laneEnd, offset)

            // lane 방향 단위벡터 및 미터→EPSG:3857 변환 계수
            const dx = laneEnd[0] - laneStart[0];
            const dy = laneEnd[1] - laneStart[1];
            const epsg3857Len = Math.sqrt(dx * dx + dy * dy);
            const realLenM = getDistance(toLonLat(laneStart), toLonLat(laneEnd));
            const laneUx = epsg3857Len > 0 ? dx / epsg3857Len : 1;
            const laneUy = epsg3857Len > 0 ? dy / epsg3857Len : 0;
            const unitsPerMeter = (epsg3857Len > 0 && realLenM > 0) ? epsg3857Len / realLenM : 1;

            // 라인 끝점: 우측 통행이므로 진행 방향 역방향으로 연장
            const parkingLots = busStation.parkingLots ?? 0;
            const totalLen = parkingLots * PARKING_LOT_LENGTH_M * unitsPerMeter;
            const lineEnd2: Coordinate = [
                offsetPosition[0] - laneUx * totalLen,
                offsetPosition[1] - laneUy * totalLen,
            ];

            const busStationPoint = new Point(offsetPosition)
            const busStationPointFeature = new Feature(busStationPoint);
            busStationPointFeature.setProperties({
                ...template,
                ...busStation,
                __laneUx: laneUx,
                __laneUy: laneUy,
                __unitsPerMeter: unitsPerMeter,
                __lineStart: offsetPosition as Coordinate,
                __lineEnd: lineEnd2,
            });
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