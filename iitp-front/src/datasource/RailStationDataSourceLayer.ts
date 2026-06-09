import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { FEATURE_TYPE, RailPublicStationResponse, TRANSIT_MODE } from "@type/Station";
import { computePositionAtOffsetCesium } from "@utils/offset";

/* ── 치수 ── */
const POLE_HEIGHT    = 5.5;   // 폴 높이 (m)
const POLE_RADIUS    = 0.10;
const DISC_R         = 0.85;  // 원형 표지판 반경
const DISC_THICK     = 0.14;  // 표지판 두께
const SLAB_R_MAJ     = 2.0;   // 지면 슬래브 장반경
const SLAB_R_MIN     = 1.5;   // 지면 슬래브 단반경
const SLAB_H         = 0.25;  // 슬래브 높이
const STATION_R      = 7.0;   // 역 중심 지면 원 반경
const LANE_WIDTH      = 3.5;  // 차선 폭 (m)
const SIDEWALK_MARGIN = 2.0;  // 인도 여유 폭 (m)

/* ── 색상 ── */
const C_SUBWAY_BLUE  = Color.fromCssColorString("#0052a5");       // 한국 지하철 파랑
const C_DISC_INNER   = Color.fromCssColorString("#ffffff").withAlpha(0.9); // 원 내부 흰색
const C_POLE         = Color.fromCssColorString("#546e7a");       // 스틸 그레이
const C_SLAB         = Color.fromCssColorString("#0052a5").withAlpha(0.85);
const C_STATION_RING = Color.fromCssColorString("#0052a5").withAlpha(0.35);
const C_MARKER_EXIT  = Color.fromCssColorString("#1976d2");
const C_MARKER_STA   = Color.fromCssColorString("#0d47a1");

/* ── LOD ── */
const LOD_3D      = new Cesium.DistanceDisplayCondition(0.0, 400.0);
const LOD_LABEL   = new Cesium.DistanceDisplayCondition(0.0, 600.0);
const LOD_EXIT_LB = new Cesium.DistanceDisplayCondition(0.0, 180.0);
const MARKER_SCALE_EX  = new Cesium.NearFarScalar(30, 2.0, 3000, 0.2);
const FADE_OUT_EX = new Cesium.NearFarScalar(3000, 1.0, 5000, 0.0);

/* ── 역 중심 마커 아이콘 (모듈 레벨, 1회 생성) ── */
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

/* 역 중심 아이콘 표시 거리 (3D 모델이 사라지는 시점 이후) */
const STATION_BB_NEAR = 400;
const STATION_BB_FAR  = 10000;
const STATION_BB_DDC  = new Cesium.DistanceDisplayCondition(STATION_BB_NEAR, STATION_BB_FAR);

export default class RailStationDataSourceLayer {
    private readonly LAYER_NAME = "railStation";
    public readonly dataSource: CustomDataSource;
    private stationMarkers: Cesium.BillboardCollection;
    private exitMarkers:    Cesium.PointPrimitiveCollection;
    private labelCollection: Cesium.LabelCollection;
    private unsubscribes: Array<() => void> = [];
    private destroyed = false;
    private needsReload = false;

    constructor(private viewer: Viewer) {
        this.dataSource     = new CustomDataSource(this.LAYER_NAME);
        this.stationMarkers = new Cesium.BillboardCollection();
        this.exitMarkers    = new Cesium.PointPrimitiveCollection();
        this.labelCollection = new Cesium.LabelCollection();

        this.viewer.dataSources.add(this.dataSource);
        this.viewer.scene.primitives.add(this.stationMarkers);
        this.viewer.scene.primitives.add(this.exitMarkers);
        this.viewer.scene.primitives.add(this.labelCollection);

        this.load();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push((store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
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

    public setVisible(visible: boolean): void {
        this.dataSource.show      = visible;
        this.stationMarkers.show  = visible;
        this.exitMarkers.show     = visible;
        this.labelCollection.show = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        this.loadAsync().catch(e => console.error("[RailStationDataSourceLayer] load 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        // 레이어가 꺼진 상태면 스킵, 켜질 때 재로드
        if (!this.dataSource.show) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;

        this.stationMarkers.removeAll();
        this.exitMarkers.removeAll();
        this.labelCollection.removeAll();

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];
        if (!store || !networkStore) return;

        const response: RailPublicStationResponse | undefined = store.getState().currentJsonData;
        if (!response?.railStations?.length) return;

        const networkData: any = networkStore.getState().currentJsonData;
        if (!networkData?.links) return;

        /* ── linkId → {start, end, laneCount} 맵 ── */
        const linkCoordMap = new Map<string, { start: Cesium.Cartesian3; end: Cesium.Cartesian3; laneCount: number }>();
        for (const link of networkData.links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const first = link.coordinates[0];
            const last  = link.coordinates[link.coordinates.length - 1];
            const laneCount = Array.isArray(link.lanes) ? link.lanes.length : 1;
            linkCoordMap.set(String(link.id), {
                start: Cesium.Cartesian3.fromDegrees(first.lng, first.lat),
                end:   Cesium.Cartesian3.fromDegrees(last.lng,  last.lat),
                laneCount,
            });
        }

        /* ── 역별 exit 위치 계산 ── */
        interface ExitEntry { lng: number; lat: number; exitId: string; }
        interface StationEntry {
            stationName: string;
            centroidLng: number;
            centroidLat: number;
            exits: ExitEntry[];
            properties: any;
        }
        const entries: StationEntry[] = [];

        for (const station of response.railStations) {
            const rawExits = station.exits ?? [];
            const resolved: ExitEntry[] = [];

            for (const exit of rawExits) {
                const link = linkCoordMap.get(String(exit.linkRef));
                if (!link || exit.offset == null) continue;
                const { offsetPosition: onLinkPos } = computePositionAtOffsetCesium(link.start, link.end, exit.offset);

                // 링크 방향 벡터 → 수직(인도 방향) 오프셋 (lane 수 기반)
                const sidewalkOffset = link.laneCount * LANE_WIDTH + SIDEWALK_MARGIN;
                const dir = Cesium.Cartesian3.subtract(link.end, link.start, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(dir, dir);
                const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(onLinkPos, new Cesium.Cartesian3());
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

            // exit 없으면 coordinates 직접 사용
            let centroidLng: number, centroidLat: number;
            if (resolved.length > 0) {
                centroidLng = resolved.reduce((s, e) => s + e.lng, 0) / resolved.length;
                centroidLat = resolved.reduce((s, e) => s + e.lat, 0) / resolved.length;
            } else if ((station as any).coordinates?.lng && (station as any).coordinates?.lat) {
                centroidLng = (station as any).coordinates.lng;
                centroidLat = (station as any).coordinates.lat;
            } else {
                continue; // 위치 없으면 건너뜀
            }
            const stationName  = (station as any).address ?? (station as any).center ?? String(station.id ?? "");
            entries.push({ stationName, centroidLng, centroidLat, exits: resolved, properties: station });
        }

        if (entries.length === 0) return;

        /* ── 지형 고도 샘플링 ── */
        const terrainHeightMap = new Map<string, number>();
        const hasRealTerrain   = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        const coordKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

        if (hasRealTerrain) {
            const seen = new Set<string>();
            const keys: string[] = [];
            const cartos: Cesium.Cartographic[] = [];
            for (const entry of entries) {
                const addPt = (lng: number, lat: number) => {
                    const k = coordKey(lng, lat);
                    if (seen.has(k)) return;
                    seen.add(k); keys.push(k);
                    cartos.push(Cesium.Cartographic.fromDegrees(lng, lat));
                };
                entry.exits.forEach(e => addPt(e.lng, e.lat));
                addPt(entry.centroidLng, entry.centroidLat);
            }
            try {
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartos);
                keys.forEach((k, i) => terrainHeightMap.set(k, cartos[i]!.height ?? 0));
            } catch {
                console.warn("[RailStationDataSourceLayer] 지형 고도 샘플링 실패");
            }
        }

        /* ── 엔티티 생성 ── */
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            for (const entry of entries) {
                const { stationName, centroidLng, centroidLat, exits, properties } = entry;
                const stH = terrainHeightMap.get(coordKey(centroidLng, centroidLat)) ?? 0;

                /* ── 역 중심 ── */

                // ① 역 중심 대형 지면 원 (반투명)
                this.dataSource.entities.add(new Entity({
                    position: Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, stH),
                    ellipse: {
                        semiMajorAxis:  STATION_R,
                        semiMinorAxis:  STATION_R,
                        height:         stH,
                        extrudedHeight: stH + 0.15,
                        material:       C_STATION_RING,
                        outline:        true,
                        outlineColor:   C_SUBWAY_BLUE,
                        outlineWidth:   3,
                    },
                    properties: {
                        ...properties,
                        transitMode: properties.transitMode ?? TRANSIT_MODE.SUBWAY,
                        featureType: FEATURE_TYPE.RAIL_STATION,
                    },
                }));

                // ② 역 중심 원거리 아이콘 ("R" 빌보드)
                this.stationMarkers.add({
                    position:                 Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, stH + 1.0),
                    image:                    RAIL_STATION_ICON,
                    width:                    24,
                    height:                   24,
                    distanceDisplayCondition: STATION_BB_DDC,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });

                // ③ 역 이름 라벨
                if (stationName) {
                    this.labelCollection.add({
                        position:                 Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, stH + POLE_HEIGHT + DISC_R + 1.5),
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
                    });
                }

                /* ── 출구별 3D 모델 ── */
                for (const ex of exits) {
                    const exH = terrainHeightMap.get(coordKey(ex.lng, ex.lat)) ?? stH;

                    // ① 출구 원거리 마커
                    this.exitMarkers.add({
                        position:                 Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, exH + 0.5),
                        color:                    C_MARKER_EXIT,
                        pixelSize:               8,
                        outlineColor:             Cesium.Color.WHITE,
                        outlineWidth:             1.5,
                        scaleByDistance:          MARKER_SCALE_EX,
                        translucencyByDistance:   FADE_OUT_EX,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    });

                    // ② 지면 슬래브 — 출구 개구부 (LOD)
                    const slabE = new Entity({
                        position: Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, exH),
                        ellipse: {
                            semiMajorAxis:  SLAB_R_MAJ,
                            semiMinorAxis:  SLAB_R_MIN,
                            height:         exH,
                            extrudedHeight: exH + SLAB_H,
                            material:       C_SLAB,
                            outline:        false,
                        },
                        properties: { featureType: FEATURE_TYPE.RAIL_STATION_EXIT, exitId: ex.exitId },
                    });
                    (slabE as any).distanceDisplayCondition = LOD_3D;
                    this.dataSource.entities.add(slabE);

                    // ③ 폴 (LOD)
                    const poleE = new Entity({
                        position: Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, exH + SLAB_H + POLE_HEIGHT / 2),
                        cylinder: {
                            length:       POLE_HEIGHT,
                            topRadius:    POLE_RADIUS,
                            bottomRadius: POLE_RADIUS,
                            material:     C_POLE,
                            outline:      false,
                        },
                    });
                    (poleE as any).distanceDisplayCondition = LOD_3D;
                    this.dataSource.entities.add(poleE);

                    // ④ 원형 표지판 — 파랑 디스크 (LOD)
                    const discTop = exH + SLAB_H + POLE_HEIGHT + DISC_R;
                    const discE = new Entity({
                        position: Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, discTop),
                        ellipse: {
                            semiMajorAxis:  DISC_R,
                            semiMinorAxis:  DISC_R,
                            height:         discTop - DISC_THICK,
                            extrudedHeight: discTop,
                            material:       C_SUBWAY_BLUE,
                            outline:        false,
                        },
                    });
                    (discE as any).distanceDisplayCondition = LOD_3D;
                    this.dataSource.entities.add(discE);

                    // ⑤ 표지판 내부 흰 원 (M자 느낌)
                    const innerR = DISC_R * 0.55;
                    const innerE = new Entity({
                        position: Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, discTop),
                        ellipse: {
                            semiMajorAxis:  innerR,
                            semiMinorAxis:  innerR,
                            height:         discTop,
                            extrudedHeight: discTop + 0.02,
                            material:       C_DISC_INNER,
                            outline:        false,
                        },
                    });
                    (innerE as any).distanceDisplayCondition = LOD_3D;
                    this.dataSource.entities.add(innerE);

                    // ⑥ 출구 번호 라벨 (근거리)
                    if (ex.exitId) {
                        this.labelCollection.add({
                            position:                 Cesium.Cartesian3.fromDegrees(ex.lng, ex.lat, discTop + 0.5),
                            text:                     ex.exitId,
                            font:                     "bold 16px sans-serif",
                            fillColor:                Cesium.Color.WHITE,
                            outlineColor:             C_SUBWAY_BLUE,
                            outlineWidth:             3,
                            style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
                            horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
                            verticalOrigin:           Cesium.VerticalOrigin.CENTER,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            distanceDisplayCondition: LOD_EXIT_LB,
                        });
                    }
                }
            }

            console.log(`[RailStationDataSourceLayer] 완료: ${entries.length}개 역`);
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
        this.viewer.scene.primitives.remove(this.stationMarkers);
        this.viewer.scene.primitives.remove(this.exitMarkers);
        this.viewer.scene.primitives.remove(this.labelCollection);
    }
}
