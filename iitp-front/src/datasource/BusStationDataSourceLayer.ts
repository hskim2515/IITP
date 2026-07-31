import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusPublicStationResponse } from "@type/Station";
import { computePositionAtOffsetCesium } from "@utils/offset";
import { PublicTransitResponse } from "@type/openapi.gen";
import { LOD_ALT, BUS_STATION_TILING } from "@utils/lodConstants";
import { CesiumFacilityCluster } from "@datasource/cesiumFacilityCluster";
import { getActiveVersionId } from "@utils/versionId";
import { BusStationTileManager } from "@managers/BusStationTileManager";
import { BusStationTileMembership } from "@managers/busStationTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";

/* ── 치수 ── */
const PARKING_LOT_LEN_M = 14;
const POLE_HEIGHT        = 4.0;
const POLE_RADIUS        = 0.07;
const SIGN_W             = 0.8;
const SIGN_H             = 0.5;
const SIGN_D             = 0.12;
const PLATFORM_H         = 0.3;
const PLATFORM_W         = 3.2;
const SHELTER_H          = 2.6;
const SHELTER_THICK      = 0.12;

/* ── 색상 ── */
const C_POLE      = Color.fromCssColorString("#607d8b");
const C_SIGN      = Color.fromCssColorString("#00838f");
const C_SIGN_TOP  = Color.fromCssColorString("#ffe082");
const C_PLATFORM  = Color.fromCssColorString("#e0e0e0").withAlpha(0.9);
const C_SHELTER   = Color.fromCssColorString("#b3e5fc").withAlpha(0.55);

/* ── LOD 거리 조건 ── */
const DETAIL_DIST    = new Cesium.DistanceDisplayCondition(0.0, LOD_ALT.FACILITY_DETAIL);
const LABEL_DIST     = new Cesium.DistanceDisplayCondition(0.0, LOD_ALT.FACILITY_LABEL);
const STATION_BB_DDC = new Cesium.DistanceDisplayCondition(LOD_ALT.FACILITY_DETAIL, LOD_ALT.FACILITY_ICON);
const BB_SCALE_BY_DIST = new Cesium.NearFarScalar(LOD_ALT.FACILITY_DETAIL, 1.0, LOD_ALT.FACILITY_ICON, 0.55);

/* 카메라 컬링 반경 (FACILITY_ICON + 10% 버퍼) */
const CULL_RADIUS = LOD_ALT.FACILITY_ICON * 1.1;

/* ── 버스정류장 아이콘 ── */
const BUS_STATION_ICON = (() => {
    const size = 22;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d")!;
    const r = size / 2;
    ctx.beginPath(); ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "#00838f"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.round(size * 0.45)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("B", r, r + 0.5);
    return c.toDataURL();
})();

interface BusStationEntry {
    key: string;
    lng: number; lat: number; baseH: number;
    offsetPosition: Cesium.Cartesian3;
    parkingEnd: Cesium.Cartesian3;
    platformLength: number;
    stationName: string;
    station: any;
    /** 카메라 거리 컬링용 */
    cartesian: Cesium.Cartesian3;
}

interface ActiveBusRecord {
    billboard: Cesium.Billboard | null;
    label:     Cesium.Label | null;
    entities:  Cesium.Entity[];
}

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "busStation";
    public readonly dataSource: CustomDataSource;
    private stationMarkers: Cesium.BillboardCollection;
    private labelCollection: Cesium.LabelCollection;
    private clusterLayer: CesiumFacilityCluster;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private needsReload = false;

    private allEntries:    BusStationEntry[] = [];
    private activeRecords: Map<string, ActiveBusRecord> = new Map();
    private cullTimer:     ReturnType<typeof setTimeout> | null = null;
    private onCameraChanged = () => this.scheduleCull();

    // ── 버스정류장 타일링 (BUS_STATION_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: BusStationTileManager | null = null;
    private tileVersionId: string | null = null;
    private membership = new BusStationTileMembership();

    constructor(private viewer: Viewer) {
        this.dataSource      = new CustomDataSource(this.LAYER_NAME);
        this.stationMarkers  = new Cesium.BillboardCollection();
        this.labelCollection = new Cesium.LabelCollection();

        this.viewer.dataSources.add(this.dataSource);
        this.viewer.scene.primitives.add(this.stationMarkers);
        this.viewer.scene.primitives.add(this.labelCollection);
        this.clusterLayer = new CesiumFacilityCluster(this.viewer, { color: "#c62828" });

        this.viewer.scene.camera.changed.addEventListener(this.onCameraChanged);

        this.load();
        if (BUS_STATION_TILING.ENABLED) this.updateTiles(); // 첫 화면 정류장 타일 로드

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push(store.subscribe(
                (state: { currentJsonData: BusPublicStationResponse }) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
            // 저장 완료(isChanged: true → false) — SignalDataSourceLayer와 동일 조치.
            this.unsubscribes.push((store as any).subscribe(
                (s: any) => s.isChanged,
                (isChanged: boolean, prevIsChanged: boolean) => {
                    if (!prevIsChanged || isChanged) return;
                    const cur = store.getState().currentJsonData;
                    if (cur) store.getState().setOriginData(cur);
                    if (BUS_STATION_TILING.ENABLED) {
                        this.tileManager?.clear();
                        this.updateTiles();
                    }
                },
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

    private updateTiles(): void {
        if (!BUS_STATION_TILING.ENABLED) return;
        const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
        if (!rect) return;
        const west = Cesium.Math.toDegrees(rect.west);
        const south = Cesium.Math.toDegrees(rect.south);
        const east = Cesium.Math.toDegrees(rect.east);
        const north = Cesium.Math.toDegrees(rect.north);
        const versionId = getActiveVersionId();
        if (!versionId) return;
        // 버전 전환 감지 — 이전 버전 정류장 타일/멤버십 폐기 후 재생성(network/signal과 동일 패턴)
        if (this.tileManager && this.tileVersionId !== String(versionId)) {
            try { this.tileManager.clear(); } catch (_) { /* noop */ }
            this.tileManager = null;
        }
        this.tileVersionId = String(versionId);
        if (!this.tileManager) {
            this.tileManager = new BusStationTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.updateForBbox(west, south, east, north);
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show      = visible;
        this.stationMarkers.show  = visible;
        this.labelCollection.show = visible;
        this.clusterLayer.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("BusStationDataSourceLayer.load() 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        if (!this.dataSource.show) { this.needsReload = true; return; }
        this.needsReload = false;

        this.clearAllActive();
        this.allEntries = [];

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];
        if (!store || !networkStore) return;

        const busData: PublicTransitResponse = store.getState().currentJsonData;
        if (!busData) return;

        // 타일 모드: viewport 정류장(서버 최신) + 로컬 미저장 편집을 id 단위로 병합
        //   (2D BusStationFeatureLayer와 동일 조치 — diffRecordEditsById 참고).
        // 비-타일 모드: store 전체 정류장 그대로 사용.
        let busStationsAll: any[];
        if (BUS_STATION_TILING.ENABLED) {
            const originData = store.getState().originData as any;
            const { editedIds, deletedIds } = diffRecordEditsById(originData?.busStations, busData.busStations, 'id');
            const merged = new Map<string, any>();
            for (const s of this.membership.values()) {
                const id = String(s?.id ?? '');
                if (deletedIds.has(id)) continue;
                merged.set(id, s);
            }
            for (const s of (busData.busStations ?? [])) {
                const id = String(s?.id ?? '');
                if (editedIds.has(id)) merged.set(id, s);
            }
            busStationsAll = [...merged.values()];
        } else {
            busStationsAll = busData.busStations ?? [];
        }
        if (!busStationsAll.length) return;

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
        const rawEntries: Omit<BusStationEntry, 'baseH' | 'cartesian'>[] = [];

        for (const station of busStationsAll) {
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

            const carto       = Cesium.Cartographic.fromCartesian(offsetPosition);
            const lng         = Cesium.Math.toDegrees(carto.longitude);
            const lat         = Cesium.Math.toDegrees(carto.latitude);
            const stationName = (station as any).name ?? (station as any).stationName ?? "";
            const key         = String(station.id ?? (station as any).__guid ?? `${lng.toFixed(6)},${lat.toFixed(6)}`);

            rawEntries.push({ key, lng, lat, offsetPosition, parkingEnd, platformLength, stationName, station });
        }
        if (!rawEntries.length) return;

        /* ── 지형 고도 일괄 샘플링 ── */
        const terrainMap = new Map<string, number>();
        const hasRealTerrain = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        const tkey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

        if (hasRealTerrain) {
            const uk: string[] = [], uc: Cesium.Cartographic[] = [];
            for (const e of rawEntries) {
                const k = tkey(e.lng, e.lat);
                if (!terrainMap.has(k)) {
                    terrainMap.set(k, 0);
                    uk.push(k);
                    uc.push(Cesium.Cartographic.fromDegrees(e.lng, e.lat));
                }
            }
            try {
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, uc);
                for (let i = 0; i < uk.length; i++) terrainMap.set(uk[i]!, uc[i]!.height ?? 0);
            } catch (e) {
                console.warn("BusStationDataSourceLayer: 지형 고도 샘플링 실패", e);
            }
        }

        this.allEntries = rawEntries.map(e => {
            const baseH = terrainMap.get(tkey(e.lng, e.lat)) ?? 0;
            return {
                ...e,
                baseH,
                cartesian: Cesium.Cartesian3.fromDegrees(e.lng, e.lat, baseH + POLE_HEIGHT / 2),
            };
        });

        console.log(`BusStationDataSourceLayer: ${this.allEntries.length}개 정류장 준비`);
        this.clusterLayer.setPoints(this.allEntries.map(e => ({ lng: e.lng, lat: e.lat })));
        this.updateVisibleStations();
    }

    private scheduleCull(): void {
        if (this.cullTimer) return;
        this.cullTimer = setTimeout(() => {
            this.cullTimer = null;
            this.updateVisibleStations();
            if (BUS_STATION_TILING.ENABLED) this.updateTiles();
        }, 200);
    }

    private updateVisibleStations(): void {
        if (!this.dataSource.show || this.allEntries.length === 0) return;

        // overview(원거리) 군집 갱신 — 카메라 변경 흐름에 편승 (cluster tier에서만 표시)
        this.clusterLayer.update();

        const camPos = this.viewer.scene.camera.positionWC;
        const r2     = CULL_RADIUS * CULL_RADIUS;

        const wantKeys = new Set<string>();
        for (const e of this.allEntries) {
            const dx = camPos.x - e.cartesian.x;
            const dy = camPos.y - e.cartesian.y;
            const dz = camPos.z - e.cartesian.z;
            if (dx*dx + dy*dy + dz*dz <= r2) wantKeys.add(e.key);
        }

        /* 범위 밖 제거 */
        for (const [key, rec] of this.activeRecords) {
            if (!wantKeys.has(key)) {
                rec.entities.forEach(ent => this.dataSource.entities.remove(ent));
                if (rec.billboard) this.stationMarkers.remove(rec.billboard);
                if (rec.label)     this.labelCollection.remove(rec.label);
                this.activeRecords.delete(key);
            }
        }

        /* 새로 진입한 것 추가 */
        let added = 0;
        this.dataSource.entities.suspendEvents();
        try {
            for (const e of this.allEntries) {
                if (wantKeys.has(e.key) && !this.activeRecords.has(e.key)) {
                    this.addStation(e);
                    added++;
                }
            }
            if (added > 0) {
                this.stationMarkers.show  = this.dataSource.show;
                this.labelCollection.show = this.dataSource.show;
                if (this.dataSource.entities.values.length > 0) this.dataSource.show = true;
            }
        } finally {
            this.dataSource.entities.resumeEvents();
            if (added > 0) {
                try { this.viewer.scene.requestRender(); } catch (_) {}
            }
        }
    }

    private addStation(e: BusStationEntry): void {
        const { lng, lat, baseH, offsetPosition, parkingEnd, platformLength, stationName, station } = e;
        const entities: Cesium.Entity[] = [];

        /* ① 원거리 아이콘 빌보드 */
        const billboard = this.stationMarkers.add({
            position:                 Cesium.Cartesian3.fromDegrees(lng, lat, baseH + 0.5),
            image:                    BUS_STATION_ICON,
            width:                    22,
            height:                   22,
            distanceDisplayCondition: STATION_BB_DDC,
            scaleByDistance:          BB_SCALE_BY_DIST,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        /* ② 정류장 이름 라벨 */
        let label: Cesium.Label | null = null;
        if (stationName) {
            label = this.labelCollection.add({
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
            }) as unknown as Cesium.Label;
        }

        /* ③ 폴 */
        const poleE = new Entity({
            position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT / 2),
            cylinder: {
                length: POLE_HEIGHT, topRadius: POLE_RADIUS, bottomRadius: POLE_RADIUS,
                material: C_POLE, outline: false,
            },
        });
        (poleE as any).distanceDisplayCondition = DETAIL_DIST;
        entities.push(this.dataSource.entities.add(poleE));

        /* ④ 표지판 본체 */
        const signE = new Entity({
            position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT + SIGN_H / 2),
            box: {
                dimensions: new Cesium.Cartesian3(SIGN_W, SIGN_D, SIGN_H),
                material: C_SIGN, outline: false,
            },
            properties: new Cesium.PropertyBag({
                __guid: station.__guid, featureType: station.featureType ?? 'busStations',
                id: station.id, linkRef: station.linkRef, laneRef: station.laneRef,
                offset: station.offset, address: station.address,
                transitMode: station.transitMode, type: station.type,
            }),
        });
        (signE as any).distanceDisplayCondition = DETAIL_DIST;
        entities.push(this.dataSource.entities.add(signE));

        /* ⑤ 표지판 상단 밴드 */
        const bandH = 0.08;
        const bandE = new Entity({
            position: Cesium.Cartesian3.fromDegrees(lng, lat, baseH + POLE_HEIGHT + SIGN_H - bandH / 2),
            box: {
                dimensions: new Cesium.Cartesian3(SIGN_W + 0.02, SIGN_D + 0.02, bandH),
                material: C_SIGN_TOP, outline: false,
            },
        });
        (bandE as any).distanceDisplayCondition = DETAIL_DIST;
        entities.push(this.dataSource.entities.add(bandE));

        /* ⑥ 승강장 + 지붕 */
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
            entities.push(this.dataSource.entities.add(platformE));

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
            entities.push(this.dataSource.entities.add(shelterE));
        }

        this.activeRecords.set(e.key, { billboard, label, entities });
    }

    private clearAllActive(): void {
        this.dataSource.entities.suspendEvents();
        try { this.dataSource.entities.removeAll(); } finally { this.dataSource.entities.resumeEvents(); }
        this.stationMarkers.removeAll();
        this.labelCollection.removeAll();
        this.activeRecords.clear();
        this.clusterLayer?.setPoints([]);
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.cullTimer) { clearTimeout(this.cullTimer); this.cullTimer = null; }
        this.viewer.scene.camera.changed.removeEventListener(this.onCameraChanged);
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.tileManager?.clear();
        this.tileManager = null;
        this.viewer.dataSources.remove(this.dataSource, true);
        this.viewer.scene.primitives.remove(this.stationMarkers);
        this.viewer.scene.primitives.remove(this.labelCollection);
        this.clusterLayer.destroy();
    }
}
