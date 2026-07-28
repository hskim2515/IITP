import {Point} from "ol/geom";
import {toLonLat, fromLonLat} from "ol/proj";
import {getDistance} from "ol/sphere";
import {Coordinate} from "ol/coordinate";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {convertFeatureToRecord, createFeature} from "@utils/feature";
import {Feature} from "ol";
import {layerNameToStoreMap} from "@hooks/useLayerInit";

/**
 * link JSON 데이터에서 laneIdx 차선의 중심선을 OL 투영좌표(EPSG:3857)로 직접 계산한다.
 * NETWORK_TILING.USE_MVT_2D=true(상시 켜짐)에서는 NetworkFeatureLayer.fullBuild가 성능상
 * "lane-edit" OL 피처 자체를 아예 안 만든다(도로/차선은 MVT가 그림, 노드/커넥션/포트만 벡터
 * 피처로 빌드) — 그 결과 아래 interpolateByOffset의 OL 피처 스캔이 항상 실패해서
 * (laneMap이 절대 안 채워짐) 노면표시가 자동생성/수동배치 여부와 무관하게 전부 좌표 [0,0]에
 * 머물러 안 보이는 버그가 있었다. OL 피처가 없을 때는 이 함수로 link.coordinates에서 직접
 * 차선 중심선을 계산해 폴백한다(NetworkDataSourceLayer.computeOffsetPositions의 3D 버전과
 * 동일한 정점별 법선 오프셋 방식 — link-edit처럼 첫 세그먼트 방향만 쓰는 근사보다 정확).
 */
function computeLaneCenterlineOl(link: any, laneIdx: number): Coordinate[] | null {
    const coords = (link?.coordinates ?? []).filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat));
    if (coords.length < 2) return null;
    const laneCount = link.lanes?.length ?? 1;
    if (laneCount === 0) return null;
    const laneWidth = (link.width ?? 7) / laneCount;
    // 차선0=최좌측(중앙선 쪽) — NetworkFeatureLayer/NetworkDataSourceLayer와 동일 규약
    const lateralOffset = (laneIdx - (laneCount - 1) / 2) * laneWidth;

    const pts = coords.map((c: any) => fromLonLat([c.lng, c.lat]));
    if (lateralOffset === 0) return pts;

    return pts.map((p: Coordinate, i: number) => {
        const prev = pts[Math.max(0, i - 1)]!;
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const dx = next[0]! - prev[0]!, dy = next[1]! - prev[1]!;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return p;
        // 우측(+) 법선 — 렌더 규약과 통일(-dy,dx)/len
        const nx = -dy / len, ny = dx / len;
        return [p[0]! + nx * lateralOffset, p[1]! + ny * lateralOffset];
    });
}

/** linkRef/laneRef로 lane.cells + 차선 중심선을 조회 — OL "lane-edit" 피처가 없을 때 폴백용.
 *  네트워크 store(JSON, 타일 모드면 뷰포트분)에서 직접 찾는다. */
function findLaneFromNetworkData(linkRef: unknown, laneRef: number): { cells: any[]; coordinates: Coordinate[] } | null {
    const networkStore = layerNameToStoreMap["network"] as any;
    const network = networkStore?.getState()?.currentJsonData;
    const link = network?.links?.find((l: any) => l && String(l.id) === String(linkRef));
    if (!link) return null;
    const lane = link.lanes?.[laneRef];
    if (!lane) return null;
    const coordinates = computeLaneCenterlineOl(link, laneRef);
    if (!coordinates) return null;
    return { cells: lane.cells ?? [], coordinates };
}

export function interpolateByOffset(features: any[]): any[] {
    const olMap = useOpenLayersStore.getState().map;
    if (!olMap) {
        console.warn('[interpolateByOffset] OL map not ready, skipping interpolation');
        return features;
    }
    const layers = olMap.getLayers().getArray();
    const networkLayer = layers.find((layer: any) => layer.LAYER_NAME === "network");

    if (!networkLayer) {
        console.warn('[interpolateByOffset] network layer not found, skipping interpolation');
        return features;
    }

    const networkFeatures = (networkLayer as any).getSource().getFeatures();
    const laneMap = new Map<string, any>();
    networkFeatures.forEach(f => {
        const props = f.getProperties();
        if (props?.featureType === "lane-edit") {
            laneMap.set(`${props.linkRef}_${props.laneRef}`, f);
        }
    });

    features.forEach(f => {
        const linkRef = f.get('linkRef');
        const laneRef = Number(f.get('laneRef'));
        const cellId = Number(f.get('cellId'));
        const offset = Number(f.get('offset'));

        const matched = laneMap.get(`${linkRef}_${laneRef}`);
        // USE_MVT_2D 모드에서는 "lane-edit" OL 피처가 애초에 안 만들어져 matched가 항상
        // undefined다 — 네트워크 JSON 데이터에서 직접 차선 중심선을 계산해 폴백한다.
        const fallback = matched ? null : findLaneFromNetworkData(linkRef, laneRef);
        const cells = matched ? matched.get('cells') : fallback?.cells;
        const coordinates = matched ? matched.getGeometry().getCoordinates() : fallback?.coordinates;
        if (!cells || !coordinates || cellId >= cells.length) return;

        let totalOffset = 0;
        for (let i = 0; i < cellId; i++) {
            totalOffset += Number(cells[i]?.length || 0);
        }
        totalOffset += offset;

        const result = interpolateAlongLine(coordinates, totalOffset);
        if (result) {
            const { point, angle } = result;
            f.setGeometry(new Point(point));
            f.set("angle", angle);
        }
    });

    return features;
}

// 단일용 래퍼 함수
export function interpolateFeatureByOffset(feature: Feature): Feature {
    const [result] = interpolateByOffset([feature]);
    return result;
}

function interpolateAlongLine(coords: number[][], offset: number): { point: [number, number]; angle: number } | null {
    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const [x1, y1] = coords[i - 1];
        const [x2, y2] = coords[i];
        // 지오메트리는 EPSG:3857인데 offset(셀 length 합)은 실제 미터 —
        // 메르카토르 평면거리(hypot)는 위도 37°에서 실제의 ~1.25배라 실제 거리로 누적해야 함
        const segLen = getDistance(toLonLat([x1, y1]), toLonLat([x2, y2]));
        if (segLen === 0) continue;

        if (accumulated + segLen >= offset) {
            const ratio = (offset - accumulated) / segLen;
            const x = x1 + ratio * (x2 - x1);
            const y = y1 + ratio * (y2 - y1);
            const angle = Math.atan2(x2 - x1, y2 - y1);
            return { point: [x, y], angle };
        }
        accumulated += segLen;
    }
    // offset이 셀 길이 합 오차 등으로 지오메트리 전체 길이를 살짝 넘으면 끝점으로 클램프
    if (coords.length >= 2) {
        const [x1, y1] = coords[coords.length - 2];
        const [x2, y2] = coords[coords.length - 1];
        return { point: [x2, y2], angle: Math.atan2(x2 - x1, y2 - y1) };
    }
    return null;
}

export function interpolateAndConvertToRecords(dataList: any[]): any[] {
    const features = dataList
        .map(data => createFeature(data))
        .filter((f): f is Feature => f !== undefined);
    const interpolated = interpolateByOffset(features);
    return interpolated.map(convertFeatureToRecord);
}
