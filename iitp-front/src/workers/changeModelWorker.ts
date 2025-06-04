// 내부 캐시
let vehicleMap = new Map(); // vehicle.id -> { ...vehicle, cellKey }
let gridMap = new Map(); // cellKey -> Set of vehicle.id

const CELL_SIZE = 1000;
const CAMERA_DISTANCE = 1000;
const GRID_RADIUS = 1;
const COS_THRESHOLD = 0.3;

self.onmessage = function (e) {
    const { type, newVehicleData, cameraPositionWC, cameraDirectionWC } = e.data;

    if (type === 'init') {
        vehicleMap = new Map();
        gridMap = new Map();
        updateVehicleGridMap(newVehicleData);
    }else if(type === 'tick'){
        updateVehicleGridMap(newVehicleData);

        // 2. 카메라 주변 셀 탐색
        const nearbyKeys = getNeighborKeys(cameraPositionWC);

        // 3. 거리/시야각 필터링
        const result = [];

        for (const key of nearbyKeys) {
            const vehicleIds = gridMap.get(key);
            if (!vehicleIds) continue;

            for (const id of vehicleIds) {
                const vehicle = vehicleMap.get(id);
                if (!vehicle) continue;

                // 시야 밖이면 스킵
                //if (!isInCameraFOV(cameraDirectionWC, cameraPositionWC, vehicle.position)) continue;

                const distance = calculateDistance(cameraPositionWC, vehicle.position);
                const display = distance < CAMERA_DISTANCE;

                if (display !== vehicle.display) {
                    vehicle.display = display;
                    vehicle.changed = true;
                    result.push({
                        id: vehicle.id,
                        position: vehicle.position,
                        display,
                        changed: true,
                    });
                } else {
                    vehicle.changed = false;
                    result.push(vehicle);
                }
            }
        }

        self.postMessage(result);
    }


};


// 유클리드 거리 계산 (x, y, z 값 기반)
function calculateDistance(cameraPosition, vehiclePosition) {
    const dx = vehiclePosition.x - cameraPosition.x;
    const dy = vehiclePosition.y - cameraPosition.y;
    const dz = vehiclePosition.z - cameraPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function updateVehicleGridMap(newVehicleData) {
    for (const data of newVehicleData) {

        const id = data.id;
        const newPos = data.position;
        const newCell = getCellKey(newPos);

        if (!vehicleMap.has(id)) {
            // 신규 차량 등록
            vehicleMap.set(id, {
                ...data,
                cellKey: newCell
            });
            if (!gridMap.has(newCell)) gridMap.set(newCell, new Set());
            gridMap.get(newCell).add(id);
            continue;
        }

        const cached = vehicleMap.get(id);
        const oldCell = cached.cellKey;

        // 셀 변경 여부 확인
        if (oldCell !== newCell) {
            // Remove from old cell
            const oldSet = gridMap.get(oldCell);
            if (oldSet) oldSet.delete(id);
            // Add to new cell
            if (!gridMap.has(newCell)) gridMap.set(newCell, new Set());
            gridMap.get(newCell).add(id);
        }

        // 업데이트
        vehicleMap.set(id, {
            ...data,
            cellKey: newCell,
            display: cached.display ?? false,
            changed: false
        });
    }
}

function getCellKey(pos) {
    const i = Math.floor(pos.x / CELL_SIZE);
    const j = Math.floor(pos.y / CELL_SIZE);
    const k = Math.floor(pos.z / CELL_SIZE);
    return `${i},${j},${k}`;
}

function getNeighborKeys(cameraPos) {
    const ci = Math.floor(cameraPos.x / CELL_SIZE);
    const cj = Math.floor(cameraPos.y / CELL_SIZE);
    const ck = Math.floor(cameraPos.z / CELL_SIZE);

    const keys = [];
    for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        for (let dy = -GRID_RADIUS; dy <= GRID_RADIUS; dy++) {
            for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
                keys.push(`${ci + dx},${cj + dy},${ck + dz}`);
            }
        }
    }
    return keys;
}

function isInCameraFOV(cameraDir, cameraPos, objectPos, cosThreshold = COS_THRESHOLD) {
    const dx = objectPos.x - cameraPos.x;
    const dy = objectPos.y - cameraPos.y;
    const dz = objectPos.z - cameraPos.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return false;

    const vx = dx / len;
    const vy = dy / len;
    const vz = dz / len;

    const dot = vx * cameraDir.x + vy * cameraDir.y + vz * cameraDir.z;
    return dot >= cosThreshold;
}

