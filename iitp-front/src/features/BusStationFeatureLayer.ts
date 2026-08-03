import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { getFacilityLodTierByResolution } from "@utils/lodConstants";
import { FacilityClusterOverlay } from "@features/facilityCluster";
import type OLMap from "ol/Map";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

import { BusPublicStationResponse } from "@type/Station";
import { FeatureLike } from "ol/Feature";
import { useSchemaStore } from "@stores/useSchemaStore";
import { PublicTransitResponse } from "@type/openapi.gen";
import { diff } from "deep-object-diff";
import { computePositionAtOffsetPolylineOl } from "@utils/offset";
import { computeLaneCenterlineOl, computeMedianCenterlineOl } from "@utils/interpolateByOffset";
import { Coordinate } from "ol/coordinate";
import { getDistance } from "ol/sphere";
import { toLonLat } from "ol/proj";
import { getActiveVersionId } from "@utils/versionId";
import { BUS_STATION_TILING } from "@utils/lodConstants";
import { BusStationTileManager } from "@managers/BusStationTileManager";
import { BusStationTileMembership } from "@managers/busStationTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";

const PARKING_LOT_LENGTH_M = 14;

export default class BusStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "busStation";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;
    private clusterOverlay: FacilityClusterOverlay;

    // ── 버스정류장 타일링 (BUS_STATION_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: BusStationTileManager | null = null;
    private membership = new BusStationTileMembership();
    private moveEndKey: EventsKey | null = null;

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
            // 저장 완료(isChanged: true → false) — 저장은 currentJsonData만 서버에 보낼 뿐
            // originData는 그대로 두므로, 손대지 않으면 diffRecordEditsById가 방금 저장된
            // 정류장도 계속 "로컬 편집"으로 오인해 오버레이가 안 사라진다(신호와 동일 조치).
            (store as any).subscribe(
                (s: any) => s.isChanged,
                (isChanged: boolean, prevIsChanged: boolean) => {
                    if (!prevIsChanged || isChanged) return;
                    const cur = store.getState().currentJsonData;
                    if (cur) store.getState().setOriginData(cur);
                    if (BUS_STATION_TILING.ENABLED) {
                        this.tileManager?.clear();
                        const map = this.getMapInternal() as OLMap | null;
                        if (map) this.updateTiles(map);
                    }
                },
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
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        super.setMapInternal(map);
        if (map) {
            this.clusterOverlay.attach(map);
            this.clusterOverlay.setVisible(this.getVisible());
            if (BUS_STATION_TILING.ENABLED) {
                this.moveEndKey = map.on('moveend', () => this.updateTiles(map));
                this.updateTiles(map);
            }
        } else {
            this.clusterOverlay.detach();
            this.tileManager?.clear();
            this.tileManager = null;
        }
    }

    private updateTiles(map: OLMap): void {
        const view = map.getView();
        const size = map.getSize();
        const resolution = view.getResolution();
        if (!size || resolution == null) return;
        if (!this.tileManager) {
            const versionId = getActiveVersionId();
            if (!versionId) return;
            this.tileManager = new BusStationTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.update(view.calculateExtent(size), resolution);
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
        // 디버깅용 — medianLane(중앙버스전용차로) 정류장을 다른 색으로 표시(3D 승강장 색과
        // 동일 계열: #ff4081)해 실제로 어떤 정류장이 중앙차로로 분류됐는지 바로 구분한다.
        const isMedian = feature.get('medianLane') === true;
        const fillColor = isMedian ? `rgba(255,64,129,${opacity})` : `rgba(255,0,0,${opacity})`;

        styles.push(
            new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: fillColor }),
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
        if (!busPublicStationResponse) {
            this.source.clear();
            return;
        }

        // 타일 모드: viewport 정류장(서버 최신) + 로컬 미저장 편집을 id 단위로 병합
        //   (SignalFeatureLayer와 동일 조치 — diffRecordEditsById 참고).
        // 비-타일 모드: store 전체 정류장 그대로 사용.
        let busStationsAll: any[];
        if (BUS_STATION_TILING.ENABLED) {
            const originData = store.getState().originData as any;
            const { editedIds, deletedIds } = diffRecordEditsById(originData?.busStations, busPublicStationResponse.busStations, 'id');
            const merged = new Map<string, any>();
            for (const s of this.membership.values()) {
                const id = String(s?.id ?? '');
                if (deletedIds.has(id)) continue;
                merged.set(id, s);
            }
            for (const s of (busPublicStationResponse.busStations ?? [])) {
                const id = String(s?.id ?? '');
                if (editedIds.has(id)) merged.set(id, s);
            }
            busStationsAll = [...merged.values()];
        } else {
            busStationsAll = busPublicStationResponse.busStations ?? [];
        }
        if (!busStationsAll.length) {
            this.source.clear();
            return;
        }

        const networkData: any = networkStore.getState().currentJsonData;
        if (!networkData?.links) {
            this.source.clear();
            return;
        }

        // linkId → link 매핑 및 lane 중심선(전체 폴리라인) 사전 계산.
        // 링크가 3점 이상(곡선)인 경우 첫/끝 점만으로는 오프셋 위치가 실제 클릭/저장 지점과
        // 어긋난다(실측 최대 54m) — computeLaneCenterlineOl은 정점마다 법선 오프셋을 적용해
        // 곡선을 그대로 따라가는 전체 점열을 만든다(interpolateByOffset.ts와 동일 로직 재사용).
        const linkLaneMap = new Map<string, Coordinate[][]>();
        const linkById = new Map<string, any>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            linkById.set(String(link.id), link);
            const laneCount = link.lanes?.length ?? 0;
            if (laneCount === 0) continue;

            const lanes: Coordinate[][] = [];
            for (let i = 0; i < laneCount; i++) {
                const centerline = computeLaneCenterlineOl(link, i);
                if (centerline) lanes.push(centerline);
            }
            linkLaneMap.set(String(link.id), lanes);
        }

        const featureBuffer: Feature[] = [];

        for (const busStation of busStationsAll) {
            const linkRef = String(busStation.linkRef);

            const offset = busStation.offset;
            if (!offset) {
                console.warn(`[busStation] ${busStation.id}: offset 없음`);
                continue;
            }

            // 중앙버스전용차로(medianLane) 정류장 — 이 링크 혼자만의 차선 배열이 아니라
            // 상하행 링크 사이 실제 물리적 중앙(중앙분리대)에 배치한다(실사용 지적: "중앙차선일
            // 경우 링크의 중앙이 아닌 상하행의 중간에 있어야 함").
            let laneAllPts: Coordinate[] | null = null;
            if ((busStation as any).medianLane) {
                const link = linkById.get(linkRef);
                if (link) laneAllPts = computeMedianCenterlineOl(link, networkData.links);
            }
            if (!laneAllPts) {
                const laneRef = Number(busStation.laneRef);
                const lanes = linkLaneMap.get(linkRef);
                if (!lanes || laneRef < 0 || laneRef >= lanes.length) {
                    console.warn(`[busStation] ${busStation.id}: link ${linkRef} lane ${laneRef} 를 찾을 수 없음`);
                    continue;
                }
                laneAllPts = lanes[laneRef] ?? null;
            }
            if (!laneAllPts) continue;

            const { offsetPosition, direction } = computePositionAtOffsetPolylineOl(laneAllPts, offset);

            // 방향 벡터(투영좌표계 단위벡터) + m→EPSG:3857 변환 계수(해당 지점 인근 실측 기준)
            const laneUx = direction[0];
            const laneUy = direction[1];
            const probe: Coordinate = [offsetPosition[0]! + laneUx, offsetPosition[1]! + laneUy];
            const realLenPerUnit = getDistance(toLonLat(offsetPosition), toLonLat(probe));
            const unitsPerMeter = realLenPerUnit > 0 ? 1 / realLenPerUnit : 1;

            const parkingLots = busStation.parkingLots ?? 0;
            const totalLen = parkingLots * PARKING_LOT_LENGTH_M * unitsPerMeter;
            const lineEnd2: Coordinate = [
                offsetPosition[0]! - laneUx * totalLen,
                offsetPosition[1]! - laneUy * totalLen,
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
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        this.tileManager?.clear();
        this.tileManager = null;
        this.clusterOverlay.dispose();
        super.dispose();
    }
}
