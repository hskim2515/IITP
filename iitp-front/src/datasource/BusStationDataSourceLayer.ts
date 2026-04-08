import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusPublicStationResponse } from "@type/Station";
import { computePositionAtOffsetCesium } from "@utils/offset";
import { PublicTransitResponse } from "@type/openapi.gen";

/* ── 치수 ── */
const PARKING_LOT_LEN_M = 14;
const POLE_HEIGHT        = 4.0;
const POLE_RADIUS        = 0.07;
const SIGN_W             = 0.8;
const SIGN_H             = 0.5;
const SIGN_D             = 0.12;
const PLATFORM_H         = 0.3;
const PLATFORM_W         = 3.2;
const SHELTER_H          = 2.6;    // 쉘터 지붕 하단 높이
const SHELTER_THICK      = 0.12;   // 지붕 두께

/* ── 색상 ── */
const C_POLE      = Color.fromCssColorString("#607d8b");
const C_SIGN      = Color.fromCssColorString("#00838f");   // 청록 (한국 버스 색상)
const C_SIGN_TOP  = Color.fromCssColorString("#ffe082");   // 황색 상단 밴드
const C_PLATFORM  = Color.fromCssColorString("#e0e0e0").withAlpha(0.9);
const C_SHELTER   = Color.fromCssColorString("#b3e5fc").withAlpha(0.55);
const C_MARKER    = Color.fromCssColorString("#00acc1");   // 원거리 마커 색상

/* ── LOD 거리 조건 ── */
// 3D 디테일: 400m 이내에서만 표시
const DETAIL_DIST = new Cesium.DistanceDisplayCondition(0.0, 400.0);
// 라벨: 120m 이내
const LABEL_DIST  = new Cesium.DistanceDisplayCondition(0.0, 120.0);
// 마커 포인트: 항상 표시 (LOD 없음), scaleByDistance로 크기 조절
const MARKER_SCALE = new Cesium.NearFarScalar(50, 2.0, 3000, 0.4);
const MARKER_ALPHA = new Cesium.NearFarScalar(2500, 1.0, 5000, 0.0);

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "busStation";
    public readonly dataSource: CustomDataSource;
    private markerCollection:  Cesium.PointPrimitiveCollection;
    private labelCollection:   Cesium.LabelCollection;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private needsReload = false;

    constructor(private viewer: Viewer) {
        this.dataSource     = new CustomDataSource(this.LAYER_NAME);
        this.markerCollection = new Cesium.PointPrimitiveCollection();
        this.labelCollection  = new Cesium.LabelCollection();

        this.viewer.dataSources.add(this.dataSource);
        this.viewer.scene.primitives.add(this.markerCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        this.load();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push(store.subscribe(
                (state: { currentJsonData: BusPublicStationResponse }) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
        }

        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            this.unsubscribes.push((networkStore as any).subscribe(
                (state: any) => state.currentJsonData,
                () => { const _d = useNetworkDrawStore.getState(); if (!_d.isActive && !_d.isConnectionActive) this.load(); },
                { equalityFn: (a: any, b: any) => a === b }
            ));
        }
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show       = visible;
        this.markerCollection.show = visible;
        this.labelCollection.show  = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("BusStationDataSourceLayer.load() 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        if (!this.dataSource.show) { this.needsReload = true; return; }
        this.needsReload = false;

        this.markerCollection.removeAll();
        this.labelCollection.removeAll();

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];
        if (!store || !networkStore) return;

        const busData: PublicTransitResponse = store.getState().currentJsonData;
        if (!busData?.busStations) return;

        const networkData: any = networkStore.getState().currentJsonData;
        if (!networkData?.links) return;

        /* ── 링크별 레인 중심선 사전 계산 ── */
        const linkLaneMap = new Map<string, { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }[]>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const p1   = Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat);
            const last = link.coordinates[link.coordinates.length - 1];
            const p2   = Cesium.Cartesian3.fromDegrees(last.lng, last.lat);

            const dir   = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(dir, dir);
            const right = Cesium.Cartesian3.cross(dir, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(right, right);

            const laneCount = link.lanes?.length ?? 0;
            if (laneCount === 0) continue;
            const laneWidth = (link.width ?? 0) / laneCount;

            const lanes: { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }[] = [];
            for (let i = 0; i < laneCount; i++) {
                const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;
                const offsetVec    = Cesium.Cartesian3.multiplyByScalar(right, offsetCenter, new Cesium.Cartesian3());
                lanes.push({
                    source: Cesium.Cartesian3.add(p1, offsetVec, new Cesium.Cartesian3()),
                    target: Cesium.Cartesian3.add(p2, offsetVec, new Cesium.Cartesian3()),
                });
            }
            linkLaneMap.set(String(link.id), lanes);
        }

        /* ── 정류장 위치 계산 ── */
        interface StationEntry {
            lng: number; lat: number;
            offsetPosition: Cesium.Cartesian3;
            parkingEnd: Cesium.Cartesian3;
            platformLength: number;
            stationName: string;
        }
        const entries: StationEntry[] = [];

        for (const station of busData.busStations) {
            const linkRef = String(station.linkRef);
            const laneRef = Number(station.laneRef);
            const lanes   = linkLaneMap.get(linkRef);
            if (!lanes || laneRef < 0 || laneRef >= lanes.length) continue;

            const lane = lanes[laneRef];
            if (!lane) continue;
            const { source: laneSource, target: laneTarget } = lane;
            if (!station.offset) continue;

            const { offsetPosition } = computePositionAtOffsetCesium(laneSource, laneTarget, station.offset);

            const dir    = Cesium.Cartesian3.subtract(laneTarget, laneSource, new Cesium.Cartesian3());
            const segLen = Cesium.Cartesian3.magnitude(dir);
            if (segLen === 0) continue;
            Cesium.Cartesian3.normalize(dir, dir);

            const parkingLots    = station.parkingLots ?? 0;
            const platformLength = parkingLots * PARKING_LOT_LEN_M;
            const parkingEnd     = Cesium.Cartesian3.add(
                offsetPosition,
                Cesium.Cartesian3.multiplyByScalar(dir, -platformLength, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            const carto = Cesium.Cartographic.fromCartesian(offsetPosition);
            const lng   = Cesium.Math.toDegrees(carto.longitude);
            const lat   = Cesium.Math.toDegrees(carto.latitude);
            const stationName = (station as any).name ?? (station as any).stationName ?? "";
            entries.push({ lng, lat, offsetPosition, parkingEnd, platformLength, stationName });
        }

        if (!entries.length) return;

        /* ── 지형 고도 일괄 샘플링 ── */
        const terrainHeightMap = new Map<string, number>();
        const hasRealTerrain = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

        if (hasRealTerrain) {
            const uniqueKeys: string[] = [];
            const uniqueCartos: Cesium.Cartographic[] = [];
            for (const e of entries) {
                const k = key(e.lng, e.lat);
                if (!terrainHeightMap.has(k)) {
                    terrainHeightMap.set(k, 0);
                    uniqueKeys.push(k);
                    uniqueCartos.push(Cesium.Cartographic.fromDegrees(e.lng, e.lat));
                }
            }
            try {
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, uniqueCartos);
                for (let i = 0; i < uniqueKeys.length; i++) {
                    terrainHeightMap.set(uniqueKeys[i]!, uniqueCartos[i]!.height ?? 0);
                }
            } catch (e) {
                console.warn("BusStationDataSourceLayer: 지형 고도 샘플링 실패", e);
            }
        }

        /* ── 엔티티 생성 ── */
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            for (const e of entries) {
                const { lng, lat, offsetPosition, parkingEnd, platformLength, stationName } = e;
                const baseH = terrainHeightMap.get(key(lng, lat)) ?? 0;

                /* ① 원거리 포인트 마커 */
                this.markerCollection.add({
                    position:                 Cesium.Cartesian3.fromDegrees(lng, lat, baseH + 0.5),
                    color:                    C_MARKER.clone(),
                    pixelSize:               10,
                    outlineColor:             Cesium.Color.WHITE,
                    outlineWidth:             1.5,
                    scaleByDistance:          MARKER_SCALE,
                    translucencyByDistance:   MARKER_ALPHA,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });

                /* ② 정류장 이름 라벨 (120m 이내) */
                if (stationName) {
                    this.labelCollection.add({
                        position:                 Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT + SIGN_H + 0.5),
                        text:                     stationName,
                        font:                     "bold 13px sans-serif",
                        fillColor:                Cesium.Color.WHITE,
                        outlineColor:             Cesium.Color.BLACK,
                        outlineWidth:             2,
                        style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
                        horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
                        verticalOrigin:           Cesium.VerticalOrigin.BOTTOM,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        distanceDisplayCondition: LABEL_DIST,
                        pixelOffset:              new Cesium.Cartesian2(0, -4),
                    });
                }

                /* ③ 폴 (400m 이내) */
                const poleE = new Entity({
                    position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT / 2),
                    cylinder: {
                        length: POLE_HEIGHT,
                        topRadius: POLE_RADIUS,
                        bottomRadius: POLE_RADIUS,
                        material: C_POLE,
                        outline: false,
                    },
                });
                (poleE as any).distanceDisplayCondition = DETAIL_DIST;
                this.dataSource.entities.add(poleE);

                /* ④ 표지판 본체 — 청록색 (400m 이내) */
                const signE = new Entity({
                    position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT + SIGN_H / 2),
                    box: {
                        dimensions: new Cesium.Cartesian3(SIGN_W, SIGN_D, SIGN_H),
                        material: C_SIGN,
                        outline: false,
                    },
                });
                (signE as any).distanceDisplayCondition = DETAIL_DIST;
                this.dataSource.entities.add(signE);

                /* ⑤ 표지판 상단 황색 밴드 (400m 이내) */
                const bandH = 0.08;
                const bandE = new Entity({
                    position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT + SIGN_H - bandH / 2),
                    box: {
                        dimensions: new Cesium.Cartesian3(SIGN_W + 0.02, SIGN_D + 0.02, bandH),
                        material: C_SIGN_TOP,
                        outline: false,
                    },
                });
                (bandE as any).distanceDisplayCondition = DETAIL_DIST;
                this.dataSource.entities.add(bandE);

                /* ⑥ 승강장 플랫폼 + 지붕 (400m 이내, parkingLots > 0) */
                if (platformLength > 0) {
                    const platformE = new Entity({
                        corridor: {
                            positions: [offsetPosition, parkingEnd],
                            width: PLATFORM_W,
                            height: baseH,
                            extrudedHeight: baseH + PLATFORM_H,
                            material: C_PLATFORM,
                            cornerType: Cesium.CornerType.MITERED,
                        },
                    });
                    (platformE as any).distanceDisplayCondition = DETAIL_DIST;
                    this.dataSource.entities.add(platformE);

                    const shelterE = new Entity({
                        corridor: {
                            positions: [offsetPosition, parkingEnd],
                            width: PLATFORM_W + 0.6,
                            height: baseH + SHELTER_H,
                            extrudedHeight: baseH + SHELTER_H + SHELTER_THICK,
                            material: C_SHELTER,
                            cornerType: Cesium.CornerType.MITERED,
                        },
                    });
                    (shelterE as any).distanceDisplayCondition = DETAIL_DIST;
                    this.dataSource.entities.add(shelterE);
                }
            }

            console.log(`BusStationDataSourceLayer: ${busData.busStations.length}개 정류장 로드`);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
        this.viewer.scene.primitives.remove(this.markerCollection);
        this.viewer.scene.primitives.remove(this.labelCollection);
    }
}
