
// SQLite type 컬럼이 숫자 ID("1","2",...) 로 저장된 경우를 대비한 매핑
const NUMERIC_TYPE_MAP: Record<string, string> = { '1':'CAR','2':'TAXI','3':'BUS','4':'TRUCK','5':'MOTO' };
const normalizeVehicleType = (raw: string): string => NUMERIC_TYPE_MAP[raw] ?? raw;

let czmlData = null;
let sampledPositionsList = []; // 각 객체별 { vehicleType, sampled }
let workerGeneration = 0; // setSimulation 호출마다 갱신 — 스테일 메시지 식별용

// data.currentTime의 의미: "절대 경과초" (vehicle_sim.db의 timestep과 동일 기준 — 시뮬레이션
// 전체 시작(baseEpoch+simMin) 기준 초). 호출측(useSimulation.ts의 computeElapsedSec)이 매번
// 계산해서 넘겨준다.
//
// ⚠️ 예전엔 여기서 init 호출 시각을 referenceTime으로 잡고 그 뒤로는 "init 이후 경과한
// 실제(wall-clock) 시간"만 누적했다(elapsed = lastElapsed + (time-referenceTime)/1000).
// 그런데 각 차량 경로의 startTime/endTime은 vehicle_sim.db의 timestep 절대값(예: 뷰포트
// 스트리밍 시간창이 500~620이면 그 근방 값)이라서, init 시점마다 0부터 다시 세는 elapsed와
// 전혀 안 맞았다 — 뷰포트 스트리밍처럼 fromTime>0인 창을 불러올 때마다 거의 모든 차량이
// "이 순간엔 위치 없음(null)"으로 계산되어 차량이 멈추거나 안 보이는 근본 원인이었다.
// (전체-로드 모드는 항상 fromTime=0 근방이라 우연히 들어맞아서 문제가 안 보였다.)
// 이제는 호출측이 매번 절대 경과초를 직접 계산해 넘기므로 워커는 그 값을 그대로 쓰기만 하면 된다.

self.onmessage = function (e) {
    const data = e.data;

    if (data.type === "init") {
        // generation이 전달된 경우 워커 세대 갱신 (빈 reset init 포함)
        if (data.generation != null) workerGeneration = data.generation;

        czmlData = data.czmlPackets; // [{id, type, path:[t,x,y,z,...]}, ...] 또는 구버전 [[t,x,y,z,...], ...]

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
                vehicleType = normalizeVehicleType(String(track.type).toUpperCase());
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

        if (!sampledPositionsList || sampledPositionsList.length === 0) { self.postMessage(false); return; }

        // 초기 위치를 즉시 계산해 전달한다 — 이전엔 여기서 false만 보내고 다음 "tick"(재생 중
        // isRunning=true 일 때만 전송됨)을 기다렸다. 일시정지 상태에서 뷰포트 재로드가 일어나면
        // tick이 영원히 오지 않아 새로 만들어진 차량이 위치를 한 번도 못 받고 계속 안 보였다
        // ("시간은 가는데/재생 중지 상태에서 차량이 사라짐"의 핵심 원인). reset과 동일한 방식으로
        // init 시점에도 즉시 한 번 위치를 계산해 보낸다.
        postComputedPositions(data.currentTime);
    }

    else if (data.type === "tick") {
        if (!sampledPositionsList || sampledPositionsList.length === 0) return;
        postComputedPositions(data.currentTime);
    }

    else if (data.type === "reset") {
        // t=simMin(창 시작) 위치로 즉시 업데이트
        if (sampledPositionsList && sampledPositionsList.length > 0) {
            postComputedPositions(data.currentTime);
        }
    }
};

// filter() 하지 않고 원본 인덱스 보존: 비활성 차량은 null로 유지
// → TailPrimitive 등 인덱스 기반 레이어에서 trail[i] ↔ vehicle[i] 매핑 일치
function postComputedPositions(elapsed) {
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

// 백엔드 GAP_THRESHOLD(VehicleController)와 동일 — 이 이상 시간이 비면
// 차량이 다른 위치로 "이동"한 것이 아니라 "사라졌다 다시 나타난" 구간이므로
// 두 좌표 사이를 보간하면 차량이 순간이동/비행하는 것처럼 보인다.
const GAP_THRESHOLD = 7.0;

/**
 * 샘플 데이터 추출 (heading 사전 계산 포함, 세그먼트별 2점 직선보간 — NextSim 원시 timestep
 * 포인트를 그대로 잇는다. 스플라인으로 매끄럽게 잇는 시도(Hermite/Catmull-Rom)를 해봤으나,
 * 실제 교차로 급회전처럼 샘플 간격이 짧고 꺾임이 급한 구간에서 접선이 과도하게 커져
 * 코너를 훨씬 지나쳤다 되돌아오는 오버슈트(차량이 유턴하듯 보임)가 발생해 되돌렸다 —
 * 원시 샘플 사이 직선보간이 부자연스럽더라도, 실제 도로와 무관하게 엉뚱한 루프를 그리는
 * 것보다는 낫다. 정지 구간(이동 거리 < 0.5m)은 마지막 유효 heading을 그대로 유지 →
 * 교차로 대기 시 방향 깜빡임 방지.
 */
function extractSampledPositionsFromFlatArray(flatArray) {
    const step = 4;
    const result = [];
    let lastValidHeading: number | null = null;
    let firstValidHeading: number | null = null;
    let firstValidIndex = -1;

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
            if (firstValidHeading === null) {
                firstValidHeading = heading;
                firstValidIndex = result.length;
            }
        }

        const speed = duration > 0 ? dist / duration : 0;
        const isGap = duration > GAP_THRESHOLD;

        result.push({ startTime, endTime, startPos, endPos, heading, speed, isGap });
    }

    // 맨 앞 정지 구간(유효 heading 없음)은 첫 유효 heading으로 역채움 — 예전엔 기본값
    // 0(정북)을 그대로 써서, 스폰 직후 대기 중이거나(뷰포트 스트리밍 창이 하필 이미 정지한
    // 구간부터 시작하는 경우 포함) 도로 방향과 무관하게 항상 정북을 보고 서 있었다.
    if (firstValidHeading !== null) {
        for (let i = 0; i < firstValidIndex; i++) result[i].heading = firstValidHeading;
    } else {
        // 트랙 전체가 정지 — 방향을 추정할 단서가 아예 없는 극단적 경우만 부득이 0
        for (const r of result) if (r.heading === null) r.heading = 0;
    }

    return result;
}

// 시간 기반 위치 보간 (heading/speed는 추출 시 계산된 값 사용)
function interpolatePosition(sampled, t) {
    // 현재 시간에 해당하는 구간 탐색
    for (let i = 0; i < sampled.length; i++) {
        const { startTime, endTime, startPos, endPos, heading, speed, isGap } = sampled[i];
        if (t >= startTime && t <= endTime) {
            // gap 구간: 두 좌표를 잇는 보간이 순간이동/비행으로 보이므로 차량을 숨김
            if (isGap) return null;

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
