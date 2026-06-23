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
    /** 네트워크: 레인 숨기고 링크만 표시하는 고도             ↔ OL ~3 m/px */
    NETWORK_LINK_ONLY:   3000,
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
    /** 네트워크: 레인 숨기고 링크만                         ↔ Cesium ~2000m */
    NETWORK_LINK_ONLY:      2,
    /** 네트워크: 외곽선만                                   ↔ Cesium ~8000m */
    NETWORK_OUTLINE_ONLY:   8,
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

/** Cesium 카메라 고도(m) → 네트워크 LOD tier (2D와 동일한 단계 의미) */
export function getNetworkLodTierByAltitude(altitude: number): NetworkLodTier {
    if (altitude > LOD_ALT.NETWORK_OUTLINE_ONLY) return 'overview';
    if (altitude > LOD_ALT.NETWORK_LINK_ONLY)    return 'mid';
    // 고도 기반에는 아직 별도 차선 디테일 임계값이 없으므로 LINK_ONLY 이하를 detail로 본다.
    return 'detail';
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
    ENABLED: true,
    /** 타일 격자 크기(도) ≈ 2.5km. 고밀도 도시 detail 타일이 5km면 ~6.8MB/3천링크라 커서 축소.
     *  (CHUNK_DEG가 이 값을 참조 → Cesium 청크도 함께 작아짐) */
    TILE_DEG: 0.025,
    /** viewport 주변 선읽기 링 수 (팬 끊김 방지) */
    PREFETCH_RING: 1,
    /** 메모리 보유 최대 타일 수 (LRU; 되돌아가기 캐시) */
    LRU_MAX_TILES: 64,
    /**
     * MVT(PBF) 레이어 활성화 (단계 3) — overview/mid 2D 를 OL VectorTile 로 가속.
     * ON 이면 NetworkFeatureLayer 는 overview/mid 에서 링크 중심선 렌더를 MVT 에 양보한다.
     */
    MVT_ENABLED: true,
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
    /** 신호 타일링 활성화 (기본 off) */
    ENABLED: true,
    /** near tier 이상(확대)에서만 신호 타일 fetch — 멀리선 신호 자체가 dot/숨김이라 불필요 */
    MIN_TIER: 'near' as NetworkLodTier,
} as const;

/**
 * 차량 교통량 백엔드 집계 (멀리서 전체 교통량 — 개별 차량 대신 링크별 통계).
 * ON 이면 TrafficHeatmapFeatureLayer 가 overview/mid 에서 개별 차량 대신
 * `/analytics/link-traffic` 집계를 호출해 히트맵을 칠한다 (개별 차량 위치 무시).
 * near(확대)에서는 기존 개별 차량 경로 유지. 기본 off — 기존 동작 무변화.
 */
export const VEHICLE_AGGREGATION = {
    ENABLED: true,
    /** 이 resolution 이상(멀리)에서 집계 모드 활성 — 미만(near)은 개별 차량 */
    MIN_RESOLUTION: LOD_RES.NETWORK_LANE_DETAIL, // = 0.3 (near 이상)
    /** 재생 현재 시각 기준 ± 집계 시간창 (초) */
    TIME_WINDOW_SEC: 60,
    /** moveend/재생 집계 호출 최소 간격 (ms, throttle) */
    THROTTLE_MS: 1000,
} as const;

/**
 * 차량 개별 렌더 viewport culling (near — 개별 차량 표시 시).
 * worker는 인덱스 보존(trail[i]↔vehicle[i]) 때문에 전체 차량을 계산하지만,
 * OL VehicleFeatureLayer 는 화면 밖 차량의 feature 좌표 업데이트/렌더를 건너뛴다.
 * GPU instanced 인 Cesium 은 자동 frustum culling 으로 충분해 제외. 기본 off.
 */
export const VEHICLE_CULLING = {
    ENABLED: true,
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
