
self.onmessage = function (e) {
    const data = e.data;

    const targetPositions = [];

    if (data.lastPositions && data.newVehicleRoute) {
        data.lastPositions.forEach((item, index) => {
            if (!item) return;

            const route = data.newVehicleRoute[index];
            if (!route || route.length < 2) return;

            const startPoint = route[0];
            const endPoint   = route[route.length - 1];
            if (!startPoint || !endPoint) return;

            const convertPos = ecefToLonLatHeight(item[0], item[1], item[2]);
            const currentPoint = { x: convertPos.lon, y: convertPos.lat, z: convertPos.height };

            // endPoint가 ECEF 배열이면 변환, 아니면 {x,y,z} 그대로 사용
            let endGeo;
            if (Array.isArray(endPoint)) {
                const ep = ecefToLonLatHeight(endPoint[0], endPoint[1], endPoint[2]);
                endGeo = { x: ep.lon, y: ep.lat, z: ep.height };
            } else {
                endGeo = endPoint;
            }

            targetPositions.push([currentPoint, endGeo]);
        });
    }

    if (targetPositions.length > 0) {
        const odData = computeODMatrix(targetPositions);
        self.postMessage({ odData });
    }
};

interface ODCellInfo {
}

function computeODMatrix(
    geoPointGroups: { x: number; y: number; z: number }[][],
    gridSize: number = 0.01
): ODCellInfo[] {
    const odMap = new Map<string, {
        fromKey: string;
        toKey: string;
        // Cartesian3 대신 위경도 좌표만 저장
        fromCoord: [number, number];
        toCoord: [number, number];
        count: number;
    }>();

    const getGridKeyAndCenter = (x: number, y: number): [string, [number, number]] => {
        const gridX = Math.floor(x / gridSize);
        const gridY = Math.floor(y / gridSize);
        const key = `${gridX}_${gridY}`;
        const centerLon = (gridX + 0.5) * gridSize;
        const centerLat = (gridY + 0.5) * gridSize;
        return [key, [centerLon, centerLat]];
    };

    for (const route of geoPointGroups) {
        if (route.length < 2) continue;

        const start = route[0];
        const end = route[route.length - 1];

        const [fromKey, fromCoord] = getGridKeyAndCenter(start.x, start.y);
        const [toKey, toCoord] = getGridKeyAndCenter(end.x, end.y);
        const pairKey = `${fromKey}→${toKey}`;

        if (!odMap.has(pairKey)) {
            odMap.set(pairKey, {
                fromKey,
                toKey,
                fromCoord,
                toCoord,
                count: 0,
            });
        }

        odMap.get(pairKey)!.count += 1;
    }

    const odArray = Array.from(odMap.values());
    const maxCount = Math.max(...odArray.map((item) => item.count), 1); // 0 방지

    const result = odArray.map(item => ({
        ...item,
        density: item.count / maxCount,
    }));
    // 누적 상한: 통행량(count) 많은 상위 OD_MAX개만 표시 → 시뮬 진행해도 렌더 비용 일정.
    // (OD 쌍이 수백 개로 늘면 매 프레임 렌더가 선형으로 무거워져 끊김 — 측정으로 확인)
    result.sort((a, b) => b.count - a.count);
    return result.slice(0, OD_MAX);
}

const OD_MAX = 100; // 표시 OD 쌍 상한 (통행량 상위)
function ecefToLonLatHeight(x: number, y: number, z: number): { lon: number; lat: number; height: number } {
    const a = 6378137.0; // WGS84 semi-major axis (in meters)
    const e2 = 6.69437999014e-3; // first eccentricity squared

    const p = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(z * a, p * Math.sqrt(1 - e2) * a);

    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const lat = Math.atan2(z + e2 * a / (1 - e2) * sinTheta * sinTheta * sinTheta,
        p - e2 * a * cosTheta * cosTheta * cosTheta);
    const lon = Math.atan2(y, x);

    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    const height = p / Math.cos(lat) - N;

    return {
        lon: (lon * 180) / Math.PI,
        lat: (lat * 180) / Math.PI,
        height
    };
}
