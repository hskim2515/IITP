import React, { useEffect, useState } from "react";
import * as Cesium from "cesium";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useNetworkExtentStore } from "@stores/useNetworkExtentStore";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import { VEHICLE_ZOOM_TIER_PX_M, VEHICLE_STREAMING, TRAFFIC_FLOW, VEHICLE_AGGREGATION, OD_FLOW } from "@utils/lodConstants";
import { fromLonLat } from "ol/proj";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import Feature from "ol/Feature";
import { Polygon } from "ol/geom";
import { Style, Stroke, Fill } from "ol/style";

type Tier = "individual" | "flow" | "heatmap" | "odFlow" | "unknown";

// 티어 판정은 반드시 normalizedPixelSizeM(네트워크 실제 크기로 보정된 값) 기준 — 각 레이어
// (TrafficTailCesiumLayer/TrafficHeatmapCesiumLayer/OdFlowCesiumLayer)와 동일 기준을 써야
// 이 패널의 "예상 티어"가 실제 레이어 활성 상태와 어긋나지 않는다.
function tierOf(normalizedPixelSizeM: number): Tier {
    if (normalizedPixelSizeM < VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX) return "individual";
    if (normalizedPixelSizeM < VEHICLE_ZOOM_TIER_PX_M.FLOW_MAX) return "flow";
    if (normalizedPixelSizeM < VEHICLE_ZOOM_TIER_PX_M.HEATMAP_MAX) return "heatmap";
    return "odFlow";
}

const TIER_COLOR: Record<Tier, string> = {
    individual: "#5fd35f",
    flow: "#e6c34d",
    heatmap: "#ff8a3a",
    odFlow: "#ff5f5f",
    unknown: "#888888",
};

const TIER_LABEL: Record<Tier, string> = {
    individual: "개별 차량 (3D)",
    flow: "flow (흐름)",
    heatmap: "히트맵 (집계)",
    odFlow: "OD 흐름 (overview)",
    unknown: "-",
};

/**
 * 차량 줌 티어(개별/flow/히트맵) 경계 디버깅 오버레이 — 실제로 어느 pixelSizeM 구간에서
 * 어느 티어가 활성인지 콘솔 로그 대신 지도 위에서 직접 확인하기 위함.
 *
 * - 화면 좌하단 패널: 실시간 pixelSizeM / 현재 티어 / bbox / VEHICLE_ZOOM_TIER_PX_M 경계값
 * - 지도 위 사각형: computeViewportMetrics()가 계산한 bbox를 현재 티어 색상으로 Cesium(3D)과
 *   OpenLayers(2D) 양쪽에 동시에 그려서(이중 지도 아키텍처), 세 시스템이 실제로 같은 bbox를
 *   보고 있는지 눈으로 검증할 수 있게 한다.
 *
 * 구현 메모: 엔티티/OL 레이어는 켜져 있는 한 세션(effect 1회 실행) 동안만 생성해 유지하고,
 * 꺼지면 그 세션 안에서 전부 정리한다 — ref로 여러 effect 실행에 걸쳐 재사용하지 않는다
 * (그렇게 하면 StrictMode 이중 호출이나 effect cleanup 타이밍에 따라 참조가 이미 제거된
 * 엔티티를 계속 가리키는 상태로 남아 "한 번 껐다 켜면 다시 안 나타나는" 문제가 생길 수 있다).
 *
 * 토글: Ctrl+Shift+V (PerformancePanel의 Ctrl+Shift+P와 동일 패턴)
 */
export default function ViewportDebugPanel() {
    const viewer = useCesiumStore((s) => s.viewer);
    const olMap = useOpenLayersStore((s) => s.map);
    const [show, setShow] = useState(true); // 디버깅 중 — 기본으로 켜둠 (Ctrl+Shift+V로 끄기 가능)
    const [pixelSizeM, setPixelSizeM] = useState<number | null>(null);
    const [normalizedPixelSizeM, setNormalizedPixelSizeM] = useState<number | null>(null);
    const [bbox, setBbox] = useState<{ w: number; s: number; e: number; n: number } | null>(null);
    const networkExtentM = useNetworkExtentStore((s) => s.extentM);

    // 토글 단축키
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) { e.preventDefault(); setShow((v) => !v); }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, []);

    // 켜져 있는 동안만 이 effect가 살아있고, 엔티티/레이어도 이 안에서 생성·정리된다.
    useEffect(() => {
        if (!show || !viewer) {
            setPixelSizeM(null);
            setNormalizedPixelSizeM(null);
            setBbox(null);
            return;
        }

        const cesiumEntity = viewer.entities.add({
            rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(0, 0, 0.001, 0.001),
                material: Cesium.Color.WHITE.withAlpha(0.15),
                outline: true,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                classificationType: Cesium.ClassificationType.BOTH,
            },
        });

        let olLayer: VectorLayer | null = null;
        let olFeature: Feature | null = null;
        if (olMap) {
            const source = new VectorSource();
            olFeature = new Feature({ geometry: new Polygon([[[0, 0], [0, 0], [0, 0]]]) });
            source.addFeature(olFeature);
            olLayer = new VectorLayer({ source, zIndex: 999 });
            olMap.addLayer(olLayer);
        }

        const update = () => {
            const metrics = computeViewportMetrics(viewer);
            if (!metrics) return;
            setPixelSizeM(metrics.pixelSizeM);
            setNormalizedPixelSizeM(metrics.normalizedPixelSizeM);
            setBbox(metrics.bbox);

            const tier = tierOf(metrics.normalizedPixelSizeM);
            const cssColor = TIER_COLOR[tier];
            const { w, s, e, n } = metrics.bbox;

            // Cesium(3D)
            cesiumEntity.rectangle!.coordinates = new Cesium.ConstantProperty(
                Cesium.Rectangle.fromDegrees(w, s, e, n)) as any;
            cesiumEntity.rectangle!.material = Cesium.Color.fromCssColorString(cssColor).withAlpha(0.15) as any;
            cesiumEntity.rectangle!.outlineColor = Cesium.Color.fromCssColorString(cssColor) as any;
            try { viewer.scene.requestRender(); } catch (_) {}

            // OpenLayers(2D)
            if (olFeature) {
                const ring = [
                    fromLonLat([w, s]), fromLonLat([e, s]),
                    fromLonLat([e, n]), fromLonLat([w, n]),
                    fromLonLat([w, s]),
                ];
                (olFeature.getGeometry() as Polygon).setCoordinates([ring]);
                olFeature.setStyle(new Style({
                    stroke: new Stroke({ color: cssColor, width: 2 }),
                    fill: new Fill({ color: cssColor + '26' }), // ~15% alpha
                }));
            }
        };
        update();
        const timer = setInterval(update, 300);

        return () => {
            clearInterval(timer);
            viewer.entities.remove(cesiumEntity);
            if (olMap && olLayer) olMap.removeLayer(olLayer);
            try { viewer.scene.requestRender(); } catch (_) {}
        };
    }, [show, viewer, olMap]);

    if (!show) return null;

    const tier = normalizedPixelSizeM != null ? tierOf(normalizedPixelSizeM) : "unknown";

    const row = (label: string, value: string, color?: string) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#9aa' }}>{label}</span>
            <span style={{ color: color ?? '#e8eaf0', fontWeight: 600 }}>{value}</span>
        </div>
    );

    return (
        <div style={{
            position: 'fixed', bottom: 42, left: 220, zIndex: 900,
            background: 'rgba(16,18,24,0.88)', color: '#e8eaf0',
            font: '11px/1.5 ui-monospace, Menlo, monospace',
            padding: '8px 10px', borderRadius: 6, minWidth: 250,
            border: '1px solid rgba(255,255,255,0.12)', pointerEvents: 'auto',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>VIEWPORT</span>
                <span style={{ cursor: 'pointer', color: '#9aa' }} onClick={() => setShow(false)} title="Ctrl+Shift+V">✕</span>
            </div>
            {row('network extent', networkExtentM != null ? `${networkExtentM.toFixed(0)} m` : 'n/a')}
            {row('pixelSizeM(raw)', pixelSizeM != null ? `${pixelSizeM.toFixed(1)} m/px` : 'n/a')}
            {row('pixelSizeM(보정)', normalizedPixelSizeM != null ? `${normalizedPixelSizeM.toFixed(1)} m/px` : 'n/a')}
            {row('tier', TIER_LABEL[tier], TIER_COLOR[tier])}
            {row('bbox w/e', bbox ? `${bbox.w.toFixed(4)} / ${bbox.e.toFixed(4)}` : 'n/a')}
            {row('bbox s/n', bbox ? `${bbox.s.toFixed(4)} / ${bbox.n.toFixed(4)}` : 'n/a')}
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 4 }}>
                {row('개별 <', `${VEHICLE_STREAMING.MAX_PIXEL_SIZE_M}`)}
                {row('flow', `${TRAFFIC_FLOW.MIN_RESOLUTION} ~ ${TRAFFIC_FLOW.MAX_RESOLUTION}`)}
                {row('히트맵', `${VEHICLE_AGGREGATION.MIN_RESOLUTION} ~ ${VEHICLE_AGGREGATION.MAX_RESOLUTION}`)}
                {row('OD흐름 ≥', `${OD_FLOW.MIN_RESOLUTION}`)}
            </div>
            <div style={{ marginTop: 4, color: '#667', fontSize: 10 }}>Ctrl+Shift+V · 사각형=현재 bbox(2D/3D 동시, 티어 색상) · 임계값은 보정값 기준</div>
        </div>
    );
}
