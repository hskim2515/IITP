import * as Cesium from "cesium";

type GridCellKey = string; // 예: "3_5"

interface ODCellInfo {
    fromKey: GridCellKey;
    toKey: GridCellKey;
    fromCenter: Cesium.Cartesian3;
    toCenter: Cesium.Cartesian3;
    fromCoord: [number, number];
    toCoord: [number, number];
    density: number;
}

export function transformToTimeBasedPositions (vehiclePositions: any[]): Array<any> {
    if (vehiclePositions.length === 0) return [];

    const timeSteps = Math.max(...vehiclePositions.map(arr => arr.length));
    const timeBasedPositions = Array.from({ length: timeSteps }, () => []);

    vehiclePositions.forEach((vehicleData) => {
        if (!vehicleData) return; // vehicleData가 없으면 해당 반복을 건너뜀

        for(let i = 0; i < timeSteps; i++){
            const entry = vehicleData[i];
            if (entry) {
                timeBasedPositions[i].push(new Cesium.Cartesian3.fromDegrees(entry.x, entry.y, entry.z));
            } else {
                timeBasedPositions[i].push(null);
            }
        }
    });
    return timeBasedPositions;
}

export function computeODMatrix(
    geoPointGroups: { x: number; y: number; z: number }[][],
    gridSize: number = 0.01
): ODCellInfo[] {
    const odMap = new Map<string, {
        fromKey: string;
        toKey: string;
        fromCenter: Cesium.Cartesian3;
        toCenter: Cesium.Cartesian3;
        fromCoord: [number, number];
        toCoord: [number, number];
        count: number;
    }>();

    const getGridKeyAndCenter = (x: number, y: number): [string, Cesium.Cartesian3, [number, number]] => {
        const gridX = Math.floor(x / gridSize);
        const gridY = Math.floor(y / gridSize);
        const key = `${gridX}_${gridY}`;
        const centerLon = (gridX + 0.5) * gridSize;
        const centerLat = (gridY + 0.5) * gridSize;

        const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0);
        return [key, centerCartesian, [centerLon, centerLat]];
    };

    for (const route of geoPointGroups) {
        if (route.length < 2) continue;

        const start = route[0];
        const end = route[route.length - 1];

        const [fromKey, fromCenter, fromCoord] = getGridKeyAndCenter(start.x, start.y);
        const [toKey, toCenter, toCoord] = getGridKeyAndCenter(end.x, end.y);
        const pairKey = `${fromKey}→${toKey}`;

        if (!odMap.has(pairKey)) {
            odMap.set(pairKey, {
                fromKey,
                toKey,
                fromCenter,
                toCenter,
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
};

export function generateCzmlFromCoordinates (coordinatesArray: any[])  {
    const czml = [
        {
            "id": "document",
            "name": "Vehicle Movement",
            "version": "1.0"
        },
    ];
    coordinatesArray.forEach( (ca,idx) => {
        const currentTime = new Date().toISOString();

        // Start the CZML structure
        const czmlObj = {
            "id": "vehicle"+idx,
            "availability": `${currentTime}/${new Date(Date.now() + ca.length * 1000).toISOString()}`, // Set availability from current time to an end time based on coordinates
            "position": {
                "interpolationDegree": 2,
                "epoch": currentTime,
                "cartesian": [],
                "interpolationAlgorithm":"LINEAR"
            },
            "orientation": {
                "velocityReference": "#position"
            },
            "point": {
                "outlineWidth": 1,
                "pixelSize": 10
            }
        };

        const flatArray = ca.flatMap(({ x, y, z }) => [x, y, z]);

        Cesium.Cartesian3.fromDegreesArrayHeights(flatArray).forEach((coordinates, index) => {
            const time = index;
            czmlObj.position.cartesian.push(time, coordinates.x, coordinates.y, coordinates.z);
        });
        czml.push(czmlObj)
    })
    return czml;
}