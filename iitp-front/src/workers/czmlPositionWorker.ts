
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

// 이 미만 이동은 "정지"로 간주 — heading을 그 구간의 (노이즈 섞인) 변위로 갱신하지 않는다.
const MOVEMENT_THRESHOLD_M = 0.5;

/**
 * 원시 timestep 포인트 배열을 세그먼트로 가공한다.
 *
 * 예전엔 인접한 두 원시 포인트 사이를 그냥 직선으로 잇고, heading도 그 두 점의 변위 하나로만
 * 계산해 세그먼트 경계에서 한 번에 툭 꺾였다(실측: 커넥션 진입 직전 급격히 꺾임, 차선변경이
 * 부자연스러움 — NextSim 원시 timestep 간격이 커브를 통과하는 시간보다 성길 때 직선으로
 * 코너를 잘라가며 이동하는 현상). 지금은 각 포인트마다 인접 포인트의 실제 이동으로부터 접선
 * (tangent, 속도 벡터)을 추정해 Hermite(비균일 Catmull-Rom 스타일) 스플라인으로 보간한다 —
 * 위치가 곡선을 그리며 매끄럽게 지나가고, heading도 그 스플라인의 접선 방향을 그대로 따라가
 * 연속적으로 회전한다.
 *
 * gap(다음 포인트까지 시간 간격 > GAP_THRESHOLD) 경계에서는 접선을 넘겨받지 않는다 —
 * 불연속(순간이동) 구간을 매끄럽게 이으면 이어붙는 방향이 실제와 다르게 왜곡된다.
 *
 * 정지 구간(이동 거리 < MOVEMENT_THRESHOLD_M): 위치 스플라인 접선은 그대로(실제로 거의 안
 * 움직이므로) 두되, 표시용 heading은 "직전 유효 방향"을 유지한다 — 노이즈 섞인 미세 변위로
 * 방향이 떨리는 것을 막기 위함(예전과 동일한 의도).
 *
 * ⚠️ 예전 버그: 트랙 맨 앞부터 정지 상태(스폰 직후 대기, 또는 뷰포트 스트리밍 창이 하필
 * 차량이 이미 정지해 있는 구간부터 시작)면 "직전 유효 방향"이 아직 없어 기본값 0(정북)을
 * 그대로 써서, 도로 방향과 무관하게 항상 정북을 보고 서 있었다(실측: "정지 시 뒤를 봄" 등
 * 도로와 안 맞는 방향으로 보임). 지금은 트랙 내에서 나중에라도 실제 이동이 관측되면 그
 * 방향으로 앞쪽 정지 구간 전체를 역채움한다 — 트랙 전체가 끝까지 정지 상태일 때만(방향을
 * 추정할 단서가 아예 없는 극단적 경우) 부득이 0으로 남는다.
 */
function extractSampledPositionsFromFlatArray(flatArray) {
    const step = 4;
    const n = Math.floor(flatArray.length / step);
    if (n < 2) return [];

    const times  = new Array(n);
    const points = new Array(n); // [x, y, z] (ECEF)
    for (let i = 0; i < n; i++) {
        times[i]  = flatArray[i * step];
        points[i] = [flatArray[i * step + 1], flatArray[i * step + 2], flatArray[i * step + 3]];
    }

    // 세그먼트(포인트 i → i+1) 단위 거리/시간/gap 여부
    const edgeDist = new Array(n - 1);
    const edgeGap  = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
        const dx = points[i + 1][0] - points[i][0];
        const dy = points[i + 1][1] - points[i][1];
        const dz = points[i + 1][2] - points[i][2];
        edgeDist[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        edgeGap[i]  = (times[i + 1] - times[i]) > GAP_THRESHOLD;
    }

    // 포인트별 접선(위치 스플라인용) — gap 건너로는 넘기지 않고 편측 차분으로 대체
    const tangent = new Array(n);
    for (let i = 0; i < n; i++) {
        const leftOk  = i > 0 && !edgeGap[i - 1];
        const rightOk = i < n - 1 && !edgeGap[i];
        if (leftOk && rightOk) {
            const dt = times[i + 1] - times[i - 1];
            tangent[i] = dt > 0 ? [
                (points[i + 1][0] - points[i - 1][0]) / dt,
                (points[i + 1][1] - points[i - 1][1]) / dt,
                (points[i + 1][2] - points[i - 1][2]) / dt,
            ] : [0, 0, 0];
        } else if (rightOk) {
            const dt = times[i + 1] - times[i];
            tangent[i] = dt > 0 ? [
                (points[i + 1][0] - points[i][0]) / dt,
                (points[i + 1][1] - points[i][1]) / dt,
                (points[i + 1][2] - points[i][2]) / dt,
            ] : [0, 0, 0];
        } else if (leftOk) {
            const dt = times[i] - times[i - 1];
            tangent[i] = dt > 0 ? [
                (points[i][0] - points[i - 1][0]) / dt,
                (points[i][1] - points[i - 1][1]) / dt,
                (points[i][2] - points[i - 1][2]) / dt,
            ] : [0, 0, 0];
        } else {
            tangent[i] = [0, 0, 0]; // 양쪽 다 gap 또는 트랙 경계 — 고립점
        }
    }

    // 포인트별 "실이동 여부" — 인접한(gap 아닌) 엣지 중 하나라도 임계 거리 초과면 실이동
    const hasRealMovement = new Array(n).fill(false);
    for (let i = 0; i < n - 1; i++) {
        if (edgeGap[i]) continue;
        if (edgeDist[i] > MOVEMENT_THRESHOLD_M) { hasRealMovement[i] = true; hasRealMovement[i + 1] = true; }
    }

    // 정지 구간 표시용 heading 방향(단위 벡터) — 직전 유효 방향 유지 + 맨 앞 정지 구간은
    // 이후 첫 유효 방향으로 역채움 (위 함수 설명 참고)
    const headingDir: (number[] | null)[] = new Array(n).fill(null);
    let lastValidDir: number[] | null = null;
    let firstValidDir: number[] | null = null;
    let firstValidIndex = -1;
    for (let i = 0; i < n; i++) {
        if (hasRealMovement[i]) {
            const [tx, ty, tz] = tangent[i];
            const mag = Math.sqrt(tx * tx + ty * ty + tz * tz);
            const dir = mag > 0 ? [tx / mag, ty / mag, tz / mag] : lastValidDir;
            if (dir) {
                headingDir[i] = dir;
                lastValidDir = dir;
                if (!firstValidDir) { firstValidDir = dir; firstValidIndex = i; }
            }
        } else {
            headingDir[i] = lastValidDir;
        }
    }
    if (firstValidDir) {
        for (let i = 0; i < firstValidIndex; i++) headingDir[i] = firstValidDir;
    }
    // firstValidDir가 끝까지 null이면(트랙 전체가 정지) headingDir는 전부 null로 남고,
    // 아래 interpolatePosition에서 이 경우만 부득이 heading=0으로 폴백한다.

    const result = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
        result[i] = {
            startTime: times[i], endTime: times[i + 1],
            startPos: points[i], endPos: points[i + 1],
            mStart: tangent[i], mEnd: tangent[i + 1],
            dirStart: headingDir[i], dirEnd: headingDir[i + 1],
            moving: edgeDist[i] > MOVEMENT_THRESHOLD_M,
            speed: (times[i + 1] - times[i]) > 0 ? edgeDist[i] / (times[i + 1] - times[i]) : 0,
            isGap: edgeGap[i],
        };
    }
    return result;
}

// Hermite 기저함수(및 도함수) — s ∈ [0,1] 구간 로컬 파라미터
function hermiteBasis(s: number) {
    const s2 = s * s, s3 = s2 * s;
    return {
        h00: 2 * s3 - 3 * s2 + 1,
        h10: s3 - 2 * s2 + s,
        h01: -2 * s3 + 3 * s2,
        h11: s3 - s2,
    };
}
function hermiteBasisDeriv(s: number) {
    const s2 = s * s;
    return {
        dh00: 6 * s2 - 6 * s,
        dh10: 3 * s2 - 4 * s + 1,
        dh01: -6 * s2 + 6 * s,
        dh11: 3 * s2 - 2 * s,
    };
}

// 시간 기반 위치 보간 — 세그먼트별 접선을 이용한 Hermite 스플라인으로 곡선 통과,
// heading은 정지 구간이면 저장된 방향을, 이동 구간이면 스플라인 접선(순간 이동 방향)을 사용
function interpolatePosition(sampled, t) {
    for (let i = 0; i < sampled.length; i++) {
        const seg = sampled[i];
        if (t < seg.startTime || t > seg.endTime) continue;

        // gap 구간: 두 좌표를 잇는 보간이 순간이동/비행으로 보이므로 차량을 숨김
        if (seg.isGap) return null;

        const dt = seg.endTime - seg.startTime;
        const s  = dt > 0 ? (t - seg.startTime) / dt : 0;
        const { h00, h10, h01, h11 } = hermiteBasis(s);

        const P0 = seg.startPos, P1 = seg.endPos, m0 = seg.mStart, m1 = seg.mEnd;
        const pos = [
            h00 * P0[0] + h10 * dt * m0[0] + h01 * P1[0] + h11 * dt * m1[0],
            h00 * P0[1] + h10 * dt * m0[1] + h01 * P1[1] + h11 * dt * m1[1],
            h00 * P0[2] + h10 * dt * m0[2] + h01 * P1[2] + h11 * dt * m1[2],
        ];

        let heading: number;
        if (seg.moving) {
            const { dh00, dh10, dh01, dh11 } = hermiteBasisDeriv(s);
            // dP/dT = (dP/ds) / dt
            const vel = dt > 0 ? [
                (dh00 * P0[0] + dh10 * dt * m0[0] + dh01 * P1[0] + dh11 * dt * m1[0]) / dt,
                (dh00 * P0[1] + dh10 * dt * m0[1] + dh01 * P1[1] + dh11 * dt * m1[1]) / dt,
                (dh00 * P0[2] + dh10 * dt * m0[2] + dh01 * P1[2] + dh11 * dt * m1[2]) / dt,
            ] : [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]];

            const velMag = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
            const dir = velMag > 1e-6 ? vel : [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]];
            heading = computeHeadingFromDirection(pos, dir);
        } else {
            const dir = seg.dirStart ?? seg.dirEnd;
            heading = dir ? computeHeadingFromDirection(pos, dir) : 0;
        }

        return { position: pos, heading, speed: seg.speed };
    }

    // 현재 시간에 해당하는 구간이 없으면 null 반환
    return null;
}

/**
 * ECEF 위치와 그 지점에서의 이동 방향 벡터(임의 크기)로부터 ENU 프레임 기준 heading
 * (북쪽=0, 시계방향 양수)을 계산한다. Cesium.HeadingPitchRoll.heading 규약과 동일하다.
 */
function computeHeadingFromDirection(atPos: number[], dir: number[]): number {
    const [fx, fy, fz] = atPos;
    const [dx, dy, dz] = dir;

    const r = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const lat = Math.asin(fz / r);
    const lon = Math.atan2(fy, fx);

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    const east  = -sinLon * dx + cosLon * dy;
    const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;

    // 북쪽 기준 시계방향 각도 (atan2(east, north))
    return Math.atan2(east, north);
}
