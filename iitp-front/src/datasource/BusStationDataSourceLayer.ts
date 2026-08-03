import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusPublicStationResponse } from "@type/Station";
import { computePositionAtOffsetPolylineCesium, computeLaneCenterlineCesium, computeMedianCenterlineCesium } from "@utils/offset";
import { PublicTransitResponse } from "@type/openapi.gen";
import { LOD_ALT, BUS_STATION_TILING } from "@utils/lodConstants";
import { CesiumFacilityCluster } from "@datasource/cesiumFacilityCluster";
import { getActiveVersionId } from "@utils/versionId";
import { BusStationTileManager } from "@managers/BusStationTileManager";
import { BusStationTileMembership } from "@managers/busStationTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";

/* ── 치수 ── */
const PARKING_LOT_LEN_M = 14;
const DEFAULT_SHELTER_LEN_M = 5.0; // parkingLots 미지정 시 기본 쉼터 길이(실제 표준 쉼터 1칸 정도)
const POLE_HEIGHT        = 4.0;
const POLE_RADIUS        = 0.07;
const SIGN_W             = 0.8;
const SIGN_H             = 0.5;
const SIGN_D             = 0.12;
const PLATFORM_H         = 0.3;
const PLATFORM_W         = 3.2;
const SHELTER_H          = 2.6;
const SHELTER_THICK      = 0.12;
const SHELTER_W          = PLATFORM_W + 0.6;
const LEG_RADIUS         = 0.06;
const LEG_INSET          = 0.25;   // 지붕 모서리에서 살짝 안쪽으로 다리 배치
const WALL_H              = SHELTER_H - 0.35; // 지붕 아래 살짝 공간을 남김(환기/채광 느낌)
const BENCH_H             = 0.45;
const BENCH_D             = 0.42;
const BENCH_W_MARGIN      = 1.0;   // 벤치가 승강장 양끝에서 떨어지는 여유

/* ── 색상 ── */
const C_POLE      = Color.fromCssColorString("#607d8b");
const C_SIGN      = Color.fromCssColorString("#00838f");
const C_SIGN_TOP  = Color.fromCssColorString("#ffe082");
const C_PLATFORM  = Color.fromCssColorString("#e0e0e0").withAlpha(0.9);
const C_SHELTER   = Color.fromCssColorString("#cfe8f5").withAlpha(0.38);
const C_FRAME     = Color.fromCssColorString("#37474f");
const C_GLASS     = Color.fromCssColorString("#bbdefb").withAlpha(0.28);
const C_BENCH     = Color.fromCssColorString("#8d6e63");
/* 디버깅용 — medianLane(중앙버스전용차로) 정류장 승강장을 다른 색으로 표시해 실제로
 * 어떤 정류장이 중앙차로로 분류됐는지 지도에서 바로 구분할 수 있게 한다. */
const C_PLATFORM_MEDIAN = Color.fromCssColorString("#ff4081").withAlpha(0.9);

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
    /** offsetPosition→parkingEnd 진행방향 단위벡터 — 쉼터 다리/유리벽 배치용 */
    dir: Cesium.Cartesian3;
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

        /* ── 링크별 레인 중심선(전체 폴리라인) 사전 계산 ──
         * 첫/끝 점만 쓰면 곡선 링크에서 정류장 위치가 실제 저장 지점과 어긋난다
         * (2D BusStationFeatureLayer와 동일 조치 — computeLaneCenterlineCesium 참고). */
        const linkLaneMap = new Map<string, Cesium.Cartesian3[][]>();
        const linkById = new Map<string, any>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            linkById.set(String(link.id), link);
            const laneCount = link.lanes?.length ?? 0;
            if (laneCount === 0) continue;

            const lanes: Cesium.Cartesian3[][] = [];
            for (let i = 0; i < laneCount; i++) {
                const centerline = computeLaneCenterlineCesium(link, i);
                if (centerline) lanes.push(centerline);
            }
            linkLaneMap.set(String(link.id), lanes);
        }

        /* ── 정류장 위치 계산 ── */
        const rawEntries: Omit<BusStationEntry, 'baseH' | 'cartesian'>[] = [];

        for (const station of busStationsAll) {
            const linkRef = String(station.linkRef);
            if (!station.offset) continue;

            // 중앙버스전용차로(medianLane) 정류장 — 이 링크 혼자만의 차선 배열이 아니라
            // 상하행 링크 사이 실제 물리적 중앙(중앙분리대)에 배치한다(실사용 지적: "중앙차선일
            // 경우 링크의 중앙이 아닌 상하행의 중간에 있어야 함").
            let laneAllPts: Cesium.Cartesian3[] | null = null;
            if (station.medianLane) {
                const link = linkById.get(linkRef);
                if (link) laneAllPts = computeMedianCenterlineCesium(link, networkData.links);
            }
            if (!laneAllPts) {
                const laneRef = Number(station.laneRef);
                const lanes   = linkLaneMap.get(linkRef);
                if (!lanes || laneRef < 0 || laneRef >= lanes.length) continue;
                laneAllPts = lanes[laneRef] ?? null;
            }
            if (!laneAllPts) continue;

            const { offsetPosition, direction: dir } = computePositionAtOffsetPolylineCesium(laneAllPts, station.offset);

            // ⚠️ 실측: parkingLots가 현재 데이터에 전부 null/0 — 그대로 두면 platformLength가
            // 항상 0이 돼 쉼터(승강장+지붕+다리+유리벽+벤치)가 단 한 번도 그려지지 않는다.
            // parkingLots가 있으면 그 값대로 크기를 정하고, 없으면 표준 쉼터 1칸 크기로 폴백.
            const parkingLots    = station.parkingLots ?? 0;
            const platformLength = parkingLots > 0 ? parkingLots * PARKING_LOT_LEN_M : DEFAULT_SHELTER_LEN_M;
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

            rawEntries.push({ key, lng, lat, offsetPosition, parkingEnd, dir, platformLength, stationName, station });
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
        const { lng, lat, baseH, offsetPosition, parkingEnd, dir, platformLength, stationName, station } = e;
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

        /* ⑥ 승강장 + 쉼터(지붕·유리벽·다리·벤치) — 실제 버스쉼터처럼 지붕이 다리 없이
         * 붕 떠 보이던 것을 프레임 구조물로 보강 (2026-08-03 "실제와 유사하게" 요청). */
        if (platformLength > 0) {
            const platformE = new Entity({
                corridor: {
                    positions: [offsetPosition, parkingEnd],
                    width: PLATFORM_W,
                    height: baseH,
                    extrudedHeight: baseH + PLATFORM_H,
                    material: station.medianLane ? C_PLATFORM_MEDIAN : C_PLATFORM,
                    cornerType: Cesium.CornerType.MITERED,
                },
            });
            (platformE as any).distanceDisplayCondition = DETAIL_DIST;
            entities.push(this.dataSource.entities.add(platformE));

            const shelterE = new Entity({
                corridor: {
                    positions: [offsetPosition, parkingEnd],
                    width: SHELTER_W,
                    height: baseH + SHELTER_H,
                    extrudedHeight: baseH + SHELTER_H + SHELTER_THICK,
                    material: C_SHELTER,
                    outline: true, outlineColor: C_FRAME,
                    cornerType: Cesium.CornerType.MITERED,
                },
            });
            (shelterE as any).distanceDisplayCondition = DETAIL_DIST;
            entities.push(this.dataSource.entities.add(shelterE));

            // 진행방향(dir)에 수직한 "우측" 법선 — NetworkFeatureLayer의 우측(+) 법선 규약과
            // 통일(nx=dy,ny=-dx / cross(dir,up)). 지붕 모서리·유리벽·벤치 배치 기준축.
            const up = Cesium.Cartesian3.normalize(offsetPosition, new Cesium.Cartesian3());
            const lateral = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3()), new Cesium.Cartesian3());
            const halfW = SHELTER_W / 2 - LEG_INSET;
            const lateralOffset = (base: Cesium.Cartesian3, sign: 1 | -1) => Cesium.Cartesian3.add(
                base, Cesium.Cartesian3.multiplyByScalar(lateral, sign * halfW, new Cesium.Cartesian3()),
                new Cesium.Cartesian3());

            /* 지붕을 받치는 4개 다리 */
            const corners = [
                lateralOffset(offsetPosition, 1), lateralOffset(offsetPosition, -1),
                lateralOffset(parkingEnd, 1),     lateralOffset(parkingEnd, -1),
            ];
            for (const c of corners) {
                const legCarto = Cesium.Cartographic.fromCartesian(c);
                const legLng = Cesium.Math.toDegrees(legCarto.longitude);
                const legLat = Cesium.Math.toDegrees(legCarto.latitude);
                const legE = new Entity({
                    position: Cesium.Cartesian3.fromDegrees(legLng, legLat, baseH + SHELTER_H / 2),
                    cylinder: {
                        length: SHELTER_H, topRadius: LEG_RADIUS, bottomRadius: LEG_RADIUS,
                        material: C_FRAME, outline: false,
                    },
                });
                (legE as any).distanceDisplayCondition = DETAIL_DIST;
                entities.push(this.dataSource.entities.add(legE));
            }

            /* 양끝 유리벽 — 앞(도로 쪽)은 뚫려있는 실제 쉼터처럼 짧은 두 변만 막는다 */
            const wallEnds: Array<[Cesium.Cartesian3, Cesium.Cartesian3]> = [
                [lateralOffset(offsetPosition, 1), lateralOffset(offsetPosition, -1)],
                [lateralOffset(parkingEnd, 1),     lateralOffset(parkingEnd, -1)],
            ];
            for (const [wa, wb] of wallEnds) {
                const wallE = new Entity({
                    wall: {
                        positions: [wa, wb],
                        minimumHeights: [baseH, baseH],
                        maximumHeights: [baseH + WALL_H, baseH + WALL_H],
                        material: C_GLASS,
                        outline: true, outlineColor: C_FRAME.withAlpha(0.7),
                    },
                });
                (wallE as any).distanceDisplayCondition = DETAIL_DIST;
                entities.push(this.dataSource.entities.add(wallE));
            }

            /* 벤치 — 승강장 안쪽 한 변을 따라 배치. 박스 dimensions는 기본적으로 로컬
             * East-North-Up 기준이라, dir(진행방향)에 맞춰 세우려면 heading을 구해 회전해야
             * 한다 — dir은 ECEF Cartesian3라 x/y를 그대로 동/북으로 쓸 수 없으므로(전역 축과
             * 지역 동/북 축은 다르다), SignalDataSourceLayer.headingRad와 동일하게 lng/lat
             * 델타 기반 평면 근사로 계산한다(벤치는 대칭이라 ±180° 방향 오차는 무관). */
            const benchLen = Math.max(0, platformLength - BENCH_W_MARGIN * 2);
            if (benchLen > 0.5) {
                const mid = Cesium.Cartesian3.lerp(offsetPosition, parkingEnd, 0.5, new Cesium.Cartesian3());
                const benchCenter = lateralOffset(mid, -1);
                const benchCarto = Cesium.Cartographic.fromCartesian(benchCenter);
                const startCarto = Cesium.Cartographic.fromCartesian(offsetPosition);
                const endCarto   = Cesium.Cartographic.fromCartesian(parkingEnd);
                const dLng = endCarto.longitude - startCarto.longitude;
                const dLat = endCarto.latitude  - startCarto.latitude;
                const heading = Math.atan2(dLng * Math.cos(benchCarto.latitude), dLat);
                const benchPos = Cesium.Cartesian3.fromRadians(benchCarto.longitude, benchCarto.latitude, baseH + BENCH_H / 2);
                const orientation = Cesium.Transforms.headingPitchRollQuaternion(
                    benchPos, new Cesium.HeadingPitchRoll(heading, 0, 0));
                const benchE = new Entity({
                    position: benchPos,
                    orientation,
                    box: {
                        dimensions: new Cesium.Cartesian3(BENCH_D, benchLen, BENCH_H),
                        material: C_BENCH, outline: false,
                    },
                });
                (benchE as any).distanceDisplayCondition = DETAIL_DIST;
                entities.push(this.dataSource.entities.add(benchE));
            }
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
