import { useLayerStore } from "@stores/useLayerStore";

/**
 * 네트워크 교체(임포트 반영) 후 2D/3D 타일 렌더 갱신.
 *
 * 2D: MVT(VectorTile)는 OL 내부 캐시 + 브라우저 HTTP 캐시에 이전 네트워크 타일이 남아,
 * 임포트 후에도 옛 도로가 보이거나 새/옛 타일이 섞여 도로망이 깨져 보인다.
 * NetworkFeatureLayer.refreshNetworkTiles()가 MVT rev 캐시버스트 + JSON 타일 재fetch를 수행.
 *
 * 3D: Cesium 쪽 타일 매니저 LRU 도 같은 타일 키를 "이미 로드됨"으로 취급해 재fetch 를
 * 건너뛰므로(간선 중심선 bbox-skip 캐시 포함), 함께 비우지 않으면 3D 에만 이전 네트워크가
 * 계속 남는다. NetworkDataSourceLayer.refreshNetworkTiles()가 청크/캐시 정리 + 재fetch 수행.
 */
export function refreshNetworkTiles(): void {
    try {
        const lm = useLayerStore.getState().layerManager;
        const layer: any = lm?.getLayerByName("network");
        layer?.refreshNetworkTiles?.();
        const cesiumLayer: any = lm?.getDataSourceLayerByName?.("network");
        cesiumLayer?.refreshNetworkTiles?.();
    } catch (e) {
        console.warn("[refreshNetworkTiles] 실패(무시):", e);
    }
}
