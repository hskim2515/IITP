# 차량 궤적 viewport+시간창 로딩 설계 (개별 차량 near LOD)

> 목적: 재생 시 가까이서 개별 차량을 볼 때, 전체 차량 전체시간 궤적(수도권 ~2.2GB)을
> 통째로 받지 않고 **viewport + 재생 시간창**의 차량 궤적만 받아 메모리/처리를 제한.
> 멀리(overview)는 이미 백엔드 집계로 해결됨([[project-data-scaling]]). 이 문서는 near(개별) 전용.

## 0. 현황 (측정 근거)

- `POST /vehicle/vehicle-route/{scenarioKey}` → 캐시된 **czml(전체 차량 전체시간 궤적)** 통째 반환.
  scenario1 4.4MB → 수도권 환산 ~2.2GB.
- 프론트: 전송 → worker `init`에서 **전체 차량 보간 샘플(sampledPositionsList) 한 번에 빌드** → 매 tick 전체 보간.
- 차량/시간 필터 없음 (`numVehicle` 개수 제한만).
- ⏳ **병목 측정 필요**: 계측 코드 삽입됨(`[PERF]` 로그) — 전송 vs worker init 빌드 vs 파싱. 브라우저 재생으로 확인.

## 1. 차량 데이터의 특수성 (단순 공간 필터 불가)

차량은 **시공간 2차원**이고 **보간 재생**이 필요:
- bbox 필터 ≠ 정적 "안/밖". 차량이 움직이므로 **"시간창 내 한 번이라도 bbox 교차한 차량"** 으로 정의.
- 시간창 경계: 보간하려면 경계 앞뒤 **버퍼 샘플**이 필요(없으면 차량이 화면 진입 시 끊김/점프).

## 2. 백엔드 API (additive)

```
POST /vehicle/vehicle-route/{scenarioKey}
  body: { numVehicle, speedFactor, czml,
          bbox?: "w,s,e,n",          // 없으면 전체 (기존 호환)
          fromTime?, toTime?,         // 시간창(초). 없으면 전체
          bufferSec?: 30 }            // 시간창 양쪽 버퍼 (보간 연속성)
```

- 캐시된 czml(또는 vehicle_sim.db)을 필터:
  - **차량 선별**: `[fromTime-buffer, toTime+buffer]` 구간에서 한 번이라도 bbox 교차한 veh_id
  - **궤적 슬라이싱**: 선별 차량의 `[fromTime-buffer, toTime+buffer]` 구간 positionsInterval만
- bbox 내 차량 판정은 차량 위치(pos_x/pos_y → 경위도) 기준. 네트워크 RTree(링크 bbox)와 협업하거나, vehicle_sim.db 좌표 직접 비교.
- **완전 additive**: 파라미터 없으면 기존 전체 반환 → 0 리스크.

## 3. 프론트 재로드 전략 (가장 까다로움)

재생 중 viewport/시간이 계속 바뀜 → 매번 재요청하면 끊김. 전략:

| 트리거 | 동작 |
|---|---|
| moveend (공간 이동) | throttle 후 새 bbox로 재요청 → worker 재빌드 |
| 재생 시간창 이동 | 현재 시각이 로드된 시간창의 80% 도달 시 다음 창 prefetch |
| viewport 안정 + 시간창 내 | 재요청 없음 (로드된 데이터로 보간) |

- **worker 재빌드 비용**이 핵심 (측정 1번 결과에 따라). 전체 재빌드가 비싸면 → 증분(신규 차량만 add, 벗어난 차량 remove) 필요.
- **보간 연속성**: 재빌드 시 현재 재생 위치(elapsed) 보존. 버퍼 덕에 경계 차량도 궤적 보유.
- **인덱스 보존 제약**: 현재 worker는 trail[i]↔vehicle[i] 인덱스 매핑. 차량 집합이 바뀌면 이 매핑 재설계 필요(VehicleFeatureLayer/TailPrimitive/VehiclePrimitive 모두 영향) → **큰 작업**.

## 4. 단계적 도입 (위험 최소화)

| 단계 | 내용 | 위험 |
|---|---|---|
| 0 | 계측 (완료) → 병목 확정 | 없음 |
| 1 | 백엔드 필터 파라미터 (additive, 없으면 전체) | 낮음 |
| 2 | 프론트: 공간(bbox)만 필터, 전체시간 유지 → 재로드는 moveend만, 보간 끊김 없음(차량별 전체궤적) | 중 |
| 3 | + 시간창 필터 + 버퍼 + prefetch | 높음 (재생 연속성) |
| 4 | worker 인덱스 매핑 재설계 (증분 빌드) | 높음 (3개 소비자 영향) |

> **권장**: 측정(0) → 백엔드 필터(1) → 공간만(2)까지 안전. 시간창(3)·증분(4)은 재생 기능 회귀 위험이 커
> 측정으로 worker 빌드가 진짜 병목임이 확인된 후 신중히.

## 5. 미결 질문 (측정 후 확정)

- 병목이 worker init 빌드인가 전송인가? (계측 `[PERF]` 로그로)
- bbox 차량 판정: vehicle_sim.db 좌표 직접 vs 네트워크 RTree 협업?
- worker 인덱스 매핑: 차량 집합 변경 시 trail↔vehicle 매핑 어떻게 유지?
- 재생 중 재빌드 빈도/throttle 값?
