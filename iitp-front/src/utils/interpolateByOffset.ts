import {useNetworkStore} from "@stores/useNetworkStore";
import {Feature} from "ol";
import {fromLonLat} from "ol/proj";
import {Point} from "ol/geom";
import {getDistance} from "ol/sphere";

/**
 * 주어진 Feature들의 linkRef, laneRef, offset 정보를 바탕으로 지오메트리를 보간합니다.
 * OpenLayers 맵 객체 대신 NetworkStore 데이터를 직접 참조하여 정확도와 싱크를 높입니다.
 */
export function interpolateByOffset(features: any[]): any[] {
    const networkData = useNetworkStore.getState().currentJsonData;
    if (!networkData?.links) {
        console.warn('[interpolateByOffset] Network data not ready');
        return features;
    }

    // Lane 데이터 인덱싱
    const laneMap = new Map<string, any>();
    networkData.links.forEach((link: any) => {
        link.lanes?.forEach((lane: any) => {
            laneMap.set(`${link.id}_${lane.id}`, lane);
        });
    });

    features.forEach(f => {
        const linkRef = f.get('linkRef');
        const laneRef = f.get('laneRef');
        const cellId = f.get('cellId');
        const offset = Number(f.get('offset') || 0);

        const lane = laneMap.get(`${linkRef}_${laneRef}`);
        if (lane && Array.isArray(lane.coordinates) && lane.coordinates.length >= 2) {
            // 보간에 사용할 WGS84 좌표 리스트
            const wgs84Coords = lane.coordinates.map((c: any) => [c.lng, c.lat]);
            
            // Cell 기반 누적 offset 계산
            let totalOffset = 0;
            if (cellId != null && Array.isArray(lane.cells)) {
                const cellIdx = Number(cellId);
                for (let i = 0; i < Math.min(cellIdx, lane.cells.length); i++) {
                    totalOffset += Number(lane.cells[i]?.length || 0);
                }
            }
            totalOffset += offset;

            // 지구 곡률을 고려한 정교한 보간
            const result = interpolateAlongWgs84Line(wgs84Coords, totalOffset);
            if (result) {
                const { lngLat, angle } = result;
                // OL은 EPSG:3857 사용
                f.setGeometry(new Point(fromLonLat(lngLat)));
                // 각도는 라디안 단위 (East-North Up 체계와 호환되도록 atan2(dx, dy) 사용)
                f.set("angle", angle);
                return;
            }
        }

        // Fallback: coordinates 속성 직접 사용
        const coords = f.get('coordinates');
        const first = Array.isArray(coords) ? coords[0] : null;
        if (first?.lng != null && first?.lat != null) {
            f.setGeometry(new Point(fromLonLat([first.lng, first.lat])));
        }
    });

    return features;
}

/**
 * WGS84 좌표 배열과 미터 단위의 offset을 받아 보간된 좌표와 각도를 반환합니다.
 */
function interpolateAlongWgs84Line(coords: [number, number][], offsetMeters: number): { lngLat: [number, number]; angle: number } | null {
    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const p1 = coords[i - 1];
        const p2 = coords[i];
        
        // 지구상 실제 거리 계산 (미터)
        const segLen = getDistance(p1, p2);

        if (accumulated + segLen >= offsetMeters) {
            const remain = offsetMeters - accumulated;
            const ratio = segLen > 0 ? remain / segLen : 0;
            
            // 좌표 선형 보간 (짧은 거리이므로 단순 보간으로 충분)
            const lng = p1[0] + ratio * (p2[0] - p1[0]);
            const lat = p1[1] + ratio * (p2[1] - p1[1]);
            
            // 각도 계산 (Web Mercator 투영 후의 각도로 계산하여 시각적 정렬 유지)
            // atan2(dx, dy)는 북쪽(Y) 기준 시계방향 각도를 반환 (bearing)
            const p1_3857 = fromLonLat(p1);
            const p2_3857 = fromLonLat(p2);
            const dx = p2_3857[0] - p1_3857[0];
            const dy = p2_3857[1] - p1_3857[1];
            const angle = Math.atan2(dx, dy);

            return { lngLat: [lng, lat], angle };
        }
        accumulated += segLen;
    }
    
    // offset이 전체 길이를 초과하면 마지막 점 반환
    const last = coords[coords.length - 1];
    const prev = coords[coords.length - 2];
    const p1_3857 = fromLonLat(prev);
    const p2_3857 = fromLonLat(last);
    const angle = Math.atan2(p2_3857[0] - p1_3857[0], p2_3857[1] - p1_3857[1]);
    
    return { lngLat: [last[0], last[1]], angle };
}

export function interpolateFeatureByOffset(feature: Feature): Feature {
    const [result] = interpolateByOffset([feature]);
    return result;
}

export function interpolateAndConvertToRecords(dataList: any[]): any[] {
    const {convertFeatureToRecord, createFeature} = require("@utils/feature");
    const features = dataList
        .map(data => createFeature(data))
        .filter((f): f is Feature => f !== undefined);
    const interpolated = interpolateByOffset(features);
    return interpolated.map(convertFeatureToRecord);
}
