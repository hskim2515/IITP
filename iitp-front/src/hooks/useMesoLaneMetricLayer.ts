import { useEffect } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import MesoLaneMetricLayer from "@primitives/MesoLaneMetricLayer";
import MesoLaneMetricOlLayer from "@features/MesoLaneMetricOlLayer";

/**
 * 메조 링크 레인/커넥션 색칠 레이어를 2D/3D 동시에 마운트(CLAUDE.md 이중 지도 동시 생성
 * 패턴 — 단, LayerManager 스키마 자동등록 대상(facility)이 아니라 시뮬레이션 분석 오버레이라
 * useKtdbPolygonDraw/useMicroRegionDraw와 같은 독립 훅으로 직접 마운트한다). Maps.tsx에서 호출.
 */
export function useMesoLaneMetricLayer() {
    const viewer = useCesiumStore((s) => s.viewer);
    const map = useOpenLayersStore((s) => s.map);

    useEffect(() => {
        if (!viewer) return;
        const layer = new MesoLaneMetricLayer(viewer);
        return () => layer.destroy();
    }, [viewer]);

    useEffect(() => {
        if (!map) return;
        const layer = new MesoLaneMetricOlLayer(map);
        return () => layer.destroy();
    }, [map]);
}
