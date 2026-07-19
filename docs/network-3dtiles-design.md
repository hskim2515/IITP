# 도로 네트워크 3D Tiles 설계 (3D 줌/팬 성능 근본 해결)

> 목적: 현재 3D(Cesium) 네트워크가 커스텀 청크 관리(수동 LOD/evict/노드빌드 분산)로
> 줌/팬이 느린 문제를, **3D Tiles로 전환해 Cesium 네이티브 LOD·컬링·메모리 관리에 위임**.
>
> 배경: Cesium은 벡터타일(.pbf)을 네이티브로 못 받음(`UrlTemplateImageryProvider`는 래스터 전용).
> 3D 벡터 데이터의 Cesium 정공법은 **3D Tiles**(glTF 기반).

## 1. 핵심 결정: 사전 변환 (요청 시 실시간 아님)

| 방식 | 평가 |
|---|---|
| import 시 1회 변환 (채택) | 네트워크는 편집 저장 시에만 변함 → 그때 변환. glTF 인코딩 비용을 import에 흡수 |
| 요청 시 실시간 glTF 생성 | 타일 요청마다 메시 인코딩 CPU 비용 → 부적합 |

> 네트워크가 정적인 동안 Cesium이 자동 LOD/컬링 → 지금 손으로 짠 청크 코드(applyVisibility
> debounce, 노드빌드 rAF 분산, evict refcount 등)가 **통째로 불필요**해진다.

## 2. 현재 자산 / 빠진 것

**있음**:
- 백엔드 `ThreedTilesetController`/`Service` (단 **URL 기반 외부 타일셋 등록**용 — 건물 등)
- `LocalFileController`가 `.glb/.gltf` 서빙 (`model/gltf-binary`)
- 프론트 `Cesium3DTileset.fromUrl(...)` 사용 경험 (useMapInit, 주석 상태)
- 도로 지오메트리: `NetworkDataSourceLayer`가 CorridorGeometry로 도로/차선 폴리곤 생성 중 (로직 참고)

**빠짐**:
- Java glTF 인코더 (의존성 없음) → 신규: `de.javagl:jgltf-model` 등
- 도로 → glTF 메시 변환 (코리도 삼각분할)
- 3D Tiles 타일링 (공간 분할 + `tileset.json` 계층 + LOD)
- import 시 변환 파이프라인

## 3. 변환 파이프라인 (백엔드, import 시)

```
network.xml
  → 링크/노드 파싱 (기존 파서 재사용)
  → 도로별 메시 생성:
       링크 → CorridorGeometry(좌표+폭) → 삼각분할 → 정점/인덱스 버퍼
       차선/노드 → 동일 (LOD 레벨별로 포함 여부 결정)
  → 공간 분할 (격자/쿼드트리) → 타일별 glTF(.glb) 인코딩
  → tileset.json (계층 트리 + geometricError로 LOD)
  → SFTP/로컬 저장: {versionId}/3dtiles/tileset.json + *.glb
```

### LOD 매핑 (geometricError)
3D Tiles는 `geometricError`(화면 픽셀 오차 임계값)로 LOD 자동 전환:
| 타일 레벨 | 내용 | geometricError |
|---|---|---|
| 루트(원거리) | 간선 중심선 (단순) | 큰 값 |
| 중간 | 링크 폴리곤 + 노드 | 중간 |
| 리프(근접) | + 차선/셀/세그먼트 | 0 근처 |

→ 현재 tier(overview/mid/near/detail)를 3D Tiles 레벨로 1:1 매핑.

## 4. 프론트 (대폭 단순화)

```ts
// 기존: NetworkDataSourceLayer 커스텀 청크 ~1000줄 (청크 빌드/evict/applyVisibility/노드 rAF...)
// 3D Tiles 후:
const tileset = await Cesium.Cesium3DTileset.fromUrl(`${base}/network/${versionId}/3dtiles/tileset.json`);
viewer.scene.primitives.add(tileset);
tileset.maximumScreenSpaceError = 16; // LOD 품질/성능 조절
```

- Cesium이 카메라 거리 LOD·frustum culling·메모리 evict **자동**.
- 줌/팬 끊김 근본 해결 (엔진 최적화). 노드빌드 분산/applyVisibility debounce 등 **삭제**.
- 선택/피킹: 3D Tiles feature picking + batchTable에 링크 id 넣어 GUID 매핑.

## 5. ⚠️ 편집과의 분리 (가장 중요)

3D Tiles는 **정적**이다 — 도로 1개 수정해도 타일 재생성 필요.

| 모드 | 3D 네트워크 |
|---|---|
| 조망/탐색 (읽기) | 3D Tiles (Cesium 네이티브, 빠름) |
| 편집 | 기존 primitive 직접 갱신 (현 NetworkDataSourceLayer 유지) |

→ 타일링 설계의 "읽기 전용" 철학과 동일. **3D Tiles는 읽기 경로만 대체**, 편집은 기존 유지.
편집 저장 시 3D Tiles 재변환(import 파이프라인 재사용) + 캐시 무효화.

## 6. 2D는?

2D(OpenLayers)는 **이미 MVT 벡터타일**(`NetworkMvtLayer` + `ol/format/MVT`)로 표준 방식 구현됨.
3D Tiles는 **3D만** 대체. 2D는 MVT 유지 (각 지도의 네이티브 벡터타일 방식 사용).

| 지도 | 벡터타일 방식 |
|---|---|
| 2D OpenLayers | MVT (.pbf) — `ol/source/VectorTile` ✅ 구현됨 |
| 3D Cesium | 3D Tiles (.glb) — `Cesium3DTileset` ⬜ 이 문서 |

## 7. 단계적 도입

| 단계 | 내용 | 위험 |
|---|---|---|
| 0 | PoC: 작은 영역 도로 → glTF 수동 변환 → Cesium3DTileset 로드, 성능/품질 검증 | 낮음 |
| 1 | 백엔드 glTF 인코더 (단일 LOD, 도로 폴리곤만) | 중 (신규 의존성) |
| 2 | 공간 타일링 + tileset.json + LOD 레벨 | 중 |
| 3 | import 변환 파이프라인 + 프론트 Cesium3DTileset 연결 (읽기 전용) | 중 |
| 4 | 편집 분리 (편집=기존 primitive, 저장 시 재변환) | 중 |
| 5 | 차선/셀 LOD 레벨 + feature picking(GUID) | 중 |

## 8. 미결 질문 (착수 전)

- Java glTF 라이브러리: `jgltf` vs 직접 glTF JSON+bin 작성? (의존성 vs 자체)
- 변환 시점: import 동기(저장 지연) vs 비동기 백그라운드(vehicle-route처럼 202 폴링)?
- 좌표계: glTF는 로컬 ENU + tileset transform. 변환 정확도 검증 필요.
- 편집 후 재변환 비용: 전국 규모면 전체 재변환은 큼 → 변경 타일만 재생성?
- **우선 PoC(단계 0)로 "Cesium3DTileset이 정말 빠른가 + 도로가 제대로 보이나" 검증 후 본격 착수 권장.**

## 9. 기대 효과

| 지표 | 현재(커스텀 청크) | 3D Tiles |
|---|---|---|
| 3D 줌/팬 | 수동 최적화 한계, 끊김 | **Cesium 네이티브 (최상)** |
| 프론트 코드 | NetworkDataSourceLayer ~1000줄 청크 관리 | `fromUrl` 몇 줄 + 편집 경로만 |
| LOD/컬링/메모리 | 수동 | **엔진 자동** |
| 편집 | 그대로 | 분리 (읽기만 3D Tiles) |
