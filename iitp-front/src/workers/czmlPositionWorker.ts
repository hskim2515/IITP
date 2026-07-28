
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

// 실측(vehicle_sim.db 직접 조회): 커넥션 안쪽의 짧은 링크는 NextSim이 그 안에서 중간
// 샘플을 하나도 안 남기고 진입/진출 좌표만 남기는 경우가 있다(예: 82.4m짜리 링크를 1.0초
// 만에 "통과" — 그 사이 vehicle_sim.db의 실제 spd 컬럼은 시종일관 50km/h였는데, 이 구간만
// 평균 297km/h로 계산됨). 시간 간격(7초) 기준만으로는 못 잡는다 — 이런 점프는 보통 1~3초
// 안에 일어나서 GAP_THRESHOLD 아래다. 거리/시간으로 역산한 평균 속도가 이 상한을 넘으면
// 시간 gap과 동일하게 처리(보간 대신 숨김).
// ⚠️ 처음엔 spd 컬럼의 관측 최댓값(180km/h, 설정상 상한으로 추정)을 기준으로 잡았는데,
// 그건 차량의 "그 순간 속도"일 뿐 두 샘플 사이 실제 이동거리로 역산한 평균 속도와는 다른
// 값이다 — 400대 표본(같은 링크 내 정상 구간 98,243건) 실측 결과 그 역산 평균 속도는 단
// 한 건도 82.9km/h를 넘지 않았다(정체 구간처럼 시간 간격이 굵어도 마찬가지). 100km/h로
// 낮춰도 오탐 0건 유지하면서 식별된 점프의 100%(241/241)를 잡는다.
const MAX_PLAUSIBLE_SPEED_MPS = 28; // ≈100.8km/h — 실측 정상 구간 최댓값(82.9km/h) 위 안전마진

// 실측(vehicle_sim.db 직접 조회, 400대 표본): 차가 서서히 정차할 때 마지막 몇 미터의
// 움직임은 방향이 신뢰할 수 없다 — 정차 직전 3.5m/4.1s 같은 극저속 구간이 직전까지 확립된
// 진행방향과 전혀 다른 각도(75도+ 차이)를 내는 경우가 흔했고, 이게 "마지막 유효 heading"으로
// 그대로 얼어붙어 정지한 차가 도로와 무관한 방향을 보고 서있는 것처럼 보였다(400대 중 1682건).
// ⚠️ 1차 시도(짧은 거리+큰 방향변화면 무조건 억제)는 진짜 교차로 회전까지 억제해 "회전할 때
// 방향은 안 바뀌고 위치만 바뀐다"는 회귀를 냈다(실사용자 확인). 2차 시도(링크 전환 지점이면
// 항상 신뢰)도 틀렸다 — 원인이 됐던 실제 사례(위 1682건 중 하나) 자체가 링크 전환 지점에서
// 발생해서, 링크가 바뀌었다는 사실만으론 회전인지 노이즈인지 못 갈랐다.
// 진짜 회전과 노이즈를 가르는 신호는 링크가 아니라 "그 다음에도 그 방향으로 계속 갔는가"였다
// — 회전은 이후 최소 한 번은 실제로 움직이며 같은(새) 방향을 다시 보여주는데, 노이즈는 그
// 자리에서 바로 멈춰버려 확인해줄 후속 샘플이 없다. 이 방식(확정 전까지 새 heading을 보류)
// 으로 400대 재검증 결과: 정차 노이즈 1682→627건(63% 감소)로 줄이면서, 실제 회전으로 보이는
// 84건(짧은 거리+큰 방향변화+이후 그 방향 유지)은 84/84(100%) 그대로 보존됐다.
const STOP_APPROACH_MAX_DIST = 20;
const STOP_APPROACH_MAX_HEADING_JUMP = 30 * Math.PI / 180;
const STOP_APPROACH_CONFIRM_LOOKAHEAD = 3; // 몇 구간 뒤까지 "그 방향으로 계속 갔는지" 확인할지
const STOP_APPROACH_CONFIRM_TOLERANCE = 30 * Math.PI / 180; // 확인 샘플이 후보 heading과 이 이내로 맞아야 "같은 방향"

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

    // 1차 패스 — 원시 구간(거리/시간/heading 후보)만 계산. 노이즈 판정은 이후 샘플이
    // 필요해서(확정 전까지 보류) 전체를 먼저 뽑아둬야 한다.
    const raw: { startTime: any; endTime: any; startPos: number[]; endPos: number[]; dist: number; duration: number; candidateHeading: number | null }[] = [];
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
        const candidateHeading = dist > 0.5 ? computeHeadingFromEcef(startPos, endPos) : null;
        raw.push({ startTime, endTime, startPos, endPos, dist, duration, candidateHeading });
    }

    // idx의 후보 heading이 노이즈가 아니라 "확정된 방향전환"인지 — 이후 실제로 움직인
    // 첫 샘플이 비슷한 방향이면 확정, 다르거나 그 전까지 계속 정지 상태면 미확정(노이즈로 처리)
    const isConfirmed = (idx: number, candidateHeading: number): boolean => {
        for (let k = idx + 1; k < Math.min(idx + 1 + STOP_APPROACH_CONFIRM_LOOKAHEAD, raw.length); k++) {
            const r = raw[k]!;
            if (r.dist > 0.5 && r.candidateHeading !== null) {
                return angularDiff(r.candidateHeading, candidateHeading) < STOP_APPROACH_CONFIRM_TOLERANCE;
            }
        }
        return false; // 그 전까지 계속 정지 — 확인해줄 후속 움직임이 없음
    };

    const result = [];
    let lastValidHeading: number | null = null;
    let firstValidHeading: number | null = null;
    let firstValidIndex = -1;

    for (let idx = 0; idx < raw.length; idx++) {
        const { startTime, endTime, startPos, endPos, dist, duration, candidateHeading } = raw[idx]!;

        // 이동 거리가 충분할 때만 heading 갱신 (0.5m 미만 = 정지/극미속)
        let heading = lastValidHeading;
        if (dist > 0.5 && candidateHeading !== null) {
            const isLowConfidenceJump = lastValidHeading !== null
                && dist < STOP_APPROACH_MAX_DIST
                && angularDiff(lastValidHeading, candidateHeading) > STOP_APPROACH_MAX_HEADING_JUMP
                && !isConfirmed(idx, candidateHeading);
            heading = isLowConfidenceJump ? lastValidHeading : candidateHeading;
            lastValidHeading = heading;
            if (firstValidHeading === null) {
                firstValidHeading = heading;
                firstValidIndex = result.length;
            }
        }

        const speed = duration > 0 ? dist / duration : 0;
        const isGap = duration > GAP_THRESHOLD || speed > MAX_PLAUSIBLE_SPEED_MPS;

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

// ⚠️ 차선변경 구간에서 heading을 앞/뒤 구간 방향으로 부드럽게 블렌딩하는 시도(오늘 세션에서
// 추가했다 되돌림)를 해봤으나, 위치 경로는 그대로 직선(실제 옆 차선으로 곧장 이동)인데
// heading만 "정면 유지"로 매끄럽게 바뀌니 차가 정면을 본 채로 옆으로 미끄러지는(수직으로
// 차선을 넘는) 게 더 부자연스러워 보였다(실사용자 확인 — "옆으로 이동하여 옆레인으로 진입").
// heading은 실제 이동 방향(segment 자신의 시작→끝 벡터)과 항상 일치해야 최소한 "차가 향하는
// 곳으로 움직인다"는 게 맞는다 — 5초간 대각선을 유지하는 게 어색해도, 그게 실제 이동 경로와
// 다른 방향을 보고 미끄러지는 것보다는 낫다(둘 다 근본적으로는 NextSim이 차선변경 "순간"을
// 세밀히 기록 안 하는 데이터 한계 — 차선 지오메트리를 참조해 실제 곡선 경로를 만들지 않는 한
// 완전히 자연스럽게 만들 수 없음).

// 두 각도(라디안) 사이의 최단 차이 — [0, π]
function angularDiff(a: number, b: number): number {
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
}

// 트립 종료 후 마지막 알려진 방향/속도로 계속 나아가는 것처럼 보이게 하는 유예 구간(초).
// 실측(vehicle_sim.db 직접 조회): 차량 데이터는 목적지에 "도착해 정차"한 뒤 끊기는 게 아니라
// 정지 없이 정상 주행 중(예: 40km/h)에 그냥 뚝 끊긴다 — 즉시 null 반환하면 "주행 중 갑자기
// 사라짐"이 되어 부자연스럽다. 마지막 구간의 방향으로 잠깐 더 외삽해 자연스럽게 화면 밖으로
// "빠져나가는" 것처럼 보이게 한 뒤에야 사라지게 한다.
const TRIP_END_EXTRAPOLATE_SEC = 2.0;

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

    // 트립이 막 끝난 직후(유예 구간 이내)면 마지막 구간의 진행 방향으로 외삽
    const last = sampled[sampled.length - 1];
    if (last && !last.isGap && t > last.endTime) {
        const dt = t - last.endTime;
        if (dt <= TRIP_END_EXTRAPOLATE_SEC && last.speed > 0) {
            const dx = last.endPos[0] - last.startPos[0];
            const dy = last.endPos[1] - last.startPos[1];
            const dz = last.endPos[2] - last.startPos[2];
            const segDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (segDist > 1e-6) {
                const extraDist = last.speed * dt;
                const ux = dx / segDist, uy = dy / segDist, uz = dz / segDist;
                const pos = [
                    last.endPos[0] + ux * extraDist,
                    last.endPos[1] + uy * extraDist,
                    last.endPos[2] + uz * extraDist,
                ];
                return { position: pos, heading: last.heading, speed: last.speed };
            }
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
