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
 * 버스정류장 BBox 타일링 (신호와 동일 격자/패턴). 정류장은 네트워크 링크에 종속(linkRef) →
 * 같은 TILE_DEG 격자. 서울+경기 등 광역권 규모에서 정류장 수가 네트워크와 비슷한 자릿수로
 * 늘어날 수 있어 신호와 동일하게 미리 대비(2026-07-30 결정). 자세한 설계: docs/data-scaling-strategy.md
 */
export const BUS_STATION_TILING = {
    ENABLED: true,
    MIN_TIER: 'near' as NetworkLodTier,
} as const;

/** 철도정류장 BBox 타일링 — 정류장 자체 좌표(coordinates) 또는 출입구(exit)의 linkRef 기반. */
export const RAIL_STATION_TILING = {
    ENABLED: true,
    MIN_TIER: 'near' as NetworkLodTier,
} as const;

/** 노면표시 BBox 타일링 — 자체 좌표(coordinates)를 가지므로 네트워크 join 없이 바로 인덱싱 가능. */
export const PAVEMENT_MARKING_TILING = {
    ENABLED: true,
    MIN_TIER: 'near' as NetworkLodTier,
} as const;

/**
 * 차량 줌 티어(개별 3D / 집계 기반 heatmap+trip / OD흐름) 경계값 — pixelSizeM(m/px,
 * computeViewportMetrics 기준) 단일 단위로 통일한 단일 소스. 이전엔 개별 차량은 bbox "도"
 * 단위(MAX_BBOX_DEG), 집계 쪽은 pixelSizeM 단위로 서로 달라서 경계를 맞추려면 감으로 환산해야
 * 했고, 그 결과 활성 구간이 개별 차량 범위 한참 안쪽에 파묻혀 줌아웃해도 전혀 안 바뀌는 것처럼
 * 보이는 실측 버그가 있었다. VEHICLE_STREAMING(개별 차량)/VEHICLE_AGG_FEED(heatmap+trip)/
 * OD_FLOW 전부 아래 값만 참조 — 임계값 조정은 여기 한 곳에서만.
 *
 * ⚠️ 이 티어는 **데이터 소스/세밀도 전환 기준이지 레이어 표시 전환 기준이 아니다** — 레이어
 * 표시 여부는 분석 메뉴 온오프(사용자)가 전적으로 소유한다("줌에 따른 레이어 전환보다 사용자
 * 온오프 + 줌은 세밀도만 자동 조절" 방침). 즉:
 * - heatmap/trip: <INDIVIDUAL_MAX에선 실차량 worker feed, ≥INDIVIDUAL_MAX에선
 *   VehicleAggregationFeeder의 집계 기반 합성 위치가 데이터를 공급(상한 없음).
 * - od: <HEATMAP_MAX에선 기존 "od" 레이어(개별 차량 기반, 상세), ≥HEATMAP_MAX에선
 *   "odFlow"(백엔드 집계, 개괄)가 데이터를 가짐 — 둘 다 사용자가 od를 켰을 때만 보임.
 *
 * ⚠️ 한때 "traffic"(TrafficHeatmapCesiumLayer/TrafficHeatmapFeatureLayer, 링크를 선으로
 * 칠하는 렌더러)이 이 구간 + denseViewport(뷰포트 차량 수 초과)에서 별도로 자체 표시되었으나,
 * 이는 사용자가 명시적으로 거부한 "링크 기반" 시각화였다(TrafficTailCesiumLayer와 함께 반려됨).
 * heatmap/trip 구간과 겹쳐 동시에 뜨면서 "히트맵이 링크에 생긴다"는 증상 + 두 show 제어 로직이
 * 서로 경쟁하며 깜빡이는 버그로 이어져 완전히 삭제했다 — VEHICLE_AGG_FEED(아래)가 dense도
 * 함께 흡수해 heatmap/trip 하나로 통일한다.
 */
export const VEHICLE_ZOOM_TIER_PX_M = {
    /** 미만: 개별 차량 3D 모델. (실측 후 30→10 하향 — 체감상 전환이 너무 늦었음) */
    INDIVIDUAL_MAX: 10,
    /** 이상: OD 흐름(가장 축소된 overview) — 그 아래는 heatmap+trip 집계 구간. (800→250) */
    HEATMAP_MAX: 250,
} as const;

/**
 * 개별 차량(3D)이 감당 안 되는 원거리에서, 이미 있는 "heatmap"(HeatBarLayer/HeatmapFeatureLayer,
 * 그리드 밀도)과 "trip"(TailPrimitive, 개별 꼬리 흔적) 분석 레이어를 새 렌더러 없이 계속 살려두는
 * 데이터 공급기(VehicleAggregationFeeder) 설정. `/analytics/link-traffic` 집계(volume/avgSpeed)
 * 로 링크 위를 흐르는 합성 차량 위치를 만들어 두 레이어의 기존 setLatestPositions()에 그대로 먹인다.
 *
 * MIN/MAX_RESOLUTION 구간 밖이어도 useVehicleStore().denseViewport(뷰포트 차량 수가 상한을
 * 초과해 개별 차량 표시를 끈 상태)면 활성 유지 — 예전 "traffic" 레이어가 담당하던 dense 대체
 * 표시를 여기로 흡수(VehicleAggregationFeeder 참고).
 */
export const VEHICLE_AGG_FEED = {
    ENABLED: true,
    /** 이 resolution 미만(더 확대)에서는 비활성 — 실차량 worker feed가 heatmap/trip 데이터를 담당 */
    MIN_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX,
    /** (표시용 참고값 — 피더는 상한 없이 계속 활성. ViewportDebugPanel 표시에만 사용) */
    MAX_RESOLUTION: VEHICLE_ZOOM_TIER_PX_M.HEATMAP_MAX,
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1000,
    /** 합성 차량 전체 상한 (렌더/계산 비용 억제) — TailPrimitive의 고정 trail 슬롯 수와
     *  useSimulation.ts의 초기 addTripLayer() 더미 배열 크기가 반드시 이 값을 공유해야 한다:
     *  TailPrimitive는 생성자에 넘긴 배열 길이만큼만 trail GPU 자원을 미리 할당해서, 그보다
     *  많은 합성 차량 위치를 setLatestPositions()로 먹여도 넘치는 부분은 갈 곳이 없어 버려진다. */
    MAX_SYNTHETIC_VEHICLES: 400,
} as const;

/**
 * OD(origin-destination) 흐름 — 가장 축소된 overview 티어(heatmap+trip 집계보다도 더 멀리서).
 * 새 백엔드 `/analytics/od-flow` 집계(차량별 시간창 내 첫/끝 위치를 격자 스냅해 집계, volume)를
 * 사용 — 개별 차량 데이터가 전혀 필요 없어 아무리 축소해도 비용이 늘지 않는다. 기존 "od"
 * 레이어(개별 차량의 현재위치→목적지를 매초 재계산하는 ParabolicArrowPrimitive, 근거리용)와는
 * 별개의 "odFlow" 레이어로 렌더(OdFlowCesiumLayer) — 같은 ParabolicArrowPrimitive를 그대로
 * 재사용하되 setOdData()에 집계 결과만 주입한다.
 */
/**
 * 행정구역(시도/시군구/읍면동) 교통량 레이어 — 줌(카메라 고도)에 따라 표시 tier를 자동 전환.
 * 행정구역은 네트워크 lane/link처럼 "실제 크기가 고정된" 개체(시군구≈수 km, 읍면동≈1~3km)라
 * VEHICLE_ZOOM_TIER_PX_M(시나리오 크기에 비례 정규화)과 달리 원본(비정규화) pixelSizeM을 쓴다 —
 * NETWORK_LOD_TIER와 동일한 사고방식.
 */
export const ADMIN_REGION_TIER_PX_M = {
    /** 이상: 시도 단위(광역 조망 — 개별 시군구가 화면에서 분간 안 되는 거리) */
    SIDO_MIN: 200,
    /** 이상(SIDO_MIN 미만): 시군구 단위 */
    SIGUNGU_MIN: 20,
    /** 미만: 읍면동 단위(근접) */
} as const;

export type AdminRegionTier = 'sido' | 'sigungu' | 'eupmyeondong';

/** 원본(비정규화) pixelSizeM(m/px) → 행정구역 표시 tier */
export function getAdminRegionTier(pixelSizeM: number): AdminRegionTier {
    if (pixelSizeM >= ADMIN_REGION_TIER_PX_M.SIDO_MIN) return 'sido';
    if (pixelSizeM >= ADMIN_REGION_TIER_PX_M.SIGUNGU_MIN) return 'sigungu';
    return 'eupmyeondong';
}

/**
 * 행정구역 교통량 volume — "지금 이 순간 그 지역에 있는 차량 수"를 반영해야 한다는 지적을
 * 받았다. 시간창을 누적(fromTime=toTime=0)하면 "그 지역을 스쳐간 적 있는 모든 차량"이 합산돼
 * 실제 동시 교통량보다 훨씬 큰(실측: 10분 시뮬 전체 누적 1728대 vs 순간 스냅샷 수십~백여 대)
 * 숫자가 나오고("전체 140대인데 동마다 1000대"), 체류시간 다수결로 차량 1대=지역 1곳을 정해도
 * 여전히 "한동안의" 집계지 "지금"이 아니다. 그래서 백엔드(`/analytics/region-traffic`)는
 * atTime(순간 시각) ± 짧은 반경(5초, countActiveVehicles와 동일 관례)의 스냅샷만 반환한다 —
 * 프론트는 재생 시각이 흐르는 동안 이 값을 계속 재요청해야 실시간으로 보인다.
 */
export const REGION_TRAFFIC = {
    /** 재요청 최소 간격 (ms) — "실시간"으로 느껴지되 재생마다 매 프레임 요청하진 않도록.
     *  기존 활성차량수 배지(fetchActiveCount)의 3000ms와 동일 관례 */
    REFRESH_THROTTLE_MS: 3000,
} as const;

/**
 * "지식그래프" 스타일 분석 레이어 2종(regionOdGraph/congestionAdjacency) 공용 설정.
 * ⚠️ clock 미준비 시 시간창 폴백은 {0,0}("전체 시간 누적"으로 오해석)이 아니라 {0, window*2}
 * 를 써야 한다 — 이번 세션에 region-traffic/link-metric/od-flow에서 반복 발견한 함정
 * (VehicleAggregationFeeder.timeWindow, LinkMetricPolylineLayer._timeWindow,
 * OdFlowCesiumLayer._timeWindow 전부 이 관례로 통일함) — 새 레이어도 처음부터 지킨다.
 */
export const KNOWLEDGE_GRAPH = {
    /** 지역 OD 그래프 집계 시간창 (재생 현재 시각 ± 이 초) */
    REGION_OD_TIME_WINDOW_SEC: 60,
    /** 혼잡 전파 그래프 집계 시간창 (LINK_METRICS와 동일 관례) */
    CONGESTION_TIME_WINDOW_SEC: 60,
    /** 혼잡 전파 그래프 V/C 임계값 — 이 이상만 "정체 노드" */
    CONGESTION_THRESHOLD: 0.7,
    /** 재요청 최소 간격 (ms) */
    REFRESH_THROTTLE_MS: 3000,
} as const;

/**
 * 등시선(isochrone) 접근성 지도 — 클릭 지점에서 자유흐름속도+V/C 근사로 도달 가능한 도로를
 * 계산한다(IsochroneService, 백엔드). V/C 계산용 시간창은 LINK_METRICS와 동일 관례를 쓴다.
 */
export const ISOCHRONE = {
    /** 기본 탐색 상한 (분) */
    DEFAULT_MAX_MINUTES: 10,
    /** 시설 원점 스냅 반경 (m) — 백엔드 ISOCHRONE_SNAP_RADIUS_M와 동일 */
    SNAP_RADIUS_M: 300,
    /** V/C 계산용 시간창 (재생 현재 시각 ± 이 초) */
    TIME_WINDOW_SEC: 60,
    /** 재요청 최소 간격 (ms) — 전체 시설 Dijkstra 반복이라 링크 레이어보다 느슨하게 */
    REFRESH_THROTTLE_MS: 8000,
} as const;

/**
 * 링크 혼잡도(V/C)/서비스수준(LOS)/병목 링크 — 신규 analyze 레이어 3종(congestion/los/bottleneck)
 * 공용 설정. `/analytics/link-traffic` 응답(volume/capacity/vcRatio/losGrade)을 그대로 재사용
 * (백엔드가 이미 계산해 내림). OD_FLOW와 달리 줌 티어에 따른 자동 표시전환은 없다 — 표시 여부는
 * 전적으로 분석 메뉴 체크박스가 소유하고, 줌은 fetch throttle에만 영향(OdFlowCesiumLayer 패턴).
 */
export const LINK_METRICS = {
    ENABLED: true,
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1200,
    /** bottleneck 레이어에서 강조할 상위 V/C 링크 개수 */
    BOTTLENECK_TOP_N: 20,
} as const;

export const OD_FLOW = {
    ENABLED: true,
    /** 이 resolution 이상에서만 활성 — VEHICLE_AGG_FEED와 경계 공유 */
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
