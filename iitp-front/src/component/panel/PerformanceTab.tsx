import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useNetworkExtentStore } from '@stores/useNetworkExtentStore';
import { getNetworkLodTierByAltitude } from '@utils/lodConstants';
import { computeViewportMetrics } from '@utils/viewportMetrics';
import { VEHICLE_ZOOM_TIER_PX_M, VEHICLE_STREAMING, VEHICLE_AGG_FEED, OD_FLOW } from '@utils/lodConstants';
import { fromLonLat } from 'ol/proj';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import Feature from 'ol/Feature';
import { Polygon } from 'ol/geom';
import { Style, Stroke, Fill } from 'ol/style';
import styles from '@css/Dashboard.module.css';

/**
 * "성능" 탭 — 기존에 지도 위에 항상 떠 있던 PerformancePanel/ViewportDebugPanel(개발용
 * 디버그 오버레이)을 대시보드 안으로 통합. 평소엔 지도를 가리지 않고, 필요할 때 대시보드를
 * 열어 확인하는 구조로 변경. 지도 위 bbox 사각형 시각화(2D/3D 동시)는 이 탭이 보이는 동안만 그린다.
 */

type Tier = 'individual' | 'heatmap' | 'odFlow' | 'unknown';

function tierOf(normalizedPixelSizeM: number): Tier {
    if (normalizedPixelSizeM < VEHICLE_ZOOM_TIER_PX_M.INDIVIDUAL_MAX) return 'individual';
    if (normalizedPixelSizeM < VEHICLE_ZOOM_TIER_PX_M.HEATMAP_MAX) return 'heatmap';
    return 'odFlow';
}

const TIER_COLOR: Record<Tier, string> = {
    individual: '#5fd35f',
    heatmap: '#ff8a3a',
    odFlow: '#ff5f5f',
    unknown: '#888888',
};

const TIER_LABEL: Record<Tier, string> = {
    individual: '개별 차량 (3D)',
    heatmap: '히트맵/trip (집계)',
    odFlow: 'OD 흐름 (overview)',
    unknown: '-',
};

interface RenderStats {
    fps: number;
    maxFrameMs: number;
    camAlt: number;
    memMB: number;
    primitives: number;
    entities: number;
}

function countPrimitives(col: any): number {
    if (!col || typeof col.length !== 'number' || typeof col.get !== 'function') return 0;
    let n = 0;
    for (let i = 0; i < col.length; i++) {
        const p = col.get(i);
        n++;
        if (p && typeof p.length === 'number' && typeof p.get === 'function') n += countPrimitives(p);
    }
    return n;
}

const StatRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 12 }}>
        <span style={{ color: '#777' }}>{label}</span>
        <span style={{ color: color ?? '#ddd', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
);

const PerformanceTab: React.FC = () => {
    const viewer = useCesiumStore((s) => s.viewer);
    const olMap = useOpenLayersStore((s) => s.map);
    const isRunning = useSimulationStore((s) => s.isRunning);
    const speed = useSimulationStore((s) => s.speed);
    const networkExtentM = useNetworkExtentStore((s) => s.extentM);

    const [render, setRender] = useState<RenderStats>({ fps: 0, maxFrameMs: 0, camAlt: 0, memMB: 0, primitives: 0, entities: 0 });
    const [pixelSizeM, setPixelSizeM] = useState<number | null>(null);
    const [normalizedPixelSizeM, setNormalizedPixelSizeM] = useState<number | null>(null);
    const [bbox, setBbox] = useState<{ w: number; s: number; e: number; n: number } | null>(null);

    const framesRef = useRef(0);
    const lastFrameRef = useRef(performance.now());
    const maxFrameRef = useRef(0);

    // ── 렌더 성능(FPS/프레임/메모리/primitive·entity 수) ──
    useEffect(() => {
        if (!viewer) return;
        const onRender = () => {
            const now = performance.now();
            const dt = now - lastFrameRef.current;
            lastFrameRef.current = now;
            framesRef.current++;
            if (dt > maxFrameRef.current) maxFrameRef.current = dt;
        };
        try { viewer.scene.postRender.addEventListener(onRender); } catch (_) { return; }

        const timer = setInterval(() => {
            const fps = framesRef.current;
            const maxFrameMs = maxFrameRef.current;
            framesRef.current = 0;
            maxFrameRef.current = 0;
            const camAlt = (() => { try { return viewer.camera.positionCartographic?.height ?? 0; } catch { return 0; } })();
            const mem = (performance as any).memory;
            const memMB = mem ? mem.usedJSHeapSize / 1048576 : 0;
            const primitives = (() => { try { return countPrimitives(viewer.scene.primitives); } catch { return 0; } })();
            const entities = (() => {
                try {
                    let n = 0;
                    const ds = viewer.dataSources;
                    for (let i = 0; i < ds.length; i++) n += ds.get(i).entities.values.length;
                    return n;
                } catch { return 0; }
            })();
            setRender({ fps, maxFrameMs, camAlt, memMB, primitives, entities });
        }, 1000);

        return () => {
            try { viewer.scene.postRender.removeEventListener(onRender); } catch (_) {}
            clearInterval(timer);
        };
    }, [viewer]);

    // ── 뷰포트 티어 + 지도 위 bbox 시각화(2D/3D 동시) — 이 탭이 마운트된 동안만 ──
    useEffect(() => {
        if (!viewer) return;

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

            cesiumEntity.rectangle!.coordinates = new Cesium.ConstantProperty(
                Cesium.Rectangle.fromDegrees(w, s, e, n)) as any;
            cesiumEntity.rectangle!.material = Cesium.Color.fromCssColorString(cssColor).withAlpha(0.15) as any;
            cesiumEntity.rectangle!.outlineColor = Cesium.Color.fromCssColorString(cssColor) as any;
            try { viewer.scene.requestRender(); } catch (_) {}

            if (olFeature) {
                const ring = [
                    fromLonLat([w, s]), fromLonLat([e, s]),
                    fromLonLat([e, n]), fromLonLat([w, n]),
                    fromLonLat([w, s]),
                ];
                (olFeature.getGeometry() as Polygon).setCoordinates([ring]);
                olFeature.setStyle(new Style({
                    stroke: new Stroke({ color: cssColor, width: 2 }),
                    fill: new Fill({ color: cssColor + '26' }),
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
    }, [viewer, olMap]);

    const lodTier = getNetworkLodTierByAltitude(render.camAlt);
    const fpsColor = render.fps >= 45 ? '#5fd35f' : render.fps >= 25 ? '#e6c34d' : '#e05555';
    const frameColor = render.maxFrameMs <= 33 ? '#5fd35f' : render.maxFrameMs <= 80 ? '#e6c34d' : '#e05555';
    const vpTier = normalizedPixelSizeM != null ? tierOf(normalizedPixelSizeM) : 'unknown';

    return (
        <div style={{ padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── 렌더 성능 KPI ── */}
            <div className={styles.kpiGrid}>
                <div className={`${styles.kpiCard} ${styles.kpiBlue}`}>
                    <div className={styles.kpiLabel}>FPS</div>
                    <div className={styles.kpiValue} style={{ color: fpsColor }}>{render.fps}</div>
                    <div className={styles.kpiUnit}>렌더 프레임/초</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.kpiAmber}`}>
                    <div className={styles.kpiLabel}>최대 프레임 간격</div>
                    <div className={styles.kpiValue} style={{ color: frameColor, fontSize: 20 }}>{render.maxFrameMs.toFixed(0)}<span className={styles.kpiValueSuffix}>ms</span></div>
                    <div className={styles.kpiUnit}>끊김(hitch) 지표</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.kpiGreen}`}>
                    <div className={styles.kpiLabel}>JS 힙</div>
                    <div className={styles.kpiValue} style={{ fontSize: 20 }}>{render.memMB > 0 ? render.memMB.toFixed(0) : 'n/a'}{render.memMB > 0 && <span className={styles.kpiValueSuffix}>MB</span>}</div>
                    <div className={styles.kpiUnit}>메모리 사용량</div>
                </div>
                <div className={`${styles.kpiCard} ${isRunning ? styles.kpiCardActive : styles.kpiDefault}`}>
                    <div className={styles.kpiLabel}>시뮬레이션</div>
                    <div className={styles.kpiStatus}>
                        <span className={isRunning ? styles.dotRunning : styles.dotStopped}/>
                        {isRunning ? `${speed}x 재생` : '정지'}
                    </div>
                    <div className={styles.kpiUnit}>Cesium 렌더 기준</div>
                </div>
            </div>

            {/* ── 카메라/씬 상세 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: '#4169E1' }}/>
                    <span className={styles.sectionTitle}>카메라 · 씬</span>
                </div>
                <StatRow label="카메라 고도" value={render.camAlt >= 1000 ? `${(render.camAlt / 1000).toFixed(1)} km` : `${render.camAlt.toFixed(0)} m`} />
                <StatRow label="LOD tier (네트워크)" value={lodTier} />
                <StatRow label="Primitives (Cesium)" value={render.primitives.toLocaleString()} />
                <StatRow label="Entities (dataSources)" value={render.entities.toLocaleString()} />
            </div>

            {/* ── 뷰포트 티어(차량 표시 방식) ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: TIER_COLOR[vpTier] }}/>
                    <span className={styles.sectionTitle}>뷰포트 · 차량 표시 티어</span>
                    <span className={styles.sectionMeta} style={{ color: TIER_COLOR[vpTier] }}>{TIER_LABEL[vpTier]}</span>
                </div>
                <StatRow label="네트워크 규모" value={networkExtentM != null ? `${networkExtentM.toFixed(0)} m` : 'n/a'} />
                <StatRow label="pixelSizeM (raw)" value={pixelSizeM != null ? `${pixelSizeM.toFixed(1)} m/px` : 'n/a'} />
                <StatRow label="pixelSizeM (네트워크 크기 보정)" value={normalizedPixelSizeM != null ? `${normalizedPixelSizeM.toFixed(1)} m/px` : 'n/a'} />
                <StatRow label="bbox 서/북" value={bbox ? `${bbox.w.toFixed(4)}, ${bbox.n.toFixed(4)}` : 'n/a'} />
                <StatRow label="bbox 동/남" value={bbox ? `${bbox.e.toFixed(4)}, ${bbox.s.toFixed(4)}` : 'n/a'} />
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <StatRow label="개별 차량 표시 <" value={`${VEHICLE_STREAMING.MAX_PIXEL_SIZE_M} m/px`} color={TIER_COLOR.individual} />
                    <StatRow label="히트맵/trip 집계" value={`${VEHICLE_AGG_FEED.MIN_RESOLUTION} ~ ${VEHICLE_AGG_FEED.MAX_RESOLUTION} m/px`} color={TIER_COLOR.heatmap} />
                    <StatRow label="OD 흐름 (overview) ≥" value={`${OD_FLOW.MIN_RESOLUTION} m/px`} color={TIER_COLOR.odFlow} />
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: '#555' }}>
                    지도 위 사각형(2D/3D 동시)이 현재 bbox를 티어 색상으로 표시합니다.
                </div>
            </div>
        </div>
    );
};

export default PerformanceTab;
