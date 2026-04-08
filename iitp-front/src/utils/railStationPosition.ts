/**
 * railStation exit 기반 station centroid 계산 공유 유틸
 *
 * - exit 위치 = linkRef 위 offset 좌표에서 인도 방향으로 수직 오프셋
 * - 인도 오프셋 = link의 lane 수 × LANE_WIDTH + SIDEWALK_MARGIN
 * - station centroid = 해당 역 모든 exit 위치의 평균
 */
import { computePositionAtOffsetOl } from "@utils/offset";
import { fromLonLat, toLonLat } from "ol/proj";

const LANE_WIDTH      = 3.5;  // 차선 폭 (m)
const SIDEWALK_MARGIN = 2.0;  // 인도 여유 폭 (m)

interface LinkEntry {
    start: [number, number];
    end:   [number, number];
    laneCount: number;
}

/** networkData.links → linkId 맵 */
export function buildLinkMapOl(networkData: any): Map<string, LinkEntry> {
    const map = new Map<string, LinkEntry>();
    if (!networkData?.links) return map;

    for (const link of networkData.links) {
        if (!link.coordinates || link.coordinates.length < 2) continue;
        const first = link.coordinates[0];
        const last  = link.coordinates[link.coordinates.length - 1];
        const laneCount = Array.isArray(link.lanes) ? link.lanes.length : 1;
        map.set(String(link.id), {
            start: fromLonLat([first.lng, first.lat]) as [number, number],
            end:   fromLonLat([last.lng,  last.lat])  as [number, number],
            laneCount,
        });
    }
    return map;
}

/** exit 1개의 인도 위치 계산 (EPSG:3857) */
export function computeExitPositionOl(
    link: LinkEntry,
    offsetMeters: number
): [number, number] {
    const { offsetPosition: onLinkPos } = computePositionAtOffsetOl(link.start, link.end, offsetMeters);

    const dx = link.end[0] - link.start[0];
    const dy = link.end[1] - link.start[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const perpX = len > 0 ? -dy / len : 0;
    const perpY = len > 0 ?  dx / len : 0;

    const sidewalkOffset = link.laneCount * LANE_WIDTH + SIDEWALK_MARGIN;
    return [
        (onLinkPos[0] as number) + perpX * sidewalkOffset,
        (onLinkPos[1] as number) + perpY * sidewalkOffset,
    ];
}

/**
 * railStations 배열 → stationId 기준 centroid (WGS84) 맵
 * railRoute 등에서 역 위치를 exit centroid 기반으로 조회할 때 사용
 */
export function computeStationCentroidsOl(
    railStations: any[],
    networkData: any
): Map<string, { lng: number; lat: number }> {
    const linkMap = buildLinkMapOl(networkData);
    const result  = new Map<string, { lng: number; lat: number }>();

    for (const station of railStations) {
        const exits    = station.exits ?? [];
        const resolved: [number, number][] = [];

        for (const exit of exits) {
            const link = linkMap.get(String(exit.linkRef));
            if (!link || exit.offset == null) continue;
            resolved.push(computeExitPositionOl(link, exit.offset));
        }
        if (resolved.length === 0) continue;

        const cx = resolved.reduce((s, p) => s + p[0], 0) / resolved.length;
        const cy = resolved.reduce((s, p) => s + p[1], 0) / resolved.length;
        const wgs84 = toLonLat([cx, cy]);
        result.set(String(station.id), { lng: wgs84[0] as number, lat: wgs84[1] as number });
    }

    return result;
}
