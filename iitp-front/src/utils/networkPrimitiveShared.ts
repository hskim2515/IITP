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
