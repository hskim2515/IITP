
let czmlData = null;
let sampledPositionsList = []; // 각 객체별 { vehicleType, sampled }
let referenceTime = null;
let elapsed = 0;
let lastElapsed = 0;
let workerGeneration = 0; // setSimulation 호출마다 갱신 — 스테일 메시지 식별용

self.onmessage = function (e) {
    const data = e.data;

    if (data.type === "init") {
        // generation이 전달된 경우 워커 세대 갱신 (빈 reset init 포함)
        if (data.generation != null) workerGeneration = data.generation;

        czmlData = data.czmlPackets; // [{id, type, path:[t,x,y,z,...]}, ...] 또는 구버전 [[t,x,y,z,...], ...]
        referenceTime = data.currentTime;
        lastElapsed = 0;
        elapsed = 0;

        sampledPositionsList = czmlData.map((track, idx) => {
            // 신버전: {id, type, path:[...]}  구버전: [t, x, y, z, ...]
            const isLegacy = Array.isArray(track);
            const path = isLegacy ? track : track.path;
            let vehicleType: string;
            if (isLegacy) {
                // 레거시 배열: 인덱스 기반 타입 배정 (useSimulation과 동일한 로직)
                const mod = idx % 100;
                if (mod < 70)       vehicleType = 'CAR';
                else if (mod < 85)  vehicleType = 'TAXI';
                else if (mod < 95)  vehicleType = 'BUS';
                else if (mod < 99)  vehicleType = 'TRUCK';
                else                vehicleType = 'MOTO';
            } else if (track.type) {
                vehicleType = track.type;
            } else {
                // type 없는 캐시 데이터 → 백엔드와 동일한 ID 기반 배정
                const numId = parseInt(String(track.id ?? '0').replace(/\D/g, '')) || 0;
                const mod = numId % 100;
                if (mod < 70)       vehicleType = 'CAR';
                else if (mod < 85)  vehicleType = 'TAXI';
                else if (mod < 95)  vehicleType = 'BUS';
                else if (mod < 99)  vehicleType = 'TRUCK';
                else                vehicleType = 'MOTO';
            }
            return { vehicleType, sampled: extractSampledPositionsFromFlatArray(path) };
        });

        if (!sampledPositionsList || sampledPositionsList.length === 0) return;

        const time = data.currentTime;
        elapsed = lastElapsed + (time - referenceTime) / 1000;

        self.postMessage(false);
    }

    else if (data.type === "tick") {
        if (!sampledPositionsList || sampledPositionsList.length === 0) return;

        const time = data.currentTime;
        elapsed = lastElapsed + (time - referenceTime) / 1000;

        // filter() 하지 않고 원본 인덱스 보존: 비활성 차량은 null로 유지
        // → TailPrimitive 등 인덱스 기반 레이어에서 trail[i] ↔ vehicle[i] 매핑 일치
        const interps = sampledPositionsList.map(({ vehicleType, sampled }) => ({
            interp: interpolatePosition(sampled, elapsed),
            vehicleType,
        }));
        const positions = interps.map(({ interp }) => interp ? interp.position : null);
        const headings  = interps.map(({ interp }) => interp ? interp.heading  : null);
        const speeds    = interps.map(({ interp }) => interp ? interp.speed    : null);
        const types     = interps.map(({ vehicleType }) => vehicleType);

        self.postMessage({ positions, headings, speeds, types, generation: workerGeneration });
    }

    else if (data.type === "pause") {
        lastElapsed = elapsed;
        referenceTime = data.currentTime;
    }
};

// 샘플 데이터 추출 (heading 사전 계산 포함)
// 정지 구간(이동 거리 < 0.5m)은 마지막 유효 heading을 그대로 유지 → 교차로 대기 시 방향 깜빡임 방지
function extractSampledPositionsFromFlatArray(flatArray) {
    const step = 4;
    const result = [];
    let lastValidHeading = 0;

    for (let i = 0; i < flatArray.length - step; i += step) {
        const startTime = flatArray[i];
        const startPos = [flatArray[i + 1], flatArray[i + 2], flatArray[i + 3]];

        const endTime = flatArray[i + step];
        const endPos = [flatArray[i + step + 1], flatArray[i + step + 2], flatArray[i + step + 3]];

        const dx = endPos[0] - startPos[0];
        const dy = endPos[1] - startPos[1];
        const dz = endPos[2] - startPos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const duration = endTime - startTime;

        // 이동 거리가 충분할 때만 heading 갱신 (0.5m 미만 = 정지/극미속)
        let heading = lastValidHeading;
        if (dist > 0.5) {
            heading = computeHeadingFromEcef(startPos, endPos);
            lastValidHeading = heading;
        }

        const speed = duration > 0 ? dist / duration : 0;

        result.push({ startTime, endTime, startPos, endPos, heading, speed });
    }

    return result;
}

// 시간 기반 위치 보간 (heading/speed는 추출 시 계산된 값 사용)
function interpolatePosition(sampled, t) {
    // 현재 시간에 해당하는 구간 탐색
    for (let i = 0; i < sampled.length; i++) {
        const { startTime, endTime, startPos, endPos, heading, speed } = sampled[i];
        if (t >= startTime && t <= endTime) {
            const duration = endTime - startTime;
            const localT = duration > 0 ? (t - startTime) / duration : 0;

            const pos = [
                startPos[0] + (endPos[0] - startPos[0]) * localT,
                startPos[1] + (endPos[1] - startPos[1]) * localT,
                startPos[2] + (endPos[2] - startPos[2]) * localT,
            ];

            return { position: pos, heading, speed };
        }
    }

    // 현재 시간에 해당하는 구간이 없으면 null 반환
    return null;
}

/**
 * ECEF 좌표의 두 점으로부터 ENU 프레임 기준 heading(북쪽=0, 시계방향 양수)을 계산합니다.
 * Cesium.HeadingPitchRoll.heading 규약과 동일합니다.
 */
function computeHeadingFromEcef(fromPos: number[], toPos: number[]): number {
    const [fx, fy, fz] = fromPos;
    const [tx, ty, tz] = toPos;

    const dx = tx - fx;
    const dy = ty - fy;
    const dz = tz - fz;

    // 'from' 위치의 위경도
    const r = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const lat = Math.asin(fz / r);
    const lon = Math.atan2(fy, fx);

    // ECEF 방향벡터를 ENU로 변환
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    const east  = -sinLon * dx + cosLon * dy;
    const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;

    // 북쪽 기준 시계방향 각도 (atan2(east, north))
    return Math.atan2(east, north);
}
