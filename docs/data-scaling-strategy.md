# 데이터별 메모리/규모 전략 (신호등 · 차량 시뮬레이션)

> 목적: 광역권→전국 규모에서 **각 데이터를 메모리에 전부 들지 않고** 다루는 전략을 데이터 성격별로 정리.
> 전제: 네트워크(도로)는 이미 BBox 타일링 완료(`docs/network-bbox-tiling-design.md`).
> 이 문서는 **신호등**과 **차량 시뮬레이션** 두 데이터의 설계만 다룬다 (구현 전 결정용).

## 0. 메모리 부담 실측 (scenario1 = 도시 1개 ~23.6km² 기준)

| 데이터 | scenario1 파일 | 수도권 환산(×496) 메모리(~4배) | 성격 |
|---|---|---|---|
| 네트워크 | 530 KB | **~1,027 MB** | 정적, 공간 |
| **신호등** | 52 KB | **~100 MB** | 정적, 공간(노드 종속) |
| 철도(노선+역) | 16 KB | ~31 MB | 정적, 공간 |
| 버스 | 6 KB | ~11 MB | 정적, 공간 |
| **차량 시뮬** | (별도 SQLite ~95 MB/시나리오) | **수 GB~수십 GB** | **동적, 시공간(2차원)** |

→ 네트워크(1GB)는 타일링으로 해결됨. **다음 부담은 신호(100MB)와 차량(수 GB).**
→ 둘은 성격이 달라 **전략이 다르다**: 신호=공간 타일링, 차량=백엔드 집계.

---

## 1. 신호등 — 공간 타일링 (네트워크 격자 재사용)

### 성격
- 정적 점/그룹 데이터. **신호는 네트워크 노드(교차로)에 종속** — 노드마다 신호 그룹.
- 수도권 ~100MB: "위험"보단 "경계선"이지만, 네트워크와 함께 올리면 합산 부담.

### 전략: 네트워크 타일과 **동일 격자(0.05°)로 묶기**
신호가 노드에 붙어있으므로, 노드의 home 타일 = 신호의 home 타일. 별도 공간 인덱스 설계 없이
네트워크 타일링 인프라(`NetworkTileManager`, SQLite+RTree 패턴)를 그대로 복제·재사용한다.

### 구현 스케치 (네트워크와 1:1 대응)
| 계층 | 네트워크(완료) | 신호(설계) |
|---|---|---|
| 백엔드 저장 | SQLite+RTree (`NetworkTileService`) | `SignalTileService` — signal.xml → SQLite+RTree (노드 좌표 기준 bbox) |
| 백엔드 API | `GET /network/{v}/tiles?bbox` | `GET /signal/{v}/tiles?bbox` |
| 프론트 매니저 | `NetworkTileManager` | **동일 매니저 재사용** (콜백만 신호용) |
| 프론트 렌더 | `NetworkFeatureLayer`/`DataSourceLayer` | `SignalFeatureLayer`(OL)/`SignalDataSourceLayer`(Cesium) 타일 통합 |
| 플래그 | `NETWORK_TILING.ENABLED` | `SIGNAL_TILING.ENABLED` (별도, 기본 off) |

### 결정 필요 사항
1. **신호 타일을 네트워크 타일과 동기화할지** — 같은 viewport면 같은 타일 집합. 매니저 인스턴스를 공유할지(결합도↑) 별도 둘지(단순).
   - 권장: **별도 매니저 인스턴스, 같은 격자**. 결합 없이 일관.
2. **신호 LOD**: 이미 `getSignalLodTierByResolution`(cluster/marker/detail) 존재. 타일링과 직교 — overview에선 타일 fetch 안 함(어차피 dot도 안 보임), near 이상에서만.
3. **렌더 통합 시 기존 시뮬레이션 신호 애니메이션과의 정합** — 신호 현시는 timestep 기반으로 색이 바뀜(`SignalFeatureLayer`의 `signalRenderState`). 타일 evict 시 애니메이션 대상에서도 빠져야 함(메모리/연산 일관).

### 난이도/위험
- 패턴이 검증돼 있어 **중간 난이도**. 단, 신호 렌더는 시뮬레이션 색 애니메이션과 얽혀 있어 네트워크보다 통합 표면이 약간 넓음.

---

## 2. 차량 시뮬레이션 — 백엔드 집계 + 근거리 개별 (타일링만으론 부족)

### 성격 (근본적으로 다름)
- **시공간 2차원**: 차량(veh_id) × 시각(timestep). 공간만 자르는 타일링으로는 시간축이 안 줄어든다.
- 수 GB~수십 GB. 개별 차량을 브라우저 메모리에 전부 드는 것은 **원천 불가능**.
- 이미 **백엔드 SQLite**(`vehicle_sim.db`)에 저장 + `GROUP BY`로 부분 집계 중.

### 핵심 통찰
> 멀리서 사용자가 원하는 건 "차량 1대 1대"가 아니라 **"이 도로가 막히나"(집계)**.
> 개별 차량 수십만 대를 점으로 찍을 이유가 없다 → **백엔드가 집계해서 내려준다.**

### 전략: LOD별 표현 전환 (공간 타일링 ≠ 정답)
```
overview(멀리)  → 백엔드 집계: 링크별 교통량/평균속도 → 색상/히트맵   [개별 차량 0대 전송]
mid           → 링크별 집계(더 세밀) 또는 샘플링된 대표 차량
near(가까이)   → 개별 차량 궤적: viewport(공간) + 재생 시간창(시간) 윈도우만
```

### 이미 존재하는 자산 (재사용 가능 — 중요)
| 자산 | 위치 | 역할 |
|---|---|---|
| `AnalyticsController` | `GET /analytics/link-stats/{v}`, `/summary/{v}` | 링크별/전체 집계 API **이미 있음** |
| `readLinkStats` | `VehicleDataReader` | SQLite `GROUP BY`로 link_id별 volume/avgSpeed 집계 (전체 로드 없이) |
| `LinkStatsResponse` | `model/analytics` | `{time, volume, avgSpeed}`, `topLinks[]` 모델 |
| 히트맵 레이어 4종 | `TrafficHeatmapFeatureLayer`, `SpeedHeatmapOlLayer`, `HeatmapFeatureLayer`, `ODMatrixFeatureLayer` | 집계 결과 **표시 그릇 이미 있음** |
| 개별 차량 | `czmlPositionWorker` + `VehicleFeatureLayer` | 근거리 개별 렌더(완료) |

→ **차량 overview 집계는 "0에서 시작"이 아니다.** 집계 API·히트맵 레이어가 있고, **연결·LOD 게이팅**이 빠져있다.

### 빠진 것 (설계가 필요한 부분)
1. **공간 집계**: 현재 `readLinkStats`는 전체(또는 topN) 집계. overview에서 **bbox 내 링크별** 집계로 확장 필요.
   - `GET /analytics/link-stats/{v}?bbox=&timeWindow=` (bbox + 시간창 필터 추가)
   - SQLite: `WHERE link_id IN (bbox 내 링크) AND timestep BETWEEN ? AND ? GROUP BY link_id`
   - bbox 내 링크 id는 **네트워크 SQLite+RTree(이미 있음)** 로 구함 → 두 SQLite 협업.
2. **시간창**: 재생 중인 현재 시각 ± 윈도우만. 전체 시뮬레이션 시간을 다 보지 않음.
3. **LOD 게이팅**: overview/mid=집계 히트맵 호출, near=개별 차량 worker. resolution/altitude 기준 전환.
4. **재생과의 결합**: 집계는 시간창이 재생 위치를 따라가야 함(매 프레임 X, throttle).

### 결정 필요 사항
1. **집계 단위**: 링크별이 기본(이미 link_id 집계 존재). 더 멀면 격자(grid) 집계가 나을 수도 — 링크가 sub-pixel이 되는 전국 조망.
   - 권장: overview=링크별(기존 재사용), 매우 원거리=격자 집계(추가).
2. **집계 시점**: (a) 실시간 쿼리 vs (b) 사전 집계 테이블.
   - 재생 중 시간창이 계속 바뀌므로 (a) 실시간 `GROUP BY`가 자연스러움(SQLite는 빠름). 너무 느리면 (b) 시간버킷 사전집계.
3. **near 개별 차량의 공간 윈도우**: 현재 `czmlPositionWorker`는 전체 차량 처리? viewport culling 필요한지 확인 후 결정 (별도 측정).

### 난이도/위험
- **집계 경로(overview/mid)**: 자산 많아 **중간**. 주로 연결 + bbox/시간창 쿼리 확장.
- **개별 차량 viewport culling(near)**: worker 구조 변경 필요할 수 있어 **측정 후 판단**.

---

## 3. 통합 데이터 전략 요약

| 데이터 | 메모리 | 전략 | 상태 |
|---|---|---|---|
| 네트워크 | ~1GB | 공간 타일링(SQLite+RTree, MVT) | ✅ 완료 |
| 신호등 | ~100MB | 공간 타일링 (네트워크 격자 재사용) | ⬜ 설계됨, 패턴 검증됨 |
| 철도/버스 | ~11~31MB | 클러스터링 + LOD | ✅ 완료(충분) |
| 차량 시뮬 | 수 GB | **백엔드 집계**(멀리) + 공간·시간 윈도우(가까이) | ⬜ 설계됨, 자산 다수 존재 |

### 공통 원칙
- **정적·공간 데이터(네트워크/신호)**: 공간 타일링 — viewport 격자만 메모리 보유.
- **동적·시공간 데이터(차량)**: 백엔드 집계 — 멀리선 통계만, 가까이선 viewport+시간창 개별.
- 모든 기능은 **플래그 게이팅 + additive** — 기존 동작 0 리스크.

### 권장 진행 순서
1. **신호 타일링** — 검증된 네트워크 패턴 복제. 명확, 100MB 절감. 단 시뮬 신호 애니메이션 정합 주의.
2. **차량 overview 집계** — 기존 `AnalyticsController`+히트맵 연결 + bbox/시간창 쿼리. "멀리서 전체 교통량"의 정공법.
3. (측정 후) **차량 near viewport culling** — worker 구조 확인 후 필요시.

### 미결 질문 (구현 착수 전 확정 필요)
- 신호 타일 매니저: 네트워크와 공유 vs 별도 (권장: 별도, 같은 격자)
- 차량 집계: 실시간 쿼리 vs 사전집계 (권장: 실시간 시작, 느리면 전환)
- 차량 집계 단위: 링크별 vs 격자 (권장: 링크별, 초원거리만 격자)
