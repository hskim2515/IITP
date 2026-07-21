/**
 * OL / Cesium 이중 지도 공통 LOD 임계값
 *
 * OL resolution(m/px, EPSG:3857) ↔ Cesium 카메라 고도(m) 대응 (1200px 뷰포트, FOV 60° 기준)
 *   altitude_m ≈ resolution_m_per_px × 1040
 *   resolution_m_per_px ≈ altitude_m / 1040
 *
 * OL 줌 레벨 참고:
 *   zoom 13 ≈ 19 m/px  |  zoom 14 ≈ 10 m/px  |  zoom 15 ≈ 4.8 m/px
 *   zoom 16 ≈ 2.4 m/px |  zoom 17 ≈ 1.2 m/px  |  zoom 18 ≈ 0.6 m/px
 */

/** Cesium 카메라 고도 기반 LOD 임계값 (m) */
export const LOD_ALT = {
    /** 3D 시설물 디테일(기둥·지붕·플랫폼 등) 표시 최대 고도  ↔ OL ~0.4 m/px */
    FACILITY_DETAIL:      400,
    /** 시설물 라벨 표시 최대 고도                            ↔ OL ~0.12 m/px */
    FACILITY_LABEL:       120,
    /** 시설물 아이콘(빌보드) 표시 최대 고도                  ↔ OL ~10 m/px */
    FACILITY_ICON:       10000,
    /** 네트워크 표출 시작 고도(near 진입). 낮출수록 더 가까이서만 표시 → 메모리 구간 축소 ↔ OL ~1.5 m/px */
    NETWORK_LINK_ONLY:   1500,
    /** 네트워크: 외곽선만 표시하는 고도                      ↔ OL ~10 m/px */
    NETWORK_OUTLINE_ONLY: 10000,
    /** 신호: 빌보드 표시 최대 고도                          ↔ OL ~1.2 m/px */
    SIGNAL_BILLBOARD:    1200,
    /** 신호: 컬러 dot 표시 최대 고도                        ↔ OL ~4 m/px */
    SIGNAL_DOT:          4000,
} as const;

/** OL 해상도 기반 LOD 임계값 (m/px, EPSG:3857) */
export const LOD_RES = {
    /** 시설물 전체 마커(+ 주차선 등) 표시                   ↔ Cesium ~400m */
    FACILITY_FULL:          0.4,
    /** 시설물 기본 마커 표시                                ↔ Cesium ~4000m */
    FACILITY_MARKER:        4.0,
    /** 시설물 숨김 (매우 원거리)                            ↔ Cesium ~10400m */
    FACILITY_HIDDEN:       10.0,
    /** 네트워크: 레인/셀/세그먼트 등 차선 디테일 표시 (완전 근접) ↔ Cesium ~310m */
    NETWORK_LANE_DETAIL:    0.3,
    /** 네트워크 표출 시작 해상도(near 진입). 낮출수록 더 가까이서만 표시 → 메모리 구간 축소 ↔ Cesium ~1500m */
    NETWORK_LINK_ONLY:      1.5,
    /** 네트워크: 외곽선만                                   ↔ Cesium ~8000m */
    NETWORK_OUTLINE_ONLY:   8,
    /** 네트워크: 광역 조망 — 고속도로 골격만 (macro)         ↔ Cesium ~26km+ */
    NETWORK_MACRO:         25,
    /** 신호: 전체 아이콘 표시                               ↔ Cesium ~1300m */
    SIGNAL_ICON:            1.3,
    /** 신호: 단순 dot 표시                                  ↔ Cesium ~4200m */
    SIGNAL_DOT:             4.0,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 네트워크 LOD 단계 (Tier) — 2D(resolution)·3D(altitude)·향후 extent 게이팅이
// 동일한 경계를 공유하도록 하는 단일 진입점.
//
// 단계가 올라갈수록(overview → detail) 더 가까이 확대된 상태이며 더 많은 디테일을 표시한다.
//   overview : 도시 전체 조망. 링크 중심선만 (간선 위주로 보일 정도)
//   mid      : 구역 단위. 링크 폴리곤 + 노드
//   near     : 교차로 단위. + 커넥션, 포트(정지선)
//   detail   : 차선 단위. + 레인/셀/세그먼트 (완전 근접)
// ───────────────────────────────────────────────────────────────────────────

export type NetworkLodTier = 'overview' | 'mid' | 'near' | 'detail';

/** tier 순서 인덱스 (작을수록 원거리/저디테일) */
export const NETWORK_LOD_TIER_ORDER: Record<NetworkLodTier, number> = {
    overview: 0,
    mid:      1,
    near:     2,
    detail:   3,
};

/** tier 순서 인덱스 → tier 이름 (NETWORK_LOD_TIER_ORDER 의 역방향 — 타일 강제 승격 요청 시 사용) */
export const NETWORK_LOD_TIER_BY_ORDER: NetworkLodTier[] = ['overview', 'mid', 'near', 'detail'];

/**
 * featureType이 처음 나타나는 최소 tier 인덱스.
 * 현재 tier 인덱스가 이 값 이상이면 해당 featureType을 표시한다.
 */
const NETWORK_FEATURE_MIN_TIER: Record<string, number> = {
    'link-edit':    NETWORK_LOD_TIER_ORDER.overview, // 0 — 항상 표시 (중심선)
    'links':        NETWORK_LOD_TIER_ORDER.mid,      // 1
    'nodes':        NETWORK_LOD_TIER_ORDER.mid,      // 1
    'connections':  NETWORK_LOD_TIER_ORDER.near,     // 2
    'ports':        NETWORK_LOD_TIER_ORDER.near,     // 2
    'lanes':        NETWORK_LOD_TIER_ORDER.detail,   // 3
    'lane-edit':    NETWORK_LOD_TIER_ORDER.detail,   // 3
    'cells':        NETWORK_LOD_TIER_ORDER.detail,   // 3
    'segments':     NETWORK_LOD_TIER_ORDER.detail,   // 3
};

/** OL resolution(m/px) → 네트워크 LOD tier */
export function getNetworkLodTierByResolution(resolution: number): NetworkLodTier {
    if (resolution > LOD_RES.NETWORK_OUTLINE_ONLY) return 'overview';
    if (resolution > LOD_RES.NETWORK_LINK_ONLY)    return 'mid';
    if (resolution > LOD_RES.NETWORK_LANE_DETAIL)  return 'near';
    return 'detail';
}

/**
 * Cesium 카메라 고도(m) → 네트워크 LOD tier.
 * 고도를 ×1040 규칙으로 해상도(m/px)로 환산해 2D와 **동일한 경계**를 쓴다.
 * (실제 3D 타일/엔티티 게이팅은 화면 중앙 지면거리 기반 pixelSize 를 쓰므로
 *  이 함수는 근사치 — 디버그 표시(PerformancePanel) 등 참고용)
 */
export function getNetworkLodTierByAltitude(altitude: number): NetworkLodTier {
    return getNetworkLodTierByResolution(altitude / 1040);
}

/**
 * 화면이 실제로 덮는 지표 영역의 폭(m) → 네트워크 LOD tier.
 * 카메라 고도가 아니라 "얼마나 넓은 영역을 보는가"로 판단 → 고도가 낮아도 비스듬히 멀리 보면
 * 영역이 넓어 표출 안 함(메모리 보호). 저각/조감 모두에서 viewport 규모와 일치.
 *
 * 임계 폭(m) = 화면 가로 픽셀 추정 × 해상도 임계값(m/px). 1200px 기준으로 LOD_RES 환산.
 */
const VIEW_PX = 1200; // 기준 가로 픽셀 (해상도 임계값 → 영역 폭 환산용)
export function getNetworkLodTierByViewWidth(widthMeters: number): NetworkLodTier {
    const mPerPx = widthMeters / VIEW_PX;
    return getNetworkLodTierByResolution(mPerPx);
}

/** 주어진 tier에서 해당 featureType을 그려야 하는가 */
export function isNetworkFeatureVisibleAtTier(featureType: string, tier: NetworkLodTier): boolean {
    const minTier = NETWORK_FEATURE_MIN_TIER[featureType];
    if (minTier === undefined) return true; // 미분류 타입은 보수적으로 표시
    return NETWORK_LOD_TIER_ORDER[tier] >= minTier;
}

/**
 * Extent 게이팅 설정.
 * 화면(+버퍼) 안에 있고 현재 tier에서 보이는 featureType만 OL source에 올린다.
 * 도시 전체 규모에서 source 크기를 viewport 규모로 묶어 순회/렌더/hit-detection 비용을 제한.
 */
export const NETWORK_EXTENT_GATING = {
    /** 게이팅 활성화 여부 (문제 시 즉시 비활성화 가능) */
    ENABLED: true,
    /** 뷰 extent를 폭/높이의 이 비율만큼 확장해 미리 적재 (팬 시 빈 영역 방지) */
    RENDER_BUFFER_RATIO: 0.5,
} as const;

/**
 * 네트워크 BBox 타일링 (단계 2~3) — viewport 단위 서버 fetch + evict 로 메모리를 viewport 규모로 제한.
 * 광역권→전국 대응. ENABLED=false 면 기존 전체-로드 경로가 그대로 동작한다(0 리스크).
 *
 * ⚠️ 단계 4(diff 저장) 전까지 **편집은 전체-로드 경로 고정**. 부분 로드 상태에서 전체 저장 금지.
 * 자세한 설계: docs/network-bbox-tiling-design.md
 */
export const NETWORK_TILING = {
    /** 타일링 활성화 (기본 off — 단계적 도입) */
    // 상시 타일 모드 — 전체-로드(수십~수백MB 다운로드+파싱) 경로를 항상 우회.
    // 시나리오 규모와 무관하게 viewport 타일 + extent flyTo 로 동작한다.
    ENABLED: true,
    /** 타일 격자 크기(도) ≈ 2.5km. 고밀도 도시 detail 타일이 5km면 ~6.8MB/3천링크라 커서 축소.
     *  (CHUNK_DEG가 이 값을 참조 → Cesium 청크도 함께 작아짐) */
    TILE_DEG: 0.025,
    /** viewport 주변 선읽기 링 수 (팬 끊김 방지) */
    PREFETCH_RING: 1,
    /** 메모리 보유 최대 타일 수 (LRU; 되돌아가기 캐시).
     *  detail 타일은 파싱된 JSON(cachedNode/LinkMap)+프리미티브로 개당 수 MB —
     *  64개면 힙 수백 MB까지 커져 32로 축소 (32타일 ≈ 200km² 커버, 재방문은 refetch) */
    LRU_MAX_TILES: 32,
    /**
     * MVT(PBF) 레이어 활성화 (단계 3) — overview/mid 2D 를 OL VectorTile 로 가속.
     * ON 이면 NetworkFeatureLayer 는 overview/mid 에서 링크 중심선 렌더를 MVT 에 양보한다.
     */
    MVT_ENABLED: false,
    /** MVT 가 담당하는 최대 OL resolution (이보다 가까우면 = near/detail → 기존 벡터 레이어) */
    MVT_MAX_RESOLUTION: LOD_RES.NETWORK_LINK_ONLY, // = 2 (mid/overview 구간)
    /**
     * JSON 타일 매니저가 동작하는 최소 tier. overview/mid(멀리)에서는 5km 타일이 수천 개가 되어
     * 요청 폭주(ERR_INSUFFICIENT_RESOURCES)하므로, 그 구간은 MVT(슬리피 타일 자동 관리)에 맡기고
     * JSON 타일은 near 이상(확대 — 화면에 소수 타일)에서만 fetch 한다.
     */
    JSON_MIN_TIER: 'near' as NetworkLodTier,
    /** 한 번에 요청 가능한 최대 타일 수 (안전장치 — 초과 시 fetch 전체 skip) */
    MAX_TILES_PER_UPDATE: 36,
    /**
     * 2D 네트워크 도로/차선을 OL 네이티브 MVT(슬리피 타일)로 렌더 (정식). ON 이면:
     *  - 도로/차선/중심선: NetworkMvtLayer(MVT) 담당 (viewport·줌별 LOD 자동, GPU 렌더)
     *  - 노드/커넥션/포트: NetworkFeatureLayer 벡터가 detail 줌에서만 (편집요소, extent 게이팅)
     *  - 커스텀 JSON 타일(NetworkTileManager)·scheduleStoreSync 미사용 (줌인 fps 부하 제거)
     * 의존 레이어(신호/버스/철도)는 currentJsonData 전체 1회 로드로 유지.
     */
    USE_MVT_2D: true,
} as const;

/** resolution(m/px) → 서버 tiles API lod 파라미터 (네트워크 tier와 동일 경계) */
export function networkLodParam(resolution: number): NetworkLodTier {
    return getNetworkLodTierByResolution(resolution);
}

/**
 * 신호 BBox 타일링 (네트워크와 동일 격자/패턴, 별도 플래그).
 * 신호는 네트워크 노드에 종속 → 같은 TILE_DEG 격자. viewport 신호 데이터만 메모리 보유.
 * ⚠️ 신호 feature는 네트워크 링크에서 위치가 파생되므로, 네트워크가 메모리에 있을 때 의미가 있다.
 *   기본 off. 자세한 설계: docs/data-scaling-strategy.md
 */
export const SIGNAL_TILING = {
    /** 신호 타일링 활성화 — 네트워크 타일 모드와 함께 운용 (신호 위치는 네트워크 노드 파생) */
    ENABLED: true,
    /** near tier 이상(확대)에서만 신호 타일 fetch — 멀리선 신호 자체가 dot/숨김이라 불필요 */
    MIN_TIER: 'near' as NetworkLodTier,
} as const;

/**
 * 차량 줌 티어(개별 3D / flow / 히트맵 / OD흐름) 경계값 — pixelSizeM(m/px, computeViewportMetrics
 * 기준) 단일 단위로 통일한 단일 소스. 이전엔 개별 차량은 bbox "도" 단위(MAX_BBOX_DEG), flow/
 * 히트맵은 pixelSizeM 단위로 서로 달라서 경계를 맞추려면 감으로 환산해야 했고, 그 결과 flow
 * 활성 구간이 개별 차량 범위 한참 안쪽에 파묻혀 줌아웃해도 전혀 안 바뀌는 것처럼 보이는 실측
 * 버그가 있었다. VEHICLE_STREAMING(개별 차량)/TRAFFIC_FLOW/VEHICLE_AGGREGATION(히트맵)/
 * OD_FLOW 전부 아래 값만 참조하므로 네 시스템이 어긋날 수 없다 — 임계값 조정은 여기 한 곳에서만.
 *
 * 단계: 개별(<INDIVIDUAL_MAX) → flow([INDIVIDUAL_MAX,FLOW_MAX)) → 히트맵([FLOW_MAX,HEATMAP_MAX))
 * → OD 흐름(≥HEATMAP_MAX, 가장 축소된 overview).
 */
export const VEHICLE_ZOOM_TIER_PX_M = {
    /** 미만: 개별 차량 3D 모델. (실측 후 30→10 하향 — 체감상 전환이 너무 늦었음) */
    INDIVIDUAL_MAX: 10,
    /** 이상 ~ HEATMAP_MAX 미만: 히트맵(집계). flow는 [INDIVIDUAL_MAX, FLOW_MAX) 구간만 담당. (200→60) */
    FLOW_MAX: 60,
    /** 이상: OD 흐름(가장 축소된 overview) — 히트맵은 [FLOW_MAX, HEATMAP_MAX) 구간만 담당. (800→250) */
    HEATMAP_MAX: 250,
} as const;

/**
 * 차량 교통량 백엔드 집계 (멀리서 전체 교통량 — 개별 차량 대신 링크별 통계).
 * ON 이면 TrafficHeatmapFeatureLayer/TrafficHeatmapCesiumLayer가 개별 차량 대신
 * `/analytics/link-traffic` 집계를 호출해 히트맵을 칠한다 (개별 차량 위치 무시).
 */
export const VEHICLE_AGGREGATION = {
    ENABLED: true,
    /** 이 resolution 이상(멀리)에서 집계 모드 활성 — 미만(near)은 개별 차량/flow.
     *  VEHICLE_ZOOM_TIER_PX_M.FLOW_MAX 공유 — flow→히트맵 경계가 끊기지 않는다. */
    MIN_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.FLOW_MAX,
    /** 이 resolution 이상이면 비활성 — OD 흐름(OD_FLOW)으로 전환. */
    MAX_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.HEATMAP_MAX,
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1000,
} as const;

/**
 * 교통 흐름(flow) tail — 개별 차량(3D 모델)과 히트맵 사이의 중간 줌 티어.
 * 새 백엔드 없이 VEHICLE_AGGREGATION과 동일한 `/analytics/link-traffic` 집계(volume/avgSpeed)를
 * 재사용하고, 렌더링만 링크를 따라 흐르는 애니메이션 점선으로 다르게 표현한다(TrafficTailCesiumLayer).
 * 개별 차량 3D 렌더 비용을 감당하기엔 차량이 많지만, 정적 히트맵으로 뭉개기엔 아직 확대된 구간을 담당.
 */
export const TRAFFIC_FLOW = {
    ENABLED: true,
    /** 이 resolution 미만(더 확대)에서는 비활성 — 개별 차량 3D 모델 구간 */
    MIN_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX,
    /** 이 resolution 이상(더 축소)이면 비활성 — 히트맵(VEHICLE_AGGREGATION)으로 전환 */
    MAX_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.FLOW_MAX,
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) — VEHICLE_AGGREGATION과 동일 */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1000,
} as const;

/**
 * OD(origin-destination) 흐름 — 가장 축소된 overview 티어(히트맵보다도 더 멀리서).
 * 새 백엔드 `/analytics/od-flow` 집계(차량별 시간창 내 첫/끝 위치를 격자 스냅해 집계, volume)를
 * 사용 — 개별 차량 데이터가 전혀 필요 없어 아무리 축소해도 비용이 늘지 않는다. 기존 "od"
 * 레이어(개별 차량의 현재위치→목적지를 매초 재계산하는 ParabolicArrowPrimitive, 근거리용)와는
 * 별개의 "odFlow" 레이어로 렌더(OdFlowCesiumLayer) — 같은 ParabolicArrowPrimitive를 그대로
 * 재사용하되 setOdData()에 집계 결과만 주입한다.
 */
export const OD_FLOW = {
    ENABLED: true,
    /** 이 resolution 이상에서만 활성 — 히트맵(VEHICLE_AGGREGATION)과 경계 공유 */
    MIN_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.HEATMAP_MAX,
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1500,
    /** 반환받을 상위 OD 쌍 개수 (volume 내림차순) */
    MAX_PAIRS: 100,
} as const;

/**
 * 차량 궤적 viewport+시간창 스트리밍 (개별 차량 near LOD, 대용량 시나리오 전용).
 * 네트워크 tileMode 시나리오에서 전체 czml(수백MB~GB) 대신
 * POST /vehicle/vehicle-route/{key}/viewport 로 viewport+재생 시간창 분만 로드.
 * 소형 시나리오(tileMode=false)는 기존 전체-로드 경로 유지.
 */
export const VEHICLE_STREAMING = {
    ENABLED: true,
    /** 로드할 시간창 길이 (초) — 현재 재생 시각부터 */
    TIME_WINDOW_SEC: 120,
    /** 시간창 양쪽 버퍼 (초, 보간 연속성 — 서버가 창 확장) */
    BUFFER_SEC: 60,
    /** 재생 시각이 창 끝에서 이 초만큼 남으면 다음 창 prefetch */
    REFETCH_REMAIN_SEC: 30,
    /** 카메라 정착 후 fetch 디바운스 (ms) */
    DEBOUNCE_MS: 800,
    /** 이 pixelSizeM 이상(줌아웃)이면 개별 차량 fetch 생략 — flow/히트맵 담당.
     *  VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX 공유 — 세 줌 티어가 항상 정렬되게 유지. */
    MAX_PIXEL_SIZE_M: VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX,
    /** bbox 한 변 최대 (도) — 실제 fetch 여부는 위 MAX_PIXEL_SIZE_M(pixelSizeM)이 결정하고,
     *  이 값은 그 안에서 요청 bbox 자체가 과도하게 커지지 않도록 절삭하는 안전판 역할만 한다. */
    MAX_BBOX_DEG: 0.15,
    /** bbox 한 변 최소 (도, ≈110m) — 더블클릭 줌 등 카메라 flight 애니메이션 중간 프레임에서
     *  지면까지 거리가 순간적으로 0에 가까워져 bbox가 한 점(w≈e, s≈n)으로 붕괴하는 경우가 있다.
     *  이 상태로 fetch하면 서버가 0대를 반환해 실제 뷰포트 차량이 전부 사라져 보임
     *  ("시간은 가는데 차량이 안 보임"). 이보다 작으면 이상치 프레임으로 보고 fetch를 건너뛴다. */
    MIN_BBOX_DEG: 0.001,
    /** 요청당 차량 상한 (서버 하드캡 10,000). 초과 시 viewport 체류시간 긴 차량 우선 선별 후
     *  집계 히트맵으로 전환. czml 엔티티는 개당 매 프레임 위치 보간 비용 — 1,500대 ≈ 60fps 예산,
     *  3,000대에서 FPS 한 자리 실측. */
    MAX_VEHICLES: 1500,
    /** 밀집(히트맵) 모드 해제 임계 비율 — 진입은 total > MAX, 해제는 total < MAX×이 값.
     *  경계(3,000 부근)에서 팬마다 히트맵↔개별차량이 왕복 진동하는 것 방지 (히스테리시스) */
    DENSE_EXIT_RATIO: 0.8,
    /** 모드 전환 최소 간격 (ms) — 연속 전환으로 인한 레이어 깜빡임 방지 */
    MODE_SWITCH_MIN_MS: 4000,
} as const;

/**
 * 차량 개별 렌더 viewport culling (near — 개별 차량 표시 시).
 * worker는 인덱스 보존(trail[i]↔vehicle[i]) 때문에 전체 차량을 계산하지만,
 * OL VehicleFeatureLayer 는 화면 밖 차량의 feature 좌표 업데이트/렌더를 건너뛴다.
 * GPU instanced 인 Cesium 은 자동 frustum culling 으로 충분해 제외. 기본 off.
 */
export const VEHICLE_CULLING = {
    ENABLED: false,
    /** viewport extent 를 폭/높이의 이 비율만큼 확장 (경계 차량 깜빡임 방지) */
    MARGIN_RATIO: 0.2,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 시설물 LOD 단계 (Tier) — 점 시설물(버스/철도 정류장, 신호 등)의 표현 전환.
// 네트워크 tier와 동일한 사고방식: 단계가 올라갈수록 더 근접·더 상세.
//
//   cluster : 도시 조망. 개체 대신 군집(클러스터) 1개로 집계 표시
//   marker  : 구역 단위. 개별 단순 마커(dot)
//   labeled : 근거리. 마커 + 보조 마커(출구 등) / 라벨
//   detail  : 완전 근접. 전체 디테일(주차선·플랫폼·신호 아이콘 등)
//
// 2D(resolution)·3D(altitude) 모두 같은 단계 의미를 공유한다.
// 기존 LOD_RES/LOD_ALT 임계값에 그대로 매핑하여 동작을 보존한다.
// ───────────────────────────────────────────────────────────────────────────

export type FacilityLodTier = 'cluster' | 'marker' | 'labeled' | 'detail';

/** tier 순서 인덱스 (작을수록 원거리/저디테일) */
export const FACILITY_LOD_TIER_ORDER: Record<FacilityLodTier, number> = {
    cluster: 0,
    marker:  1,
    labeled: 2,
    detail:  3,
};

/** OL resolution(m/px) → 시설물 LOD tier (기존 LOD_RES 임계값 매핑) */
export function getFacilityLodTierByResolution(resolution: number): FacilityLodTier {
    if (resolution > LOD_RES.FACILITY_HIDDEN) return 'cluster';   // > 10 : 원거리 집계
    if (resolution > LOD_RES.FACILITY_MARKER) return 'marker';    // 4~10 : 단순 마커
    if (resolution > LOD_RES.FACILITY_FULL)   return 'labeled';   // 0.4~4: 마커+보조
    return 'detail';                                              // ≤ 0.4: 전체 디테일
}

/** Cesium 카메라 고도(m) → 시설물 LOD tier (기존 LOD_ALT 임계값 매핑) */
export function getFacilityLodTierByAltitude(altitude: number): FacilityLodTier {
    if (altitude > LOD_ALT.FACILITY_ICON)   return 'cluster';     // > 10000 : 아이콘 범위 밖 → 집계
    if (altitude > LOD_ALT.FACILITY_DETAIL) return 'marker';      // 400~10000 : 빌보드 아이콘
    if (altitude > LOD_ALT.FACILITY_LABEL)  return 'labeled';     // 120~400 : 3D 디테일(라벨 전)
    return 'detail';                                             // ≤ 120 : 3D 디테일 + 라벨
}

/** tier가 기준 tier 이상인지 (예: isAtLeastTier(t,'labeled')) */
export function isAtLeastFacilityTier(tier: FacilityLodTier, min: FacilityLodTier): boolean {
    return FACILITY_LOD_TIER_ORDER[tier] >= FACILITY_LOD_TIER_ORDER[min];
}

/**
 * 신호 LOD tier — 신호는 정류장보다 일찍 숨겨지고 dot/icon 2단 표현이라
 * 별도 임계값(SIGNAL_DOT/SIGNAL_ICON)을 쓰지만, 같은 enum으로 표현해 어휘를 통일한다.
 *   cluster : > SIGNAL_DOT(4)         숨김/집계
 *   marker  : SIGNAL_ICON(1.3)~4      컬러 dot
 *   detail  : ≤ SIGNAL_ICON(1.3)      신호등 아이콘 + 방향
 */
export function getSignalLodTierByResolution(resolution: number): FacilityLodTier {
    if (resolution > LOD_RES.SIGNAL_DOT)  return 'cluster';
    if (resolution > LOD_RES.SIGNAL_ICON) return 'marker';
    return 'detail';
}

/**
 * 점 시설물 클러스터링 설정 (overview tier에서 군집 집계).
 * OL은 ol/source/Cluster, Cesium은 격자 집계로 화면당 마커 수를 제한.
 */
export const FACILITY_CLUSTERING = {
    /** 클러스터링 활성화 여부 */
    ENABLED: true,
    /** OL 클러스터 거리(px) — 이 픽셀 반경 내 점들을 1개로 묶음 */
    OL_CLUSTER_DISTANCE_PX: 60,
    /** OL 클러스터 내부 최소 간격(px) */
    OL_CLUSTER_MIN_DISTANCE_PX: 20,
} as const;
