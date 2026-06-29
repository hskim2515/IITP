# 전국 네트워크 대응 설계 (서버 ingest 병목 해소)

> 배경: 클라이언트(타일링/LOD/메모리)는 이미 전국 규모와 무관하게 viewport만 다룬다.
> 전국에서 먼저 터지는 곳은 **서버 import/ingest** — 전체를 한 번에 JVM 힙에 올리는 부분.

## 0. 규모 추정

| | 부천 (현재) | 전국 (추정) |
|---|---|---|
| 링크 | 41,410 | ~2천만 (×500) |
| XML | 70MB | ~30GB |
| 면적 | 53km² | 100,000km² |

## 1. 무엇이 잘 되고 무엇이 막히나 (측정/코드 기반)

### ✅ 전국에서도 동작 (클라이언트 + 조회)
| 구성 | 근거 |
|---|---|
| 클라 fetch = viewport 타일만 | `NetworkTileManager`: 화면 타일(수십 개)만, 전국 무관 |
| 백엔드 조회 = RTree bbox 교차 | `WHERE r.maxX>=? AND ...` O(log n + k), 2천만 중 viewport 수백 |
| 클라 메모리 = LRU 64타일 + 멀리서 clear | viewport 규모로 제한 |

### ❌ 전국에서 막힘 (서버 ingest)
| 병목 | 코드 | 문제 |
|---|---|---|
| **A. ingest 메모리** | `ensureDb`→`getNetworkXmlByVersionId`→`toResponse`→`ingest(NetworkResponse resp)` | **전체 2천만 링크를 `NetworkResponse`로 JVM 힙에 1회** → OOM (수십 GB 힙) |
| **B. .db 크기** | `buildDb`가 링크 json 전체 저장 | 단일 SQLite 파일 수~수십 GB |
| **C. ingest 시간** | 전체 파싱 + batch insert | 수십 분~시간 (요청 타임아웃) |
| **D. overview 타일** | 멀리 줌아웃 시 1타일이 전국 간선 담음 | `lod_rank` 필터해도 전국 간선 다수 |

> 핵심: `ingest(NetworkResponse resp)`는 **호출 시점에 이미 전체가 힙에 있음**(resp가 전체 객체).
> 진짜 병목은 `toResponse`까지의 "전체를 메모리 객체로" 단계.

## 2. 대응 방향 (3가지, 조합 가능)

### 방향 1 — 지역 분할 import (가장 현실적, 현 구조 재사용)
전국을 시도/권역별 여러 `versionId`로 나눠 import. 각각 독립 `.db`.
- 장점: 현 코드 거의 그대로. 권역당 수만~수십만 링크 → 힙 OK.
- 단점: 권역 경계 처리, 클라가 여러 versionId 동시 조회(viewport가 경계 걸칠 때).
- 클라: viewport bbox로 어느 권역 .db 인지 라우팅 (권역 인덱스 필요).

### 방향 2 — ingest 스트리밍 (단일 versionId 전국)
XML을 전체 객체로 만들지 말고 **streaming(StAX/SAX) 파싱하며 SQLite에 바로 insert**.
- 장점: 메모리 상수(O(1)), 단일 versionId로 전국.
- 단점: `getNetworkXmlByVersionId`→`toResponse`(JAXB 전체 언마샬) 경로를 streaming 으로 재작성. 큰 작업.
- `.db` 크기(B)·시간(C)은 여전 — 단 메모리(A)는 해결.

### 방향 3 — 사전 빌드 + 영구 .db
ingest를 요청마다가 아니라 **오프라인 1회** 빌드 후 디스크 .db 영구 보관.
- 현재 `dbCache`는 temp 파일(`deleteOnExit`) → 재시작마다 재빌드. 영구화 필요.
- 전국 .db를 배치 job 으로 미리 만들어 두면 런타임 ingest 없음.
- 방향 1/2 와 조합 (분할 .db 들을 사전 빌드).

## 3. overview(멀리) 대응 (D)
전국을 한 화면에 보면 overview 타일이 전국 간선을 담음.
- 현재: `lod_rank <= 0`(간선만) 필터. 전국 간선도 많음.
- 대응: overview/mid 용 **사전 단순화 타일**(간선 중심선 미리 추출·캐시) 또는
  z 별 lod_rank 임계 세분(아주 멀면 고속도로만).
- 2D MVT 는 z/x/y 슬리피라 멀어도 타일당 영역은 작음 → 타일 수만 많아짐(OL이 관리).

## 4. 권장 로드맵

| 단계 | 내용 | 비고 |
|---|---|---|
| N1 | **방향 3 (영구 .db)** — dbCache temp→영구, 재시작 후 재사용 | 작음, 즉효 |
| N2 | **방향 1 (지역 분할)** — 권역별 versionId + 클라 viewport→권역 라우팅 | 현실적 |
| N3 | **방향 2 (streaming ingest)** — 단일 전국 필요 시 | 큰 작업 |
| N4 | **overview 사전 단순화** (D) | 멀리 조망 품질 |

> 권장: **N1 → N2** 가 비용 대비 효과 최선. 단일 전국 .db(N3)는 정말 필요할 때.
> 클라이언트는 추가 작업 거의 없음(권역 라우팅 정도) — 이미 전국 대응 구조.

## 5. 현재 상태 결론
- **한 도시(수만 링크)**: 현 구조로 동작 (단 진행 중인 2D/3D 일치·지면관통 버그는 별개)
- **전국(수천만 링크)**: 클라 OK, **서버 ingest가 OOM/시간 병목** → 위 N1~N3 필요
- 이 문서는 설계만. 구현은 별도 결정 후.
