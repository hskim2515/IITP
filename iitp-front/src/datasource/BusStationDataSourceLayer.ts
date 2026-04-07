import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import * as Cesium from "cesium";
import { Color, Entity, CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { BusPublicStationResponse } from "@type/Station";
import { diff } from "deep-object-diff";
import { computePositionAtOffsetCesium } from "@utils/offset";
import { PublicTransitResponse } from "@type/openapi.gen";

const PARKING_LOT_LENGTH_M = 14;
const POLE_HEIGHT = 3.5;       // 정류장 폴 높이 (m)
const POLE_RADIUS = 0.08;      // 폴 반지름 (m)
const PLATFORM_HEIGHT = 0.25;  // 승강장 높이 (m)
const PLATFORM_WIDTH = 3.0;    // 승강장 폭 (m)

export default class BusStationDataSourceLayer {
    private readonly LAYER_NAME = "busStation";
    public readonly dataSource: CustomDataSource;
    private unsubscribes: Array<() => void> = [];

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

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

    public load(): void {
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const store = layerNameToStoreMap[this.LAYER_NAME];
            const networkStore = layerNameToStoreMap["network"];
            if (!store || !networkStore) return;

            const busPublicStationResponse: PublicTransitResponse = store.getState().currentJsonData;
            if (!busPublicStationResponse?.busStations) return;

            const networkData: any = networkStore.getState().currentJsonData;
            if (!networkData?.links) return;

            /* ── 네트워크 스토어에서 lane 중심선(Cartesian3) 사전 계산 ── */
            const linkLaneMap = new Map<string, { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }[]>();

            for (const link of networkData.links) {
                if (!link.coordinates || link.coordinates.length < 2) continue;

                const p1 = Cesium.Cartesian3.fromDegrees(link.coordinates[0].lng, link.coordinates[0].lat);
                const lastCoord = link.coordinates[link.coordinates.length - 1];
                const p2 = Cesium.Cartesian3.fromDegrees(lastCoord.lng, lastCoord.lat);

                const direction = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);
                const up = Cesium.Cartesian3.UNIT_Z;
                const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(right, right);

                const laneCount = link.lanes?.length ?? 0;
                if (laneCount === 0) continue;
                const laneWidth = (link.width ?? 0) / laneCount;

                const lanes: { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }[] = [];
                for (let i = 0; i < laneCount; i++) {
                    const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;
                    const offsetVec = Cesium.Cartesian3.multiplyByScalar(right, offsetCenter, new Cesium.Cartesian3());
                    lanes.push({
                        source: Cesium.Cartesian3.add(p1, offsetVec, new Cesium.Cartesian3()),
                        target: Cesium.Cartesian3.add(p2, offsetVec, new Cesium.Cartesian3()),
                    });
                }
                linkLaneMap.set(String(link.id), lanes);
            }

            /* ── 정류장 엔티티 생성 ── */
            for (const busStation of busPublicStationResponse.busStations) {
                const linkRef = String(busStation.linkRef);
                const laneRef = Number(busStation.laneRef);

                const lanes = linkLaneMap.get(linkRef);
                if (!lanes || laneRef < 0 || laneRef >= lanes.length) {
                    console.warn(`[BusStationDataSourceLayer] ${busStation.id}: link ${linkRef} lane ${laneRef} 없음`);
                    continue;
                }

                const { source: laneSource, target: laneTarget } = lanes[laneRef];
                const offset = busStation.offset;
                if (!offset) continue;

                const { offsetPosition } = computePositionAtOffsetCesium(laneSource, laneTarget, offset);

                /* 진행 방향 단위벡터 */
                const dir = Cesium.Cartesian3.subtract(laneTarget, laneSource, new Cesium.Cartesian3());
                const segLen = Cesium.Cartesian3.magnitude(dir);
                if (segLen === 0) continue;
                Cesium.Cartesian3.normalize(dir, dir);

                /* 승강장 끝점 (역방향) */
                const parkingLots = busStation.parkingLots ?? 0;
                const platformLength = parkingLots * PARKING_LOT_LENGTH_M;

                const parkingEnd = Cesium.Cartesian3.add(
                    offsetPosition,
                    Cesium.Cartesian3.multiplyByScalar(dir, -platformLength, new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );

                /* 폴 위치: 정류장 시작점 위 (폴 중심 = 지면 + 절반 높이) */
                const carto = Cesium.Cartographic.fromCartesian(offsetPosition);
                const poleCenter = Cesium.Cartesian3.fromRadians(
                    carto.longitude, carto.latitude,
                    (carto.height || 0) + POLE_HEIGHT / 2
                );

                /* ① 폴 (cylinder) */
                this.dataSource.entities.add(new Entity({
                    position: poleCenter,
                    cylinder: {
                        length: POLE_HEIGHT,
                        topRadius: POLE_RADIUS,
                        bottomRadius: POLE_RADIUS,
                        material: Color.fromCssColorString("#9e9e9e"),
                        outline: false,
                    },
                    properties: { ...busStation },
                }));

                /* ② 상단 표지판 (납작한 box) */
                const signPos = Cesium.Cartesian3.fromRadians(
                    carto.longitude, carto.latitude,
                    (carto.height || 0) + POLE_HEIGHT + 0.2
                );
                this.dataSource.entities.add(new Entity({
                    position: signPos,
                    box: {
                        dimensions: new Cesium.Cartesian3(0.6, 0.1, 0.4),
                        material: Color.fromCssColorString("#1565c0"),
                    },
                }));

                /* ③ 승강장 플랫폼 (corridor extruded) */
                if (platformLength > 0) {
                    this.dataSource.entities.add(new Entity({
                        corridor: {
                            positions: [offsetPosition, parkingEnd],
                            width: PLATFORM_WIDTH,
                            height: 0.0,
                            extrudedHeight: PLATFORM_HEIGHT,
                            material: Color.fromCssColorString("#bdbdbd").withAlpha(0.9),
                            cornerType: Cesium.CornerType.MITERED,
                        },
                    }));
                }
            }

            console.log(`BusStationDataSourceLayer: 로드 완료 (${this.dataSource.entities.values.length} entities)`);
        } catch (error) {
            console.error("BusStationDataSourceLayer.load() 에러:", error);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    public destroy(): void {
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
