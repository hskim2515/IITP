# 표준 벡터타일 재설계 로드맵 (2D MVT 통일 + 3D Tiles)

> 배경: 현재 "고정 0.025도(2.5km) 커스텀 격자 타일"은 **줌 레벨과 무관하게 같은 크기 타일**을
> 받아, 줌인해도 데이터가 안 줄어드는 근본 결함. 부분 최적화(ring=0, 타일축소, 차선제거,
> 노드 rAF 분산)를 8회 시도했으나 한계. 표준 방식으로 재설계.
>
> 핵심: **2D = 표준 z/x/y MVT 슬리피 타일로 통일, 3D = 3D Tiles(glTF)**.
> 각 지도 엔진의 네이티브 벡터타일 방식을 쓴다.

## 1. 현재 상태 진단 (무엇이 이미 표준인가)

| 구성 | 상태 |
|---|---|
| 2D MVT (overview/mid) | ✅ **이미 표준** — `NetworkMvtLayer`가 `createXYZ` + `tileUrlFunction` z/x/y, 백엔드 `queryMvt(z,x,y)` |
| 2D near/detail | ❌ **커스텀 JSON 타일**(`NetworkTileManager`, 고정 2.5km) — 줌인 시 MVT 버리고 전환 = 느림 주범 |
| 3D 전체 | ❌ **커스텀 청크**(`NetworkDataSourceLayer` ~1000줄, 수동 LOD/evict/노드빌드) |
| MvtEncoder | LineString/Point만. **폴리곤 미지원** (차선/도로폭 폴리곤 인코딩 불가) |
| queryMvt | **링크 중심선만** 인코딩 (차선·노드·도로 폴리곤 없음) |

## 2. 목표 아키텍처

```
2D OpenLayers:  전 줌 레벨 MVT (z/x/y 슬리피 타일)
  - z 낮음(멀리): 간선 중심선
  - z 높음(가까이): 링크 폴리곤 + 차선 + 노드/커넥션
  - 커스텀 JSON 타일(NetworkTileManager) 제거

3D Cesium:  3D Tiles (glTF)
  - Cesium 네이티브 LOD/컬링/메모리 → 커스텀 청크(NetworkDataSourceLayer 타일부분) 제거
  - 별도 설계: docs/network-3dtiles-design.md
```

## 3. 단계별 로드맵

### Phase A — 2D MVT 전 줌 통일 (먼저, 가치/위험 균형 최선)
**왜 먼저**: 2D는 이미 MVT 인프라 절반 존재. 확장이 명확하고, 2D 줌/팬 느림을 근본 해결.

| 단계 | 내용 |
|---|---|
| A1 | `MvtEncoder`에 **Polygon 지원 추가** (현재 LineString/Point만) |
| A2 | `queryMvt`를 z별 디테일 확장: z↑면 링크 폴리곤·차선·노드까지 인코딩 (lod 세분) |
| A3 | `NetworkMvtLayer` z 매핑 확장: detail까지 MVT, `MVT_MAX_RESOLUTION` 게이트 제거 |
| A4 | **2D 커스텀 JSON 타일 제거**: `NetworkFeatureLayer`의 `NetworkTileManager`/`scheduleStoreSync`/refcount 경로 삭제. 단 의존 레이어(신호/정류장)가 currentJsonData 참조 → 대체 필요(아래 6번) |
| A5 | 2D 편집: MVT는 읽기 전용 → 편집은 별도 경로(현 vector 레이어 또는 bbox JSON) |

### Phase B — 3D Tiles (별도, 큰 작업)
`docs/network-3dtiles-design.md` 참조. glTF 인코더(신규 의존성) + 변환 파이프라인.
PoC(작은 영역 → glTF → Cesium3DTileset 성능 검증)부터.

### Phase C — 정리
커스텀 청크/타일 매니저 코드 제거, 신호/차량 타일링도 표준 방식 재검토.

## 4. ⚠️ 가장 큰 난관 — 의존 레이어의 currentJsonData 의존

신호·버스·철도·히트맵 등 **9개 레이어가 네트워크 `currentJsonData`에서 링크 좌표를 가져옴**.
- 현재 타일 모드: `scheduleStoreSync`가 viewport 네트워크를 store에 동기화해 이들을 먹임
- **MVT로 가면 store에 네트워크 JSON이 없음** → 이 9개가 깨짐

해결 옵션:
1. 신호/정류장도 각자 MVT/타일 (네트워크 의존 끊기) — 큰 작업
2. 네트워크 링크 좌표를 별도 경량 store에 viewport만 유지 (현 scheduleStoreSync 유지)
3. 의존 레이어가 MVT 타일에서 직접 좌표 추출

→ **옵션 2(경량 store 유지)가 현실적**. MVT는 렌더만, 좌표 참조용 viewport store는 별도 유지.

## 5. 편집은 어떻게? (벡터타일은 읽기 전용)

MVT/3D Tiles 모두 **읽기 전용**(타일은 정적, 좌표 양자화/클리핑).
- 조망/탐색: 벡터타일
- 편집: 현 vector primitive 경로 유지 (near/detail에서 편집 시 bbox JSON 로드)
- 저장: diff (이미 구현됨, 4-1/4-2)

→ "읽기=타일, 편집=기존" 분리는 이미 타일링 설계의 철학과 동일.

## 6. 권장 착수 순서

1. **Phase A (2D MVT 통일)** 부터 — 2D 줌/팬 근본 해결, 인프라 절반 존재, 위험 중간
   - A1(폴리곤 인코더) → A2(z별 디테일) → A3(z 확장) 까지가 핵심. 측정으로 검증하며.
2. **PoC로 검증**: detail까지 MVT로 했을 때 2D 줌/팬이 실제로 부드러운가
3. 검증되면 **Phase B (3D Tiles)** — 더 큰 작업, glTF 인코더
4. 의존 레이어(4번)·편집(5번) 분리는 각 Phase에서 함께

## 7. 버려질 코드 (재설계 완료 시)

- `NetworkTileManager` (2D 커스텀 JSON 타일) — A4
- `NetworkDataSourceLayer`의 타일 청크 관리 (addTileChunk/removeTileChunk/applyVisibility debounce/노드 rAF) — Phase B
- `scheduleStoreSync` refcount 등 — 의존 레이어 대체 후

→ 이번 세션에 손으로 짠 청크/타일 최적화 상당수가 **표준 방식으로 대체되며 삭제**됨.
부분 최적화의 한계를 인정하고 표준으로 전환하는 것이 이 로드맵의 본질.
