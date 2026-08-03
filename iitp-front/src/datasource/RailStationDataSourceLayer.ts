import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FEATURE_TYPE, RailPublicStationResponse, TRANSIT_MODE } from "@type/Station";
import { computePositionAtOffsetPolylineCesium } from "@utils/offset";
import { LOD_ALT, RAIL_STATION_TILING } from "@utils/lodConstants";
import { CesiumFacilityCluster } from "@datasource/cesiumFacilityCluster";
import { getActiveVersionId } from "@utils/versionId";
import { RailStationTileManager } from "@managers/RailStationTileManager";
import { RailStationTileMembership } from "@managers/railStationTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";

/* ── 치수 ── */
const POLE_HEIGHT    = 5.5;
const POLE_RADIUS    = 0.10;
const DISC_R         = 0.85;
const DISC_THICK     = 0.14;
const SLAB_R_MAJ     = 2.0;
const SLAB_R_MIN     = 1.5;
const SLAB_H         = 0.25;
const STATION_R      = 7.0;
const LANE_WIDTH      = 3.5;
const SIDEWALK_MARGIN = 2.0;

/* ── 색상 ── */
const C_SUBWAY_BLUE  = Color.fromCssColorString("#0052a5");
const C_DISC_INNER   = Color.fromCssColorString("#ffffff").withAlpha(0.9);
const C_POLE         = Color.fromCssColorString("#546e7a");
const C_SLAB         = Color.fromCssColorString("#0052a5").withAlpha(0.85);
const C_STATION_RING = Color.fromCssColorString("#0052a5").withAlpha(0.35);

/* ── LOD ── */
const LOD_3D      = new Cesium.DistanceDisplayCondition(0.0, LOD_ALT.FACILITY_DETAIL);
const LOD_LABEL   = new Cesium.DistanceDisplayCondition(0.0, 600.0);
const LOD_EXIT_LB = new Cesium.DistanceDisplayCondition(0.0, 180.0);
const MARKER_SCALE_EX = new Cesium.NearFarScalar(30, 2.0, 3000, 0.2);
const FADE_OUT_EX     = new Cesium.NearFarScalar(3000, 1.0, 5000, 0.0);
const STATION_BB_DDC  = new Cesium.DistanceDisplayCondition(LOD_ALT.FACILITY_DETAIL, LOD_ALT.FACILITY_ICON);

/** 카메라 컬링 반경 */
const CULL_RADIUS = LOD_ALT.FACILITY_ICON * 1.1;

/* ── 역 중심 마커 아이콘 ── */
const RAIL_STATION_ICON = (() => {
    const size = 24;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d")!;
    const r = size / 2;
    ctx.beginPath(); ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "#0052a5"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.round(size * 0.42)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("R", r, r + 0.5);
    return c.toDataURL();
})();

interface ExitData { lng: number; lat: number; exitId: string; exitH: number; }

interface RailStationEntry {
    key: string;
    stationName: string;
    centroidLng: number;
    centroidLat: number;
    centroidH: number;
    exits: ExitData[];
    properties: any;
    /** 카메라 거리 컬링용 */
    cartesian: Cesium.Cartesian3;
}

interface ActiveRailRecord {
    billboard:  Cesium.Billboard | null;
    exitPoints: Cesium.PointPrimitive[];
    labels:     Cesium.Label[];
    entities:   Cesium.Entity[];
}

export default class RailStationDataSourceLayer {
    private readonly LAYER_NAME = "railStation";
    public readonly dataSource: CustomDataSource;
    private stationMarkers: Cesium.BillboardCollection;
    private exitMarkers:    Cesium.PointPrimitiveCollection;
    private labelCollection: Cesium.LabelCollection;
    private clusterLayer: CesiumFacilityCluster;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private needsReload = false;

    private allEntries:    RailStationEntry[] = [];
    private activeRecords: Map<string, ActiveRailRecord> = new Map();
    private cullTimer:     ReturnType<typeof setTimeout> | null = null;
    private onCameraChanged = () => this.scheduleCull();

    // ── 철도정류장 타일링 (RAIL_STATION_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: RailStationTileManager | null = null;
    private tileVersionId: string | null = null;
    private membership = new RailStationTileMembership();

    constructor(private viewer: Viewer) {
        this.dataSource      = new CustomDataSource(this.LAYER_NAME);
        this.stationMarkers  = new Cesium.BillboardCollection();
        this.exitMarkers     = new Cesium.PointPrimitiveCollection();
        this.labelCollection = new Cesium.LabelCollection();

        this.viewer.dataSources.add(this.dataSource);
        this.viewer.scene.primitives.add(this.stationMarkers);
        this.viewer.scene.primitives.add(this.exitMarkers);
        this.viewer.scene.primitives.add(this.labelCollection);
        this.clusterLayer = new CesiumFacilityCluster(this.viewer, { color: "#1565c0" });

        this.viewer.scene.camera.changed.addEventListener(this.onCameraChanged);

        this.load();
        if (RAIL_STATION_TILING.ENABLED) this.updateTiles(); // 첫 화면 정류장 타일 로드

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push((store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
            // 저장 완료(isChanged: true → false) — BusStationDataSourceLayer/SignalDataSourceLayer와 동일 조치.
            this.unsubscribes.push((store as any).subscribe(
                (s: any) => s.isChanged,
                (isChanged: boolean, prevIsChanged: boolean) => {
                    if (!prevIsChanged || isChanged) return;
                    const cur = store.getState().currentJsonData;
                    if (cur) store.getState().setOriginData(cur);
                    if (RAIL_STATION_TILING.ENABLED) {
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
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
        }
    }

    private updateTiles(): void {
        if (!RAIL_STATION_TILING.ENABLED) return;
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
            this.tileManager = new RailStationTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.updateForBbox(west, south, east, north);
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show      = visible;
        this.stationMarkers.show  = visible;
        this.exitMarkers.show     = visible;
        this.labelCollection.show = visible;
        this.clusterLayer.setVisible(visible);
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("[RailStationDataSourceLayer] load 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        if (!this.dataSource.show) { this.needsReload = true; return; }
        this.needsReload = false;

        this.clearAllActive();
        this.allEntries = [];

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];
        if (!store || !networkStore) return;

        const response: RailPublicStationResponse | undefined = store.getState().currentJsonData;
        if (!response) return;

        // 타일 모드: viewport 정류장(서버 최신) + 로컬 미저장 편집을 id 단위로 병합
        //   (2D RailStationFeatureLayer와 동일 조치 — diffRecordEditsById 참고).
        // 비-타일 모드: store 전체 정류장 그대로 사용.
        let railStationsAll: any[];
        if (RAIL_STATION_TILING.ENABLED) {
            const originData = store.getState().originData as any;
            const { editedIds, deletedIds } = diffRecordEditsById(originData?.railStations, response.railStations, 'id');
            const merged = new Map<string, any>();
            for (const s of this.membership.values()) {
                const id = String(s?.id ?? '');
                if (deletedIds.has(id)) continue;
                merged.set(id, s);
            }
            for (const s of (response.railStations ?? [])) {
                const id = String(s?.id ?? '');
                if (editedIds.has(id)) merged.set(id, s);
            }
            railStationsAll = [...merged.values()];
        } else {
            railStationsAll = response.railStations ?? [];
        }
        if (!railStationsAll.length) return;

        const networkData: any = networkStore.getState().currentJsonData;
        if (!networkData?.links) return;

        /* ── linkId → {allPts, laneCount} ── 첫/끝 점만 쓰면 곡선 링크에서 출구 위치가
         * 어긋난다(2D railStationPosition.ts와 동일 조치). */
        const linkCoordMap = new Map<string, { allPts: Cesium.Cartesian3[]; laneCount: number }>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const allPts = link.coordinates.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            const laneCount = Array.isArray(link.lanes) ? link.lanes.length : 1;
            linkCoordMap.set(String(link.id), { allPts, laneCount });
        }

        /* ── 역별 exit 위치 계산 ── */
        const rawEntries: Omit<RailStationEntry, 'centroidH' | 'cartesian'>[] = [];

        for (const station of railStationsAll) {
            const rawExits = station.exits ?? [];
            const resolved: Omit<ExitData, 'exitH'>[] = [];

            for (const exit of rawExits) {
                const link = linkCoordMap.get(String(exit.linkRef));
                if (!link || exit.offset == null) continue;
                const { offsetPosition: onLinkPos, direction: dir } = computePositionAtOffsetPolylineCesium(link.allPts, exit.offset);

                const sidewalkOffset = link.laneCount * LANE_WIDTH + SIDEWALK_MARGIN;
                const up   = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(onLinkPos, new Cesium.Cartesian3());
                const perp = Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(perp, perp);
                const move = Cesium.Cartesian3.multiplyByScalar(perp, sidewalkOffset, new Cesium.Cartesian3());
                const sidewalkPos = Cesium.Cartesian3.add(onLinkPos, move, new Cesium.Cartesian3());

                const carto = Cesium.Cartographic.fromCartesian(sidewalkPos);
                resolved.push({
                    lng:    Cesium.Math.toDegrees(carto.longitude),
                    lat:    Cesium.Math.toDegrees(carto.latitude),
                    exitId: String(exit.id ?? ""),
                });
            }
            if (resolved.length === 0) continue;

            const centroidLng = resolved.reduce((s, e) => s + e.lng, 0) / resolved.length;
            const centroidLat = resolved.reduce((s, e) => s + e.lat, 0) / resolved.length;
            const stationName = (station as any).address ?? (station as any).center ?? String(station.id ?? "");
            const key         = String(station.id ?? `${centroidLng.toFixed(6)},${centroidLat.toFixed(6)}`);

            rawEntries.push({ key, stationName, centroidLng, centroidLat, exits: resolved as ExitData[], properties: station });
        }
        if (!rawEntries.length) return;

        /* ── 지형 고도 샘플링 ── */
        const terrainMap   = new Map<string, number>();
        const hasRealTerrain = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        const tkey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

        if (hasRealTerrain) {
            const seen = new Set<string>();
            const keys: string[] = [], cartos: Cesium.Cartographic[] = [];
            const addPt = (lng: number, lat: number) => {
                const k = tkey(lng, lat);
                if (seen.has(k)) return;
                seen.add(k); keys.push(k);
                cartos.push(Cesium.Cartographic.fromDegrees(lng, lat));
            };
            for (const e of rawEntries) {
                addPt(e.centroidLng, e.centroidLat);
                e.exits.forEach(ex => addPt(ex.lng, ex.lat));
            }
            try {
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartos);
                keys.forEach((k, i) => terrainMap.set(k, cartos[i]!.height ?? 0));
            } catch {
                console.warn("[RailStationDataSourceLayer] 지형 고도 샘플링 실패");
            }
        }

        this.allEntries = rawEntries.map(e => {
            const centroidH = terrainMap.get(tkey(e.centroidLng, e.centroidLat)) ?? 0;
            const exitsWithH: ExitData[] = e.exits.map(ex => ({
                ...ex,
                exitH: terrainMap.get(tkey(ex.lng, ex.lat)) ?? centroidH,
            }));
            return {
                ...e,
                exits: exitsWithH,
                centroidH,
                cartesian: Cesium.Cartesian3.fromDegrees(e.centroidLng, e.centroidLat, centroidH + 1.0),
            };
        });

        console.log(`[RailStationDataSourceLayer] ${this.allEntries.length}개 역 준비`);
        this.clusterLayer.setPoints(this.allEntries.map(e => ({ lng: e.centroidLng, lat: e.centroidLat })));
        this.updateVisibleStations();
    }

    private scheduleCull(): void {
        if (this.cullTimer) return;
        this.cullTimer = setTimeout(() => {
            this.cullTimer = null;
            this.updateVisibleStations();
            if (RAIL_STATION_TILING.ENABLED) this.updateTiles();
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
                rec.exitPoints.forEach(p  => this.exitMarkers.remove(p));
                rec.labels.forEach(lb     => this.labelCollection.remove(lb));
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
                this.exitMarkers.show     = this.dataSource.show;
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

    private addStation(e: RailStationEntry): void {
        const { centroidLng, centroidLat, centroidH, stationName, exits, properties } = e;
        const entities: Cesium.Entity[]            = [];
        const exitPoints: Cesium.PointPrimitive[]  = [];
        const labels: Cesium.Label[]               = [];

        /* ① 역 중심 지면 원 */
        entities.push(this.dataSource.entities.add(new Entity({
            position: Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, centroidH),
            ellipse: {
                semiMajorAxis: STATION_R, semiMinorAxis: STATION_R,
                height: centroidH, extrudedHeight: centroidH + 0.15,
                material: C_STATION_RING, outline: true,
                outlineColor: C_SUBWAY_BLUE, outlineWidth: 3,
            },
            properties: {
                ...properties,
                transitMode: properties.transitMode ?? TRANSIT_MODE.SUBWAY,
                featureType: FEATURE_TYPE.RAIL_STATION,
            },
        })));

        /* ② 역 중심 원거리 아이콘 */
        const billboard = this.stationMarkers.add({
            position:                 Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, centroidH + 1.0),
            image:                    RAIL_STATION_ICON,
            width:                    24,
            height:                   24,
            distanceDisplayCondition: STATION_BB_DDC,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        /* ③ 역 이름 라벨 */
        if (stationName) {
            labels.push(this.labelCollection.add({
                position:                 Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, centroidH + POLE_HEIGHT + DISC_R + 1.5),
                text:                     stationName,
                font:                     "bold 15px sans-serif",
                fillColor:                Cesium.Color.WHITE,
                outlineColor:             Cesium.Color.BLACK,
                outlineWidth:             2.5,
                style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
                horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
                verticalOrigin:           Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                distanceDisplayCondition: LOD_LABEL,
                scaleByDistance:          new Cesium.NearFarScalar(100, 1.2, 600, 0.7),
            }) as unknown as Cesium.Label);
        }

        /* ── 출구별 3D 모델 ── */
        for (const ex of exits) {
            const { lng, lat, exitH, exitId } = ex;

            /* 출구 원거리 마커 */
            exitPoints.push(this.exitMarkers.add({
                position:                 Cesium.Cartesian3.fromDegrees(lng, lat, exitH + 0.5),
                color:                    Color.fromCssColorString("#1976d2"),
                pixelSize:               8,
                outlineColor:             Cesium.Color.WHITE,
                outlineWidth:             1.5,
                scaleByDistance:          MARKER_SCALE_EX,
                translucencyByDistance:   FADE_OUT_EX,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }) as unknown as Cesium.PointPrimitive);

            /* 지면 슬래브 — 테두리를 줘서 포장재 경계가 또렷해 보이게 함 */
            const slabE = new Entity({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, exitH),
                ellipse: {
                    semiMajorAxis: SLAB_R_MAJ, semiMinorAxis: SLAB_R_MIN,
                    height: exitH, extrudedHeight: exitH + SLAB_H,
                    material: C_SLAB, outline: true, outlineColor: C_SUBWAY_BLUE.withAlpha(0.9),
                },
                properties: { featureType: FEATURE_TYPE.RAIL_STATION_EXIT, exitId },
            });
            (slabE as any).distanceDisplayCondition = LOD_3D;
            entities.push(this.dataSource.entities.add(slabE));

            /* 폴 */
            const poleE = new Entity({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, exitH + SLAB_H + POLE_HEIGHT / 2),
                cylinder: {
                    length: POLE_HEIGHT, topRadius: POLE_RADIUS, bottomRadius: POLE_RADIUS,
                    material: C_POLE, outline: false,
                },
            });
            (poleE as any).distanceDisplayCondition = LOD_3D;
            entities.push(this.dataSource.entities.add(poleE));

            /* 폴 캡 — 폴이 표지판 속으로 그냥 파묻히지 않고 마감된 것처럼 보이게 하는 작은 돔 */
            const capE = new Entity({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, exitH + SLAB_H + POLE_HEIGHT),
                ellipsoid: {
                    radii: new Cesium.Cartesian3(POLE_RADIUS * 1.8, POLE_RADIUS * 1.8, POLE_RADIUS * 1.8),
                    material: C_POLE,
                },
            });
            (capE as any).distanceDisplayCondition = LOD_3D;
            entities.push(this.dataSource.entities.add(capE));

            /* 원형 표지판 — 서울교통공사 출구 표지판처럼 흰 테두리 링으로 마감 */
            const discTop = exitH + SLAB_H + POLE_HEIGHT + DISC_R;
            const discE = new Entity({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, discTop),
                ellipse: {
                    semiMajorAxis: DISC_R, semiMinorAxis: DISC_R,
                    height: discTop - DISC_THICK, extrudedHeight: discTop,
                    material: C_SUBWAY_BLUE, outline: true, outlineColor: C_DISC_INNER,
                },
            });
            (discE as any).distanceDisplayCondition = LOD_3D;
            entities.push(this.dataSource.entities.add(discE));

            /* 표지판 내부 흰 원 */
            const innerR = DISC_R * 0.55;
            const innerE = new Entity({
                position: Cesium.Cartesian3.fromDegrees(lng, lat, discTop),
                ellipse: {
                    semiMajorAxis: innerR, semiMinorAxis: innerR,
                    height: discTop, extrudedHeight: discTop + 0.02,
                    material: C_DISC_INNER, outline: false,
                },
            });
            (innerE as any).distanceDisplayCondition = LOD_3D;
            entities.push(this.dataSource.entities.add(innerE));

            /* 출구 번호 라벨 */
            if (exitId) {
                labels.push(this.labelCollection.add({
                    position:                 Cesium.Cartesian3.fromDegrees(lng, lat, discTop + 0.5),
                    text:                     exitId,
                    font:                     "bold 16px sans-serif",
                    fillColor:                Cesium.Color.WHITE,
                    outlineColor:             C_SUBWAY_BLUE,
                    outlineWidth:             3,
                    style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
                    horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin:           Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    distanceDisplayCondition: LOD_EXIT_LB,
                }) as unknown as Cesium.Label);
            }
        }

        this.activeRecords.set(e.key, { billboard, exitPoints, labels, entities });
    }

    private clearAllActive(): void {
        this.dataSource.entities.suspendEvents();
        try { this.dataSource.entities.removeAll(); } finally { this.dataSource.entities.resumeEvents(); }
        this.stationMarkers.removeAll();
        this.exitMarkers.removeAll();
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
        this.viewer.scene.primitives.remove(this.exitMarkers);
        this.viewer.scene.primitives.remove(this.labelCollection);
        this.clusterLayer.destroy();
    }
}
