import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Fill, Stroke, Style } from "ol/style";
import { Point } from "ol/geom";
import CircleStyle from "ol/style/Circle";
import { FeatureLike } from "ol/Feature";
import { getFacilityLodTierByResolution, isAtLeastFacilityTier } from "@utils/lodConstants";
import { FacilityClusterOverlay } from "@features/facilityCluster";
import type OLMap from "ol/Map";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { fromLonLat } from "ol/proj";
import { RailPublicStationResponse } from "@type/Station";
import { useSchemaStore } from "@stores/useSchemaStore";
import { buildLinkMapOl, computeExitPositionOl } from "@utils/railStationPosition";
import { Coordinate } from "ol/coordinate";

export default class RailStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;
    private clusterOverlay: FacilityClusterOverlay;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 400,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
        this.source = source;
        // overview 클러스터 오버레이 (역 마커만 군집, 출구 제외)
        this.clusterOverlay = new FacilityClusterOverlay(source, {
            color: "rgb(0,102,255)",
            zIndex: 399,
            featureFilter: (f) => f.get("featureType") === "railStations",
        });
        this.load();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = (store as any).subscribe(
                (state: any) => state.currentJsonData,
                () => this.load(),
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

        const props = feature.getProperties() ?? {};
        const geom  = feature.getGeometry();
        const styles: Style[] = [];

        // 'labeled' 이상(=근거리)에서 굵은 외곽선 + 출구 마커 표시
        const isNear = isAtLeastFacilityTier(tier, 'labeled');

        if (geom instanceof Point && props.featureType === "railStations") {
            // 해상도에 비례한 역 마커 크기 (최소 4px ↔ 최대 9px)
            const radius = Math.min(9, Math.max(4, 6 / resolution));
            const strokeW = isNear ? 2 : 1;
            styles.push(new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: "rgb(0,102,255)" }),
                    stroke: new Stroke({ color: "#ffffff", width: strokeW }),
                }),
            }));
        }

        // 출구 마커: 근거리(labeled+)에서만 표시 — 멀리서는 역 마커만 보이면 충분
        if (isNear && geom instanceof Point && props.featureType === "exits") {
            const radius = Math.min(5, Math.max(2, 2.5 / resolution));
            styles.push(new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: "rgb(153,0,255)" }),
                    stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 }),
                }),
            }));
        }

        return styles;
    }

    public async load(): Promise<void> {
        if (!this.getVisible()) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;

        const store        = layerNameToStoreMap[this.LAYER_NAME];
        const networkStore = layerNameToStoreMap["network"];

        try {
            const response: RailPublicStationResponse | undefined = store?.getState().currentJsonData;
            if (!response?.railStations?.length) { this.source.clear(); return; }

            const networkData: any = networkStore?.getState().currentJsonData;
            if (!networkData?.links) { this.source.clear(); return; }

            const linkMap = buildLinkMapOl(networkData);

            const stationTemplate = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'railStations');
            const exitTemplate    = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'exits');

            const featureBuffer: Feature[] = [];

            for (const station of response.railStations) {
                const exits = station.exits ?? [];
                const exitPositions: Coordinate[] = [];

                for (const exit of exits) {
                    const link = linkMap.get(String(exit.linkRef));
                    if (!link || exit.offset == null) continue;

                    const pos = computeExitPositionOl(link, exit.offset);
                    exitPositions.push(pos);

                    const exitFeature = new Feature(new Point(pos));
                    exitFeature.setProperties({ ...exitTemplate, ...exit, featureType: "exits" });
                    featureBuffer.push(exitFeature);
                }

                // exit 없으면 coordinates 직접 사용
                if (exitPositions.length === 0) {
                    if (station.coordinates?.lng && station.coordinates?.lat) {
                        const pos = fromLonLat([station.coordinates.lng, station.coordinates.lat]);
                        const f = new Feature(new Point(pos));
                        f.setProperties({ ...stationTemplate, ...station, featureType: "railStations" });
                        featureBuffer.push(f);
                    }
                    continue;
                }

                const cx = exitPositions.reduce((s, p) => s + (p[0] as number), 0) / exitPositions.length;
                const cy = exitPositions.reduce((s, p) => s + (p[1] as number), 0) / exitPositions.length;

                const stationFeature = new Feature(new Point([cx, cy]));
                stationFeature.setProperties({ ...stationTemplate, ...station, featureType: "railStations" });
                featureBuffer.push(stationFeature);
            }

            this.source.clear();
            this.source.addFeatures(featureBuffer);
            console.log(`[RailStationFeatureLayer] 로드 완료: ${featureBuffer.length}개 피처`);
        } catch (e) {
            console.error("[RailStationFeatureLayer] load 에러:", e);
        }
    }

    public dispose(): void {
        this.unsubscribe?.();
        this.clusterOverlay.dispose();
        super.dispose();
    }
}
