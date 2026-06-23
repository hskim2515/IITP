import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { getFacilityLodTierByResolution } from "@utils/lodConstants";
import { FacilityClusterOverlay } from "@features/facilityCluster";
import type OLMap from "ol/Map";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

import { BusPublicStationResponse } from "@type/Station";
import { FeatureLike } from "ol/Feature";
import { useSchemaStore } from "@stores/useSchemaStore";
import { PublicTransitResponse } from "@type/openapi.gen";
import { diff } from "deep-object-diff";
import { computePositionAtOffsetOl } from "@utils/offset";
import { Coordinate } from "ol/coordinate";
import { getDistance } from "ol/sphere";
import { toLonLat } from "ol/proj";

const PARKING_LOT_LENGTH_M = 14;

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busStation";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;
    private clusterOverlay: FacilityClusterOverlay;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 410,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });

        this.source = source;
        // overview 클러스터 오버레이 (정류장 점 전체 군집)
        this.clusterOverlay = new FacilityClusterOverlay(source, {
            color: "rgb(255,0,0)",
            zIndex: 409,
        });

        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: {currentJsonData: BusPublicStationResponse;}) => state.currentJsonData,
                () => {
                    console.log(`[${this.LAYER_NAME}] Store data changed, reloading layer.`);
                    this.load();
                },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            (networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => { const _d = useNetworkDrawStore.getState(); if (!_d.isActive && !_d.isConnectionActive) this.load(); },
                { equalityFn: (a: any, b: any) => a === b }
            );
        }
    }

    override setVisible(visible: boolean): void {
        super.setVisible(visible);
        this.clusterOverlay.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

    override setMapInternal(map: OLMap | null): void {
        super.setMapInternal(map);
        if (map) {
            this.clusterOverlay.attach(map);
            this.clusterOverlay.setVisible(this.getVisible());
        } else {
            this.clusterOverlay.detach();
        }
    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const tier = getFacilityLodTierByResolution(resolution);
        // cluster tier: 개별 마커 숨김 (원거리 — Cesium 아이콘/클러스터가 담당)
        if (tier === 'cluster') return [];

        const geom = feature.getGeometry();
        const styles: Style[] = [];
        if (!(geom instanceof Point)) return styles;

        // 해상도에 비례한 마커 크기 (정류장 물리폭 ~3m 기준, 최소 3px ↔ 최대 6px)
        const radius = Math.min(6, Math.max(3, 3 / resolution));
        const opacity = tier === 'detail' ? 1.0 : 0.75;

        styles.push(
            new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: `rgba(255,0,0,${opacity})` }),
                    stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 }),
                }),
            })
        );

        // 주차선(접근 레인): 완전 근접(detail)에서만 표시
        if (tier === 'detail') {
            const lineStart = feature.get('__lineStart') as Coordinate | undefined;
            const lineEnd   = feature.get('__lineEnd')   as Coordinate | undefined;
            if (lineStart && lineEnd) {
                styles.push(
                    new Style({
                        geometry: new LineString([lineStart, lineEnd]),
                        stroke: new Stroke({ color: "rgb(255,0,0)", width: 4 }),
                    })
                );
            }
        }

        return styles;
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) { this.needsReload = true; return; }
        this.needsReload = false;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];
        const generateTemplateWithLayerNameAndFeatureType = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType;
        const template = generateTemplateWithLayerNameAndFeatureType('busStation', 'busStations');
        if (!store || !networkStore) return;

        const busPublicStationResponse: PublicTransitResponse = store.getState().currentJsonData;
        if (!busPublicStationResponse || !busPublicStationResponse.busStations) {
            this.source.clear();
            return;
        }

        const networkData: any = networkStore.getState().currentJsonData;
        if (!networkData?.links) {
            this.source.clear();
            return;
        }

        // linkId → link 매핑 및 lane 중심선 좌표 사전 계산
        const linkLaneMap = new Map<string, { source: Coordinate; target: Coordinate }[]>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const p1 = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
            const p1b = fromLonLat([link.coordinates[1].lng, link.coordinates[1].lat]);
            const lastCoord = link.coordinates[link.coordinates.length - 1];
            const p2 = fromLonLat([lastCoord.lng, lastCoord.lat]);

            const dx = p1b[0] - p1[0];
            const dy = p1b[1] - p1[1];
            const len = Math.hypot(dx, dy);
            const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];

            const laneCount = link.lanes?.length ?? 0;
            if (laneCount === 0) continue;
            const laneWidth = (link.width ?? 0) / laneCount;

            const lanes: { source: Coordinate; target: Coordinate }[] = [];
            for (let i = 0; i < laneCount; i++) {
                const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;
                const centerP1: Coordinate = [p1[0] + unitNormal[0] * offsetCenter, p1[1] + unitNormal[1] * offsetCenter];
                const centerP2: Coordinate = [p2[0] + unitNormal[0] * offsetCenter, p2[1] + unitNormal[1] * offsetCenter];
                lanes.push({ source: centerP1, target: centerP2 });
            }
            linkLaneMap.set(String(link.id), lanes);
        }

        const busStations = busPublicStationResponse.busStations;
        const featureBuffer: Feature[] = [];

        for (const busStation of busStations) {
            const linkRef = String(busStation.linkRef);
            const laneRef = Number(busStation.laneRef);

            const lanes = linkLaneMap.get(linkRef);
            if (!lanes || laneRef < 0 || laneRef >= lanes.length) {
                console.warn(`[busStation] ${busStation.id}: link ${linkRef} lane ${laneRef} 를 찾을 수 없음`);
                continue;
            }

            const { source: laneStart, target: laneEnd } = lanes[laneRef];

            const offset = busStation.offset;
            if (!offset) {
                console.warn(`[busStation] ${busStation.id}: offset 없음`);
                continue;
            }

            const { offsetPosition } = computePositionAtOffsetOl(laneStart, laneEnd, offset);

            // 방향 벡터 및 m→EPSG:3857 변환 계수
            const dx = laneEnd[0] - laneStart[0];
            const dy = laneEnd[1] - laneStart[1];
            const epsg3857Len = Math.sqrt(dx * dx + dy * dy);
            const realLenM = getDistance(toLonLat(laneStart), toLonLat(laneEnd));
            const laneUx = epsg3857Len > 0 ? dx / epsg3857Len : 1;
            const laneUy = epsg3857Len > 0 ? dy / epsg3857Len : 0;
            const unitsPerMeter = (epsg3857Len > 0 && realLenM > 0) ? epsg3857Len / realLenM : 1;

            const parkingLots = busStation.parkingLots ?? 0;
            const totalLen = parkingLots * PARKING_LOT_LENGTH_M * unitsPerMeter;
            const lineEnd2: Coordinate = [
                offsetPosition[0] - laneUx * totalLen,
                offsetPosition[1] - laneUy * totalLen,
            ];

            const busStationPointFeature = new Feature(new Point(offsetPosition));
            busStationPointFeature.setProperties({
                ...template,
                ...busStation,
                __laneUx: laneUx,
                __laneUy: laneUy,
                __unitsPerMeter: unitsPerMeter,
                __lineStart: offsetPosition as Coordinate,
                __lineEnd: lineEnd2,
            });
            featureBuffer.push(busStationPointFeature);
        }

        this.source.clear();
        this.source.addFeatures(featureBuffer);
        console.log("BusStationLayer: 로드 완료:::", featureBuffer);
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.clusterOverlay.dispose();
        super.dispose();
    }
}
