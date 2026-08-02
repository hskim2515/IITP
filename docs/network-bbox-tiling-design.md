# 네트워크 BBox 타일링 아키텍처 설계 (광역권 → 전국)

> 목적: 현재 "network.xml 통째 로드 → 전체 메모리 빌드" 구조를 **viewport 단위 공간 쿼리(bbox 타일링)** 로 전환하여
> 광역권을 넘어 전국 규모 도로망을 메모리/렌더 한계 없이 다룬다.
>
> 저장 계층: **SQLite + RTree** (PostGIS 아님 — 이미 `xerial:sqlite-jdbc` 스택 보유, versionId별 파일 모델과 일치)
> 전송: **LOD별 하이브리드** — overview/mid 2D 읽기는 MVT(PBF), near/detail·편집·Cesium은 JSON 도메인.

## 1. 문제 정의 (실측 근거)

현재 클라이언트 최적화(extent 게이팅 · LOD tier · 클러스터링)는 **화면에 그리는 비용**만 viewport로 제한했다.
**전체 데이터 양에 비례하는 비용**은 그대로다:

| 비용 | 비례 대상 | 현재 |
|---|---|---|
| 데이터 fetch/파싱 | 전체 링크 수 | network.xml 통째 |
| `fullBuild` (피처 생성) | 전체 링크 수 | 전부 메모리 materialize |
| 공간 인덱스 빌드 | 전체 링크 수 | O(N) 전수 |
| tier 변경 reconcile | 전체 링크 수 | O(N) 스캔 |
| 메모리 (피처 캐시) | 전체 링크 수 | viewport 무관 상주 |

**실측**(합성 격자망, `scripts/bench-extent-gating.mjs`): 8GB 힙으로 **200k 링크에서 OOM**. 100k는 통과하나 tier 변경 시 0.7~0.9초 끊김.
→ 대도시 1개(~10만 링크)가 현재 구조의 천장. 전국(수십만~수백만 링크)은 로드 단계에서 실패.

## 2. 핵심 원칙

> **"화면에 보이는 영역(+버퍼)의 데이터만 받아 빌드하고, 벗어난 타일은 메모리에서 버린다(evict)."**

- 메모리를 줄이는 주체는 **타일링 + evict**다. MVT가 아니다.
  MVT를 써도 전국 타일을 다 들고 evict 안 하면 결국 OOM. JSON이라도 타일+evict면 O(viewport) 천장이 선다.
- MVT는 그 위에 얹는 **overview/mid 읽기 경로 추가 압축**(PBF 바이너리 + OL 워커 디코딩 + VectorTile 자체 캐시).

### evict가 실제 효과를 내려면 (3가지 전제)
1. OL 피처 `removeFeatures` + 참조 해제 (현 게이팅은 화면에서만 빼고 캐시엔 남김 → **캐시째 버리도록 승격**)
2. Cesium 프리미티브 destroy (GPU 버퍼까지) — 타일 단위 청크 파괴
3. 편집 모델이 전체 네트워크를 메모리에 붙들지 않을 것 (→ §6, 가장 큰 작업)

## 3. 저장 계층: SQLite + RTree

현재: network.xml 파일(SFTP), 공간 쿼리 불가.

- versionId당 SQLite `.db` 파일. `links`/`nodes` 테이블(속성·geometry JSON) + **RTree 가상 테이블**(bbox 인덱스).
  ```sql
  CREATE VIRTUAL TABLE link_rtree USING rtree(id, minX, maxX, minY, maxY);
  -- 조회: SELECT l.* FROM links l JOIN link_rtree r ON l.id=r.id
  --        WHERE r.maxX>=? AND r.minX<=? AND r.maxY>=? AND r.minY<=? AND l.road_class<=?
  ```
- `road_class`(고속/간선/집산/국지) 컬럼 → data-level LOD 필터 근거.
- import 시: network.xml → 파싱 → SQLite upsert(versionId 단위). 기존 SFTP XML은 export/백업/시뮬레이터 호환용으로 유지.
- 장점: PostGIS 같은 별도 서버 불필요(이미 `sqlite-jdbc` 보유), 파일 단위라 versionId 모델과 자연스러움.
- 약점: 동시 쓰기 약함 → 네트워크 편집은 저동시성이라 무방.

## 4. 전송 포맷: LOD별 하이브리드

MVT는 만능이 아니다. 이 프로젝트 특수성(편집 가능 + 차선/셀을 client가 생성 + Cesium primitive)과의 충돌을 고려해 **경로를 둘로 나눈다**:

| 경로 | 포맷 | 이유 |
|---|---|---|
| **2D overview/mid (읽기)** | **MVT/PBF** | 간선 중심선·노드. PBF 압축 + OL 네이티브(`ol/format/MVT`) 워커 디코딩. 전국 조망의 정답 |
| **near/detail (차선·셀)** | **JSON 도메인** | `lanes/cells/segments`는 client가 `link.coordinates+width+lanes`로 생성 → MVT에 구우면 타일 폭증, 안 구우면 무의미 |
| **편집** | **JSON 도메인** | MVT는 손실 포맷(좌표 4096 양자화·경계 클리핑·ID 불안정) → GUID/store/`updateCurrentJsonData`와 불일치 |
| **Cesium 3D** | **JSON 도메인** | Cesium은 primitive/entity 기반, MVT 네이티브 렌더 X |

- SQLite엔 PostGIS `ST_AsMVT`가 없음 → **Java에서 MVT 인코딩**(예: `no.ecc.vectortiles`) 필요. 커스텀이지만 한정적 작업.
- **두 경로 모두 같은 SQLite+RTree 저장소**에서 나옴. MVT는 그 위 인코딩 레이어일 뿐.

### API 스펙
```
GET /network/{versionId}/tiles.mvt?z={z}&x={x}&y={y}&lod=overview|mid   # MVT, 2D 읽기
GET /network/{versionId}/tiles?bbox={w},{s},{e},{n}&lod=near|detail     # JSON, 편집/근거리/Cesium
```
- JSON 응답은 기존 `NetworkResponse` 스키마(bbox 교차분만). `__guid`/`featureType` 규칙 유지.
- MVT/JSON 모두 LOD별 road_class 필터 + geometry 단순화(z 기반 Douglas-Peucker).

| lod | 포함 | road_class | geometry |
|---|---|---|---|
| overview | 간선 중심선 | 고속/간선 | 강한 단순화 |
| mid | + 집산, 링크 폴리곤·노드 | ~집산 | 중간 단순화 |
| near | + 국지, 커넥션·포트 | 전체 | 원형 |
| detail | + 차선·셀·세그먼트 | 전체 | 원형 + 차선 |

## 5. 프론트엔드 타일 매니저

`NetworkFeatureLayer`/`NetworkDataSourceLayer`의 "전체 originData" 전제를 **타일 캐시**로 교체.

```
NetworkTileManager
├── 현재 viewport+버퍼 → 필요한 타일 키 집합 계산 (z/lod 기반 격자)
├── moveend(정착) 시:
│     toFetch = 필요타일 - 보유타일   → 서버 fetch → 빌드 → 캐시
│     toEvict = 보유타일 - (필요+LRU여유)  → 피처/프리미티브 destroy + 캐시 제거
├── 타일별 { links[], nodes[], builtFeatures } 보유 (LRU)
└── tier 변경 시: 현 타일들만 재빌드 (전체 N 아님 → O(viewport))
```

- 기존 extent 게이팅의 `reconcile`을 **"타일 멤버십"** 으로 승격: 화면분만 source에 올리던 것 → **타일째 메모리 적재/파괴**. reconcile O(N) → O(보유 타일).
- 버퍼: viewport 주변 1링 선읽기(팬 끊김 방지). LRU N타일 유지(되돌아갈 때 재fetch 절약).
- 2D overview/mid는 OL `VectorTile`(MVT)로, near/detail·Cesium은 JSON→기존 빌더로. 같은 타일 키 공유.

### 5.1 레이어 가시성 규칙 (featureType on/off)

타일 재빌드가 상시 일어나므로 **가시성은 피처 인스턴스 상태가 아니라 렌더/픽 시점 게이트**로 적용한다.

- 상태 보관: `utils/networkPrimitiveShared.ts` 의 `networkPickVisibility`(layer + featureType별) — 2D/3D 공용 단일 출처.
- 렌더 게이트: `NetworkFeatureLayer.styleFunction` / `NetworkMvtLayer.styleFunction` 이 `isNetworkFeatureTypeVisible(featureType)` 로 숨김이면 빈 스타일을 반환.
- 픽 게이트: `pickNetwork2DAt`/`pickNetworkMvtAt`(2D), `pickNetworkAtPosition`/`pickLaneAtPosition`(3D)이 같은 함수를 확인.
- ❌ 금지: `feature.setStyle(new Style({}))` 로 현재 피처만 숨기는 방식 — `addTilePayload`/`fullBuild`/`reconcile` 이 만든 **새 피처에는 적용되지 않아** 줌/팬 시 숨긴 객체가 다시 드러난다.
- 최종 렌더/픽 조건은 2D·3D 모두 `레이어 visible && featureType visible` 의 AND.

## 6. 편집/저장 모델 — 기능별 충돌 분석 (코드 기준)

선택/수정/삭제/추가는 모두 **"`currentJsonData`에 들어있는 것"** 을 대상으로 동작한다. `currentJsonData`가 전체든 타일 일부든 **로직 자체는 그대로 돌아간다.**

| 기능 | 동작 방식 (현 코드) | 타일링 충돌 |
|---|---|---|
| 선택(편집모드) | `useNetworkSelect`: store(`currentJsonData.links.find`) 히트테스트 | ❌ 없음 — 로드 타일 내 객체만. 편집은 줌인(near/detail)이라 화면=로드영역 |
| 선택(일반) | `defaultEventHandler`: `forEachFeatureAtPixel`+`__guid` (픽셀) | ❌ 없음 — 그려진 것만 대상 → 로드분과 자동 일치 |
| 수정 | `updateCurrentJsonData`: 전체 `structuredClone` | △ 로직 OK, clone 대상이 "로드 타일"로 한정될 뿐 |
| 삭제 | `removeRecordsByGuid`: 전체 `deepRemove` | △ 동일 |
| 추가(그리기) | links/nodes 배열 append | △ 동일, 신규 객체의 타일 소속 표시 필요 |

### ⚠️ 유일하면서 치명적인 충돌: 전체 덮어쓰기 저장
`POST /network/{versionId}`가 `currentJsonData` 전체를 network.xml로 통째 덮어쓴다(`NetworkController` 131~134줄).
→ `currentJsonData`가 **로드된 타일 일부**인데 이 저장이 돌면 **로드 안 된 나머지 전국이 빈 파일로 소실**된다.

## 7. 단계적 도입 (위험 최소화)

| 단계 | 내용 | 편집 | 충돌 |
|---|---|---|---|
| 0 | 현행 유지 (소규모) | 전체 로드 | 없음 (`TILING.ENABLED=false`) |
| 1 | SQLite+RTree 적재 + bbox 읽기 API (JSON) | — | 기존 `/network/{id}` 병존 |
| 2 | 프론트 `NetworkTileManager` (읽기 전용) | — | 뷰 전용 |
| 3 | MVT(overview/mid) + data-level LOD(road_class) | — | — |
| **4** | **diff 저장 모델 (부분 편집)** | 타일 단위 | 저장 전환 필요 |

### 핵심 전략: 단계 1~3은 **편집을 기존 전체-로드 경로에 그대로 둔다**
- 타일링/MVT는 **읽기·조망 경로에만** 적용.
- 편집 모드 진입 시엔 기존처럼 시나리오 전체 네트워크 로드 → 선택/수정/삭제/추가/저장 **현재 그대로, 0 충돌**.
- 결과: **"전국 조망 + 광역권 편집"** 이 충돌 없이 바로 가능. (편집 가능 규모 = 현재 천장 ~대도시)

### 단계 4 (전국 편집이 실제로 필요해질 때, 별도 마일스톤)
- `currentJsonData` = 로드 타일 집합. 편집 시 해당 타일 `dirty` 표시 + evict 금지(핀 고정).
- 저장: **전체 덮어쓰기 → 변경분 diff upsert**. 다행히 `updateCurrentJsonData`/`removeRecordsByGuid`가 이미 `historyStore`에 변경 로그를 남기고, 저장 API도 `request.getLogs()`를 받음 → diff 저장의 토대 존재.
- 타일 경계 편집: 경계 걸친 링크/노드는 인접 타일 동기화 + evict 핀 고정.

## 8. 정책 상수 (lodConstants 확장 예정)

```ts
NETWORK_TILING = {
  ENABLED: false,            // 단계적 활성화 스위치
  TILE_DEG: 0.05,            // 타일 격자 크기(도) ≈ 5km, z에 따라 가변 가능
  PREFETCH_RING: 1,          // viewport 주변 선읽기 링 수
  LRU_MAX_TILES: 64,         // 메모리 보유 최대 타일 수
  EDIT_PIN_ADJACENT: true,   // 편집 중 인접 타일 evict 금지 (단계 4)
}
```

## 9. 성능 기대치

| 지표 | 현재 | 타일링 후 |
|---|---|---|
| 메모리 | O(전체 링크) → 200k서 OOM | **O(보유 타일) ≈ 일정** |
| 초기 로드 | 전체 fetch/파싱 (전국=GB) | viewport 타일만 (수십 KB~MB) |
| tier 변경 | O(전체 N) 스캔 | **O(보유 타일)** |
| 전국 조망 | ❌ | ✅ (MVT) |
| 광역권 편집 | ✅ | ✅ (전체-로드 경로 유지) |
| 전국 편집 | ❌ | ✅ 단계 4(diff 저장) 이후 |

---

### 다음 액션
- 백엔드: SQLite+RTree 스키마 + `GET /tiles`(JSON) → `GET /tiles.mvt`(MVT) (단계 1→3)
- 프론트: `NetworkTileManager` PoC, extent 게이팅을 타일 멤버십으로 승격 (단계 2)
- 정책: 목표 운영 규모 확정(광역권 상시 / 전국 가끔?) → LRU·prefetch·TILE_DEG 튜닝
- ⚠️ 단계 4(diff 저장) 착수 전까지 **편집은 전체-로드 경로 고정** — 부분 로드 상태에서 전체 저장 절대 금지
