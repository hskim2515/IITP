import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Cluster from "ol/source/Cluster";
import { Feature } from "ol";
import { Geometry, Point } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { FeatureLike } from "ol/Feature";
import type OLMap from "ol/Map";
import { getFacilityLodTierByResolution, FACILITY_CLUSTERING } from "@utils/lodConstants";

export interface FacilityClusterOptions {
    /** 클러스터 버블 색상 (CSS) */
    color: string;
    /** 오버레이 레이어 zIndex (base 레이어보다 약간 낮게 두어 근거리에서 가려지게) */
    zIndex: number;
    /** 클러스터 대상 피처 필터 (예: 역 마커만, 출구 제외). 미지정 시 Point 전부 */
    featureFilter?: (f: Feature<Geometry>) => boolean;
}

/**
 * 시설물 점 데이터의 overview(원거리) 클러스터 오버레이.
 *
 * base 레이어(개별 마커 + 상호작용)는 그대로 두고, 이 오버레이는 **시각 전용**으로
 * cluster tier에서만 군집 버블을 렌더한다. base 레이어가 cluster tier에서 `[]`를
 * 반환하므로 표현이 겹치지 않으며, 오버레이 피처는 `__guid`가 없고 비-cluster tier에서
 * 스타일이 `[]`라 선택/hit-test와 충돌하지 않는다.
 */
export class FacilityClusterOverlay {
    private readonly clusterSource: Cluster;
    private readonly layer: VectorLayer;
    private map: OLMap | null = null;

    constructor(baseSource: VectorSource, opts: FacilityClusterOptions) {
        const filter = opts.featureFilter;
        this.clusterSource = new Cluster({
            source: baseSource,
            distance: FACILITY_CLUSTERING.OL_CLUSTER_DISTANCE_PX,
            minDistance: FACILITY_CLUSTERING.OL_CLUSTER_MIN_DISTANCE_PX,
            // geometryFunction: 클러스터 대상이 아닌 피처는 null 반환 → 군집에서 제외
            geometryFunction: (feature: Feature<Geometry>): Point | null => {
                const geom = feature.getGeometry();
                if (!(geom instanceof Point)) return null;
                if (filter && !filter(feature)) return null;
                return geom;
            },
        });

        this.layer = new VectorLayer({
            source: this.clusterSource,
            visible: false,
            zIndex: opts.zIndex,
            // 상호작용 비활성: 클러스터는 시각 표시 전용
            style: (feature, resolution) => this.clusterStyle(feature, resolution, opts.color),
        });
        // 선택/hover 핸들러가 무시하도록 표식 (matchesCustomKeyValue 'layer' 미설정)
        (this.layer as any).set?.("__facilityClusterOverlay", true);
    }

    private clusterStyle(feature: FeatureLike, resolution: number, color: string): Style[] {
        // cluster tier(원거리)에서만 렌더. 그 외에는 base 레이어가 개별 마커를 담당.
        if (!FACILITY_CLUSTERING.ENABLED) return [];
        if (getFacilityLodTierByResolution(resolution) !== 'cluster') return [];

        const members = (feature.get("features") as Feature[]) ?? [];
        const count = members.length;
        if (count === 0) return [];

        if (count === 1) {
            // 단일: 작은 dot (군집 아닐 때 과한 버블 방지)
            return [new Style({
                image: new CircleStyle({
                    radius: 4,
                    fill: new Fill({ color }),
                    stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 1 }),
                }),
            })];
        }

        // 군집: 개수에 따라 커지는 버블 + 카운트 텍스트
        const radius = Math.min(22, 9 + Math.log2(count) * 3);
        return [new Style({
            image: new CircleStyle({
                radius,
                fill: new Fill({ color }),
                stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 2 }),
            }),
            text: new Text({
                text: String(count),
                font: "bold 11px sans-serif",
                fill: new Fill({ color: "#ffffff" }),
            }),
        })];
    }

    /** base 레이어가 map에 붙을 때 호출 — 오버레이를 같은 map에 추가 */
    attach(map: OLMap): void {
        if (this.map === map) return;
        this.detach();
        this.map = map;
        map.addLayer(this.layer);
    }

    detach(): void {
        if (this.map) {
            this.map.removeLayer(this.layer);
            this.map = null;
        }
    }

    /** base 레이어 가시성과 동기화 */
    setVisible(visible: boolean): void {
        this.layer.setVisible(visible && FACILITY_CLUSTERING.ENABLED);
    }

    dispose(): void {
        this.detach();
        this.clusterSource.clear();
        this.layer.dispose();
    }
}
