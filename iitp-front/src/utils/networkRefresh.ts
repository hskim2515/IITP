import { useLayerStore } from "@stores/useLayerStore";

/**
 * 네트워크 교체(임포트 반영) 후 2D 타일 렌더 갱신.
 *
 * MVT(VectorTile)는 OL 내부 캐시 + 브라우저 HTTP 캐시에 이전 네트워크 타일이 남아,
 * 임포트 후에도 옛 도로가 보이거나 새/옛 타일이 섞여 도로망이 깨져 보인다.
 * NetworkFeatureLayer.refreshNetworkTiles()가 MVT rev 캐시버스트 + JSON 타일 재fetch를 수행.
 */
export function refreshNetworkTiles(): void {
    try {
        const lm = useLayerStore.getState().layerManager;
        const layer: any = lm?.getLayerByName("network");
        layer?.refreshNetworkTiles?.();
    } catch (e) {
        console.warn("[refreshNetworkTiles] 실패(무시):", e);
    }
}
