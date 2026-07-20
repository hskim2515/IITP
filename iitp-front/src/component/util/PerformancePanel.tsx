import React, { useEffect, useRef, useState } from "react";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import { getNetworkLodTierByAltitude } from "@utils/lodConstants";

/**
 * 성능 측정 오버레이 (개발/테스트용).
 * - 렌더 FPS: Cesium scene.postRender 카운트 (requestRenderMode 반영, 실제 렌더 프레임)
 * - 최대 프레임 간격(ms): 1초 구간의 worst frame → 끊김(hitch) 지표
 * - 카메라 고도 + LOD tier: 줌 레벨별 성능 분석
 * - 시뮬 상태(재생/배속), JS 힙 메모리, Cesium primitive 수
 * 토글: Ctrl+Shift+P (또는 우상단 X)
 */
interface Stats {
    fps: number;
    maxFrameMs: number;
    camAlt: number;
    memMB: number;
    primitives: number; // scene.primitives 재귀(중첩 collection 포함)
    entities: number;   // dataSources 엔티티 총합 (노드/포트/시설물)
}

/** PrimitiveCollection 재귀 카운트 (중첩 collection 내부까지) */
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

export default function PerformancePanel() {
    const viewer = useCesiumStore((s) => s.viewer);
    const isRunning = useSimulationStore((s) => s.isRunning);
    const speed = useSimulationStore((s) => s.speed);
    const [show, setShow] = useState(true);
    const [stats, setStats] = useState<Stats>({ fps: 0, maxFrameMs: 0, camAlt: 0, memMB: 0, primitives: 0, entities: 0 });

    const framesRef = useRef(0);
    const lastFrameRef = useRef(performance.now());
    const maxFrameRef = useRef(0);

    // 렌더 프레임 카운트 (Cesium postRender)
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
            setStats({ fps, maxFrameMs, camAlt, memMB, primitives, entities });
        }, 1000);

        return () => {
            try { viewer.scene.postRender.removeEventListener(onRender); } catch (_) {}
            clearInterval(timer);
        };
    }, [viewer]);

    // 토글 단축키
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); setShow((v) => !v); }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, []);

    if (!show) return null;

    const tier = getNetworkLodTierByAltitude(stats.camAlt);
    const fpsColor = stats.fps >= 45 ? '#5fd35f' : stats.fps >= 25 ? '#e6c34d' : '#e05555';
    const frameColor = stats.maxFrameMs <= 33 ? '#5fd35f' : stats.maxFrameMs <= 80 ? '#e6c34d' : '#e05555';

    const row = (label: string, value: string, color?: string) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#9aa' }}>{label}</span>
            <span style={{ color: color ?? '#e8eaf0', fontWeight: 600 }}>{value}</span>
        </div>
    );

    return (
        <div style={{
            // 좌하단 배치 + z-index 900: 우측은 데이터 입출력 등 툴 패널 영역이라
            // 디버그 오버레이가 "서버 저장" 섹션을 가렸음 (패널이 main 스태킹 컨텍스트
            // 안이라 z-index 로는 못 이김 → 위치 자체를 비켜 배치)
            position: 'fixed', bottom: 42, left: 12, zIndex: 900,
            background: 'rgba(16,18,24,0.88)', color: '#e8eaf0',
            font: '11px/1.5 ui-monospace, Menlo, monospace',
            padding: '8px 10px', borderRadius: 6, minWidth: 190,
            border: '1px solid rgba(255,255,255,0.12)', pointerEvents: 'auto',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>PERF</span>
                <span style={{ cursor: 'pointer', color: '#9aa' }} onClick={() => setShow(false)} title="Ctrl+Shift+P">✕</span>
            </div>
            {row('FPS', String(stats.fps), fpsColor)}
            {row('worst frame', `${stats.maxFrameMs.toFixed(0)} ms`, frameColor)}
            {row('cam alt', `${stats.camAlt >= 1000 ? (stats.camAlt / 1000).toFixed(1) + ' km' : stats.camAlt.toFixed(0) + ' m'}`)}
            {row('LOD tier', tier)}
            {row('sim', isRunning ? `▶ ${speed}x` : '⏸')}
            {row('JS heap', stats.memMB > 0 ? `${stats.memMB.toFixed(0)} MB` : 'n/a')}
            {row('primitives', String(stats.primitives))}
            {row('entities', stats.entities.toLocaleString())}
            <div style={{ marginTop: 4, color: '#667', fontSize: 10 }}>Ctrl+Shift+P</div>
        </div>
    );
}
