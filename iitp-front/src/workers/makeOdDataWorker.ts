
self.onmessage = function (e) {
    const data = e.data;

    const targetPositions = [];

    if (data.positions && data.positions.filter(item => item !== undefined).length > 0) {
        data.positions.forEach((item, index) => {
            targetPositions.push(data.newVehicleRoute[index]);
        });
    }
    // console.log(data.positions)
    const odData = computeODMatrix(parseRawODInputFromFlatArray(targetPositions));
    //console.log(odData);
    self.postMessage({ odData: odData });
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

    return odArray.map(item => ({
        ...item,
        density: item.count / maxCount,
    }));
}

function parseRawODInputFromFlatArray(
    raw: number[][]
): { x: number; y: number; z: number }[][] {
    const parsed: { x: number; y: number; z: number }[][] = [];

    for (const row of raw) {
        const route: { x: number; y: number; z: number }[] = [];

        for (let i = 0; i + 3 < row.length; i += 4) {
            const x = row[i + 1];
            const y = row[i + 2];
            const z = row[i + 3];

            if (
                typeof x === 'number' &&
                typeof y === 'number' &&
                typeof z === 'number' &&
                Number.isFinite(x) &&
                Number.isFinite(y) &&
                Number.isFinite(z)
            ) {
                const { lon, lat, height } = ecefToLonLatHeight(x, y, z);
                route.push({ x:lon, y:lat, z:height });
            }
        }

        parsed.push(route);
    }

    return parsed;
}



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
