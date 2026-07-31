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
import { getActiveVersionId } from "@utils/versionId";
import { RAIL_STATION_TILING } from "@utils/lodConstants";
import { RailStationTileManager } from "@managers/RailStationTileManager";
import { RailStationTileMembership } from "@managers/railStationTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";

export default class RailStationFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "railStation";
    private unsubscribe: (() => void) | undefined;
    private needsReload = false;
    private clusterOverlay: FacilityClusterOverlay;

    // ── 철도정류장 타일링 (RAIL_STATION_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: RailStationTileManager | null = null;
    private membership = new RailStationTileMembership();
    private moveEndKey: EventsKey | null = null;

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
            // 저장 완료(isChanged: true → false) — BusStationFeatureLayer/SignalFeatureLayer와 동일 조치.
            (store as any).subscribe(
                (s: any) => s.isChanged,
                (isChanged: boolean, prevIsChanged: boolean) => {
                    if (!prevIsChanged || isChanged) return;
                    const cur = store.getState().currentJsonData;
                    if (cur) store.getState().setOriginData(cur);
                    if (RAIL_STATION_TILING.ENABLED) {
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
            if (RAIL_STATION_TILING.ENABLED) {
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
            this.tileManager = new RailStationTileManager(String(versionId), {
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
            if (!response) { this.source.clear(); return; }

            // 타일 모드: viewport 정류장(서버 최신) + 로컬 미저장 편집을 id 단위로 병합
            //   (BusStationFeatureLayer와 동일 조치 — diffRecordEditsById 참고).
            // 비-타일 모드: store 전체 정류장 그대로 사용.
            let railStationsAll: any[];
            if (RAIL_STATION_TILING.ENABLED) {
                const originData = store?.getState().originData as any;
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
            if (!railStationsAll.length) { this.source.clear(); return; }

            const networkData: any = networkStore?.getState().currentJsonData;
            if (!networkData?.links) { this.source.clear(); return; }

            const linkMap = buildLinkMapOl(networkData);

            const stationTemplate = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'railStations');
            const exitTemplate    = useSchemaStore.getState().generateTemplateWithLayerNameAndFeatureType('railStation', 'exits');

            const featureBuffer: Feature[] = [];

            for (const station of railStationsAll) {
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
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        this.tileManager?.clear();
        this.tileManager = null;
        this.clusterOverlay.dispose();
        super.dispose();
    }
}
