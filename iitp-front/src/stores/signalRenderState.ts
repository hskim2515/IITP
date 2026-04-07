/**
 * Cesium SignalDataSourceLayer → OL SignalFeatureLayer 로 신호 상태 공유
 * (React 상태 아님 — 렌더 루프에서 직접 읽기/쓰기)
 */
export const signalRenderState = {
    /** nodeId → "green" | "yellow" | "red" | "" */
    nodeState: new Map<string, string>(),
    /** nodeId → 현재 활성화된 connection GUID/ID 집합 */
    activeConns: new Map<string, Set<string>>(),
};
