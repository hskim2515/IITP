// 내부 캐시
let vehicleMap = new Map(); // vehicle.id -> { ...vehicle, cellKey, display, lastSeenTick }
let gridMap = new Map(); // cellKey -> Set of vehicle.id

const CELL_SIZE = 1000;
const CAMERA_DISTANCE = 500;  // 성능 최적화용 거리 축소
const GRID_RADIUS = 2;
const COS_THRESHOLD = 0.2;
const CELL_MARGIN = CELL_SIZE * 0.3;
const REINIT_DISTANCE = 1200; // 카메라가 멀리 이동하면 전체 리셋
const HYSTERESIS_TICK = 3; // 최근 tick 동안 표시 유지

let lastCameraPos = null;
let tickCount = 0;
let idleTickCount = 0;
const IDLE_THRESHOLD = 30;      // 카메라가 30m 이하로만 움직이면 '멈춘' 상태로 간주
const STOP_TICK_LIMIT = 15;     // 15 tick(약 0.5~1초 정도) 이상 멈추면 리셋

self.onmessage = function (e) {
    const { type, newVehicleData, cameraPositionWC, cameraDirectionWC } = e.data;

    if (type === "init") {
        resetGrid(newVehicleData);
        lastCameraPos = { ...cameraPositionWC };
        return;
    }

    if (type === "tick") {
        // tickCount++;
        //
        // // 카메라 이동이 크면 전체 초기화
        // if (lastCameraPos) {
        //     const moveDist = calculateDistance(cameraPositionWC, lastCameraPos);
        //     if (moveDist > REINIT_DISTANCE) {
        //         resetGrid(newVehicleData);
        //         lastCameraPos = { ...cameraPositionWC };
        //     }
        // } else {
        //     lastCameraPos = { ...cameraPositionWC };
        // }

        tickCount++;

        let moveDist = 0;
        if (lastCameraPos) {
            moveDist = calculateDistance(cameraPositionWC, lastCameraPos);
            lastCameraPos = { ...cameraPositionWC };
        }

        // ✅ 카메라 정지 감지
        if (moveDist < IDLE_THRESHOLD) {
            idleTickCount++;
        } else {
            idleTickCount = 0; // 다시 움직이면 초기화
        }

        // ✅ 일정 시간 이상 멈춘 경우 초기화
        if (idleTickCount === STOP_TICK_LIMIT) {
            resetGrid(newVehicleData);
            // console.log("🔄 카메라 정지 상태 감지 → 전체 리셋");
        }

        updateVehicleGridMap(newVehicleData);
        const nearbyKeys = getNeighborKeys(cameraPositionWC);

        const result = [];
        const visibleSet = new Set();

        for (const key of nearbyKeys) {
            const ids = gridMap.get(key);
            if (!ids) continue;

            for (const id of ids) {
                const v = vehicleMap.get(id);
                if (!v) continue;

                const dist = calculateDistance(cameraPositionWC, v.position);
                const visible = dist < CAMERA_DISTANCE;

                if (visible) {
                    v.lastSeenTick = tickCount;
                    visibleSet.add(id);
                }

                const recentlyVisible = v.lastSeenTick && tickCount - v.lastSeenTick <= HYSTERESIS_TICK;
                const display = visible || recentlyVisible;

                if (display !== v.display) {
                    v.display = display;
                    v.changed = true;
                    result.push({
                        id: v.id,
                        position: v.position,
                        display,
                        changed: true,
                    });
                } else {
                    v.changed = false;
                }
            }
        }

        // 🔧 보강 탐색: 가까운데 그리드 누락된 차량들 복원
        for (const [id, v] of vehicleMap.entries()) {
            if (!visibleSet.has(id)) {
                const dist = calculateDistance(cameraPositionWC, v.position);
                if (dist < CAMERA_DISTANCE * 0.8) {
                    v.display = true;
                    v.changed = true;
                    v.lastSeenTick = tickCount;
                    result.push({
                        id: v.id,
                        position: v.position,
                        display: true,
                        changed: true,
                    });
                }
            }
        }

        self.postMessage(result);
    }
};

// 전체 리셋
function resetGrid(vehicleList) {
    vehicleMap.clear();
    gridMap.clear();
    for (const v of vehicleList) {
        const key = getCellKey(v.position);
        vehicleMap.set(v.id, { ...v, cellKey: key, display: true, lastSeenTick: 0, changed: true });
        if (!gridMap.has(key)) gridMap.set(key, new Set());
        gridMap.get(key).add(v.id);
    }
}

// 차량 갱신
function updateVehicleGridMap(newVehicleData) {
    for (const data of newVehicleData) {
        const id = data.id;
        const pos = data.position;
        const key = getCellKey(pos);

        const prev = vehicleMap.get(id);
        if (!prev) {
            vehicleMap.set(id, { ...data, cellKey: key, display: false, lastSeenTick: 0, changed: false });
            if (!gridMap.has(key)) gridMap.set(key, new Set());
            gridMap.get(key).add(id);
            continue;
        }

        if (prev.cellKey !== key) {
            gridMap.get(prev.cellKey)?.delete(id);
            if (!gridMap.has(key)) gridMap.set(key, new Set());
            gridMap.get(key).add(id);
        }

        prev.position = pos;
        prev.cellKey = key;
        prev.changed = false;
        vehicleMap.set(id, prev);
    }
}

// 셀 계산 (z 무시)
function getCellKey(pos) {
    const i = Math.floor((pos.x + CELL_MARGIN * Math.sign(pos.x)) / CELL_SIZE);
    const j = Math.floor((pos.y + CELL_MARGIN * Math.sign(pos.y)) / CELL_SIZE);
    return `${i},${j}`;
}

// 주변 셀 계산
function getNeighborKeys(cameraPos) {
    const ci = Math.floor(cameraPos.x / CELL_SIZE);
    const cj = Math.floor(cameraPos.y / CELL_SIZE);
    const keys = [];
    for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        for (let dy = -GRID_RADIUS; dy <= GRID_RADIUS; dy++) {
            keys.push(`${ci + dx},${cj + dy}`);
        }
    }
    return keys;
}

// 거리 계산
function calculateDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
