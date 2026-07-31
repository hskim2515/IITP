/**
 * 3D 네트워크 primitive 공유 상태 — **의존성 없는(dependency-free) 모듈**.
 *
 * networkPrimitivePropertiesMap 과 하이라이트 수명 상수는 여러 모듈
 * (NetworkDataSourceLayer, networkFeatureLocator, defaultEventHandler,
 * useDefaultSelect, useNaverPanorama 등)이 함께 쓴다. 이것들이
 * NetworkDataSourceLayer 에서 직접 import 되면, UI 컴포넌트 →
 * networkFeatureLocator → NetworkDataSourceLayer → useLayerInit →
 * LayerManager(import.meta.glob eager: @datasource/*) 로 이어지는
 * 모듈 평가 사이클이 생겨 TDZ/초기화 실패로 3D 레이어 생성이
 * 조용히 죽을 수 있다(실측 회귀). 반드시 이 파일은 다른 앱 모듈을
 * import 하지 않는 순수 리프 모듈로 유지할 것.
 */

/** guid → 링크/레인 props (픽킹/하이라이트/좌표 조회용). 키는 String 통일. */
export const networkPrimitivePropertiesMap = new Map<string, any>();

/** 선택 하이라이트 유지 시간(ms) — 2D 오버레이/3D 선택 슬롯 공용 */
export const NETWORK_HIGHLIGHT_DURATION_MS = 5000;

/**
 * 네트워크 가시성 스냅샷 — 2D/3D 공용 단일 출처.
 *
 * 두 곳에서 "레이어 객체의 show 플래그만으로는 부족한" 문제가 있다:
 *  - 3D pickNetworkAtPosition 은 렌더된 primitive 가 아니라 좌표 캐시를 직접 탐색하므로
 *    (분류볼륨 pick 불일치 회피) 레이어를 꺼도 pick 이 계속 히트한다.
 *  - 2D 도로/차선은 MVT(VectorTile) 렌더라 featureType 별 피처 스타일 토글이 불가능하다 —
 *    styleFunction 이 이 값을 보고 undefined 를 반환해야 실제로 사라진다.
 *
 * NetworkDataSourceLayer(3D)/NetworkFeatureLayer(2D) 의 setVisible·toggleFeatureTypeVisible
 * 이 값을 갱신하고, pick/style 경로가 이를 게이트로 사용한다.
 */
export const networkPickVisibility = {
    /** 네트워크 레이어 전체 on/off */
    layer: true,
    /** 하위 featureType on/off (links/lanes) */
    links: true,
    lanes: true,
    nodes: true,
    ports: true,
    connections: true,
};

/**
 * 렌더/픽에 쓰이는 featureType → 가시성 그룹 매핑.
 *
 * 편집 오버레이(link-edit/lane-edit)와 레인 하위(cells/segments)는 별도 체크박스가 없고
 * 각각 links/lanes 를 따른다. 매핑에 없는 featureType 은 항상 표시(true)로 본다.
 */
const FEATURE_TYPE_VIS_GROUP: Record<string, keyof typeof networkPickVisibility> = {
    links: "links",
    "link-edit": "links",
    lanes: "lanes",
    "lane-edit": "lanes",
    cells: "lanes",
    segments: "lanes",
    nodes: "nodes",
    ports: "ports",
    connections: "connections",
};

/**
 * 해당 featureType 이 지금 화면에 그려지고 픽 대상이 되는지 —
 * 레이어 전체 가시성과 featureType 가시성의 AND.
 *
 * ⚠️ 렌더 시점(styleFunction)과 픽 시점 양쪽에서 이 함수를 써야 한다. 피처 인스턴스에
 * 빈 스타일을 씌우는 방식은 줌/팬으로 타일이 재빌드되면 새 피처에 적용되지 않아
 * "가려진 객체가 순간적으로 드러나는" 문제를 만든다.
 */
export function isNetworkFeatureTypeVisible(featureType: string | undefined | null): boolean {
    const group = featureType ? FEATURE_TYPE_VIS_GROUP[featureType] : undefined;
    // 네트워크 소속이 아닌 featureType(버스정류장·신호 등)은 이 게이트의 대상이 아니다 —
    // 여기서 layer 플래그를 적용하면 네트워크를 끌 때 다른 레이어까지 숨김 판정된다.
    if (!group) return true;
    if (!networkPickVisibility.layer) return false;
    return networkPickVisibility[group] !== false;
}
