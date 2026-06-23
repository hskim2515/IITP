import * as Cesium from "cesium";
import type { Viewer } from "cesium";
import { getFacilityLodTierByAltitude, FACILITY_CLUSTERING } from "@utils/lodConstants";

export interface ClusterPoint {
    lng: number;
    lat: number;
}

interface ClusterOptions {
    /** 군집 버블 색상 (CSS) */
    color: string;
}

/**
 * Cesium 빌보드 시설물의 overview(원거리) 격자 클러스터.
 *
 * Cesium 네이티브 클러스터링은 Entity 전용이라, BillboardCollection 기반 시설물에는
 * 적용되지 않는다. 이 헬퍼는 카메라 고도가 cluster tier일 때 점들을 화면-안정적
 * 격자(cell ∝ 카메라 고도)로 묶어 군집 빌보드(개수 포함)를 표시한다.
 *
 * 개별 마커는 DDC(STATION_BB_DDC 상한 = FACILITY_ICON)로 cluster 고도에서 자동 숨겨지므로
 * 표현이 겹치지 않는다. update()는 기존 camera-changed(디바운스) 흐름에서 호출한다.
 */
export class CesiumFacilityCluster {
    private readonly billboards: Cesium.BillboardCollection;
    private readonly labels: Cesium.LabelCollection;
    private points: ClusterPoint[] = [];
    private visible = true;
    private destroyed = false;
    /** 군집 원 아이콘 캐시 (radius-bucket → dataURL). 개수 텍스트는 별도 Label로 정확히 표시 */
    private iconCache = new Map<number, string>();

    constructor(private viewer: Viewer, private opts: ClusterOptions) {
        this.billboards = new Cesium.BillboardCollection();
        this.labels = new Cesium.LabelCollection();
        this.viewer.scene.primitives.add(this.billboards);
        this.viewer.scene.primitives.add(this.labels);
    }

    /** 클러스터 대상 점 목록 갱신 (레이어 load 후 호출) */
    setPoints(points: ClusterPoint[]): void {
        this.points = points;
        this.update();
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        const on = visible && FACILITY_CLUSTERING.ENABLED;
        this.billboards.show = on;
        this.labels.show = on;
        if (!visible) { this.billboards.removeAll(); this.labels.removeAll(); }
        else this.update();
    }

    /** 카메라 고도 기준 tier 판정 후 군집 빌보드 재계산 */
    update(): void {
        if (this.destroyed) return;
        this.billboards.removeAll();
        this.labels.removeAll();
        if (!this.visible || !FACILITY_CLUSTERING.ENABLED || this.points.length === 0) return;

        const altitude = this.viewer.scene.camera.positionCartographic?.height;
        if (altitude == null) return;

        // cluster tier(원거리)에서만 군집 표시. 그 외엔 개별 빌보드가 담당.
        if (getFacilityLodTierByAltitude(altitude) !== 'cluster') return;

        // 화면-안정적 격자: 셀 크기 ∝ 카메라 고도 (최소 300m)
        const cellM = Math.max(300, altitude * 0.06);

        // lng/lat 도(度) 단위 셀 크기 (위도별 경도 보정)
        const meanLatRad = (this.points[0]!.lat * Math.PI) / 180;
        const latCell = cellM / 111320;
        const lngCell = cellM / (111320 * Math.max(0.1, Math.cos(meanLatRad)));

        // 격자 집계: 셀별 합/개수
        const cells = new Map<string, { sumLng: number; sumLat: number; count: number }>();
        for (const p of this.points) {
            const gx = Math.floor(p.lng / lngCell);
            const gy = Math.floor(p.lat / latCell);
            const key = `${gx}:${gy}`;
            const c = cells.get(key);
            if (c) { c.sumLng += p.lng; c.sumLat += p.lat; c.count++; }
            else cells.set(key, { sumLng: p.lng, sumLat: p.lat, count: 1 });
        }

        // 셀별 군집 빌보드(원) + 개수 라벨 추가 (centroid 위치)
        for (const c of cells.values()) {
            const cLng = c.sumLng / c.count;
            const cLat = c.sumLat / c.count;
            const pos = Cesium.Cartesian3.fromDegrees(cLng, cLat, 100);
            const radius = this.radiusForCount(c.count);
            this.billboards.add({
                position: pos,
                image: this.getCircleIcon(radius),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
            });
            this.labels.add({
                position: pos,
                text: this.labelOf(c.count),
                font: "bold 12px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.4)"),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
        }

        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    /** 개수 → 원 반경(px) */
    private radiusForCount(count: number): number {
        return Math.round(Math.min(26, 11 + Math.log2(Math.max(2, count)) * 3));
    }

    /** 반경별 원 아이콘 (캔버스, 캐시). 텍스트는 별도 Label로 정확히 표시 */
    private getCircleIcon(radius: number): string {
        const cached = this.iconCache.get(radius);
        if (cached) return cached;

        const size = radius * 2 + 4;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d")!;
        const cx = size / 2, cy = size / 2;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = this.opts.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.stroke();

        const url = c.toDataURL();
        this.iconCache.set(radius, url);
        return url;
    }

    private labelOf(count: number): string {
        if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
        return `${count}`;
    }

    destroy(): void {
        this.destroyed = true;
        try { this.viewer.scene.primitives.remove(this.billboards); } catch (_) {}
        try { this.viewer.scene.primitives.remove(this.labels); } catch (_) {}
        this.iconCache.clear();
    }
}
