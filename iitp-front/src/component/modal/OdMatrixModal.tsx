import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import type { DemandEntry, OdMatrixData, OdMatrixItem } from '@type/OdMatrix';

const MENU_CODE = 'OD_MATRIX';

/* ── 매트릭스 내부 상태 ── */
interface MatrixState {
    sources: string[];
    sinks:   string[];
    flowMap: Map<string, number>;   // cellKey → flow
    distMap: Map<string, string>;   // cellKey → dist
}

const cellKey = (src: string, snk: string) => `${src}||${snk}`;

function demandsToMatrix(demands: DemandEntry[]): MatrixState {
    const sources = [...new Set(demands.map(d => d.source))].filter(Boolean);
    const sinks   = [...new Set(demands.map(d => d.sink))].filter(Boolean);
    const flowMap = new Map<string, number>();
    const distMap = new Map<string, string>();
    for (const d of demands) {
        if (!d.source || !d.sink) continue;
        flowMap.set(cellKey(d.source, d.sink), d.flow);
        if (d.dist) distMap.set(cellKey(d.source, d.sink), d.dist);
    }
    return { sources, sinks, flowMap, distMap };
}

function matrixToDemands(m: MatrixState): DemandEntry[] {
    const out: DemandEntry[] = [];
    m.flowMap.forEach((flow, key) => {
        const [src, snk] = key.split('||');
        if (src && snk && (flow ?? 0) > 0) {
            out.push({ source: src, sink: snk, flow, dist: m.distMap.get(key) ?? '' });
        }
    });
    return out;
}

function formatFlow(v: number): string {
    if (v === 0) return '';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/* ── 컴포넌트 ── */
const OdMatrixModal: React.FC = () => {
    const closeSession = useWorkflowStore((s: any) => s.closeSession) as (code: string) => void;
    const versionId    = useScenarioStore((s) => s.selectedScenarioVersion)?.key ?? '';

    const [loading, setLoading] = useState(true);
    const [saving,  setSaving]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);
    const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const [data,   setData]   = useState<OdMatrixData | null>(null);
    const [tabIdx, setTabIdx] = useState(0);
    const [matrix, setMatrix] = useState<MatrixState>({ sources: [], sinks: [], flowMap: new Map(), distMap: new Map() });

    // 인라인 셀 편집
    const [editCell,  setEditCell]  = useState<{ src: string; snk: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const editInputRef = useRef<HTMLInputElement>(null);

    // 새 행/열 추가 입력
    const [newSrcInput, setNewSrcInput] = useState('');
    const [newSnkInput, setNewSnkInput] = useState('');

    const matrixRef = useRef(matrix);
    matrixRef.current = matrix;

    /* ── 최대 flow (컬러 스케일용) ── */
    const maxFlow = useMemo(() => {
        let m = 0;
        matrix.flowMap.forEach(v => { if (v > m) m = v; });
        return m || 1;
    }, [matrix.flowMap]);

    /* ── 초기 로드 ── */
    useEffect(() => {
        if (!versionId) return;
        setLoading(true); setError(null);
        axiosInstance.get(`/od-matrix/${versionId}`)
            .then(res => {
                const matrices: OdMatrixItem[] = (res.data.odMatrices ?? []).map((m: any) => ({
                    id: m.id ?? 0,
                    startTime: m.startTime ?? '00:00:00',
                    duration: m.duration ?? 0,
                    demands: (m.nvodMatrix?.demands ?? []).map((d: any) => ({
                        source: d.source ?? '', sink: d.sink ?? '',
                        flow: d.flow ?? 0, dist: d.dist ?? '',
                    })),
                }));
                setData({ odMatrices: matrices });
                setTabIdx(0);
                setMatrix(demandsToMatrix(matrices[0]?.demands ?? []));
            })
            .catch(e => setError(e.message ?? '불러오기 실패'))
            .finally(() => setLoading(false));
    }, [versionId]);

    /* ── 탭 전환 ── */
    const flushMatrix = useCallback(() => {
        if (!data) return data;
        const cur = matrixRef.current;
        return {
            odMatrices: data.odMatrices.map((m, i) =>
                i === tabIdx ? { ...m, demands: matrixToDemands(cur) } : m
            ),
        };
    }, [data, tabIdx]);

    const switchTab = (idx: number) => {
        if (idx === tabIdx || !data) return;
        const updated = flushMatrix();
        if (updated) setData(updated);
        setTabIdx(idx);
        setMatrix(demandsToMatrix(updated?.odMatrices[idx]?.demands ?? []));
        setEditCell(null);
        setNewSrcInput(''); setNewSnkInput('');
    };

    /* ── 셀 클릭 → 편집 ── */
    const startEdit = (src: string, snk: string) => {
        const v = matrix.flowMap.get(cellKey(src, snk)) ?? 0;
        setEditCell({ src, snk });
        setEditValue(v === 0 ? '' : String(v));
        setTimeout(() => editInputRef.current?.select(), 0);
    };

    const commitEdit = () => {
        if (!editCell) return;
        const flow = parseFloat(editValue) || 0;
        const key  = cellKey(editCell.src, editCell.snk);
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            if (flow > 0) fm.set(key, flow); else fm.delete(key);
            return { ...prev, flowMap: fm };
        });
        setEditCell(null);
    };

    /* ── 행 삭제 ── */
    const deleteSource = (src: string) => {
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            const dm = new Map(prev.distMap);
            prev.sinks.forEach(snk => { const k = cellKey(src, snk); fm.delete(k); dm.delete(k); });
            return { ...prev, sources: prev.sources.filter(s => s !== src), flowMap: fm, distMap: dm };
        });
    };

    /* ── 열 삭제 ── */
    const deleteSink = (snk: string) => {
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            const dm = new Map(prev.distMap);
            prev.sources.forEach(src => { const k = cellKey(src, snk); fm.delete(k); dm.delete(k); });
            return { ...prev, sinks: prev.sinks.filter(s => s !== snk), flowMap: fm, distMap: dm };
        });
    };

    /* ── 행 추가 ── */
    const addSource = () => {
        const v = newSrcInput.trim();
        if (!v || matrix.sources.includes(v)) return;
        setMatrix(prev => ({ ...prev, sources: [...prev.sources, v] }));
        setNewSrcInput('');
    };

    /* ── 열 추가 ── */
    const addSink = () => {
        const v = newSnkInput.trim();
        if (!v || matrix.sinks.includes(v)) return;
        setMatrix(prev => ({ ...prev, sinks: [...prev.sinks, v] }));
        setNewSnkInput('');
    };

    /* ── 저장 ── */
    const handleSave = useCallback(async () => {
        if (!data || !versionId) return;
        const updated = flushMatrix();
        if (!updated) return;
        const payload = {
            odMatrices: updated.odMatrices.map(m => ({
                id: m.id, startTime: m.startTime, duration: m.duration,
                nvodMatrix: {
                    demands: m.demands.map(d => ({
                        source: d.source, sink: d.sink, flow: d.flow, dist: d.dist ?? '',
                    })),
                },
            })),
        };
        setSaving(true);
        try {
            await axiosInstance.post(`/od-matrix/${versionId}`, payload);
            setSaveMsg({ ok: true, text: '저장 완료' });
        } catch (e: any) {
            setSaveMsg({ ok: false, text: e.message ?? '저장 실패' });
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMsg(null), 2500);
        }
    }, [data, versionId, flushMatrix]);

    /* ── 셀 색상 ── */
    const cellBg = (flow: number) => {
        if (!flow) return 'transparent';
        const ratio = Math.min(flow / maxFlow, 1);
        // 낮은 값: 파랑 계열, 높은 값: 주황 계열
        const r = Math.round(40  + ratio * 215);
        const g = Math.round(100 - ratio * 50);
        const b = Math.round(225 - ratio * 200);
        return `rgba(${r},${g},${b},${0.15 + ratio * 0.55})`;
    };

    const currentMatrix = data?.odMatrices[tabIdx];

    return (
        <div style={ov}>
            <div style={panel}>

                {/* ── 헤더 ── */}
                <div style={hdr}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#dde6ff' }}>
                            OD Matrix 수요 편집
                        </span>
                        {versionId && (
                            <span style={badge}>{versionId}</span>
                        )}
                        {saveMsg && (
                            <span style={{
                                fontSize: 11, borderRadius: 5, padding: '3px 10px',
                                color:       saveMsg.ok ? '#4ecb8d' : '#f07070',
                                background:  saveMsg.ok ? 'rgba(0,200,100,0.08)' : 'rgba(220,60,60,0.1)',
                                border: `1px solid ${saveMsg.ok ? 'rgba(0,200,100,0.25)' : 'rgba(220,60,60,0.25)'}`,
                            }}>
                                {saveMsg.text}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={handleSave} disabled={saving || loading} style={saveBtn(saving || loading)}>
                            {saving ? '저장 중…' : '저장'}
                        </button>
                        <button onClick={() => closeSession(MENU_CODE)} style={closeBtn}>✕</button>
                    </div>
                </div>

                {/* ── 상태 ── */}
                {loading && <Center>불러오는 중…</Center>}
                {!loading && error && <Center style={{ color: '#f07070' }}>{error}</Center>}

                {/* ── 본문 ── */}
                {!loading && !error && data && (
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                        {/* 왼쪽 시간대 목록 */}
                        <div style={sidebar}>
                            <div style={sideTitle}>시간대 ({data.odMatrices.length})</div>
                            {data.odMatrices.map((m, i) => (
                                <button key={m.id} onClick={() => switchTab(i)} style={tabItem(i === tabIdx)}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: i === tabIdx ? '#aac8ff' : '#666' }}>
                                        {m.startTime.slice(0, 5)}
                                    </span>
                                    <span style={{ fontSize: 10, color: i === tabIdx ? '#5577bb' : '#3a3a3a', marginTop: 2 }}>
                                        {m.duration}분 · {i === tabIdx
                                            ? matrixToDemands(matrix).length
                                            : m.demands.length}건
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* 오른쪽 피벗 매트릭스 */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                            {/* 범례 + 통계 */}
                            <div style={legend}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {[0, 0.25, 0.5, 0.75, 1].map(r => (
                                        <div key={r} style={{
                                            width: 18, height: 14, borderRadius: 2,
                                            background: cellBg(r * maxFlow + (r === 0 ? 0 : 0.01)),
                                            border: '1px solid rgba(255,255,255,0.06)',
                                        }}/>
                                    ))}
                                    <span style={{ fontSize: 10, color: '#444', marginLeft: 2 }}>
                                        0 → {maxFlow.toLocaleString()}
                                    </span>
                                </div>
                                <span style={{ fontSize: 11, color: '#444' }}>
                                    {currentMatrix
                                        ? `${matrix.sources.length} 출발지 × ${matrix.sinks.length} 도착지`
                                        : ''}
                                </span>
                            </div>

                            {/* 매트릭스 테이블 */}
                            <div
                                style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}
                                onClick={e => {
                                    if ((e.target as HTMLElement).tagName !== 'INPUT') commitEdit();
                                }}
                            >
                                {matrix.sources.length === 0 && matrix.sinks.length === 0 ? (
                                    <div style={{ color: '#333', fontSize: 12, padding: '32px 0', textAlign: 'center' }}>
                                        데이터가 없습니다. 출발지와 도착지를 추가하세요.
                                    </div>
                                ) : (
                                    <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                                        <thead>
                                            <tr>
                                                {/* 좌상단 코너 */}
                                                <th style={{ ...th, ...stickyTL, width: 110 }}>
                                                    <span style={{ fontSize: 10, color: '#333' }}>출발↓ / 도착→</span>
                                                </th>

                                                {/* 도착지 헤더 */}
                                                {matrix.sinks.map(snk => (
                                                    <th key={snk} style={{ ...th, ...stickyTop, minWidth: 72 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                            <span style={{ color: '#7aa2ff', fontFamily: 'monospace', fontSize: 11 }}>
                                                                {snk}
                                                            </span>
                                                            <button
                                                                onClick={e => { e.stopPropagation(); deleteSink(snk); }}
                                                                style={delBtn}
                                                                title="열 삭제"
                                                            >×</button>
                                                        </div>
                                                    </th>
                                                ))}

                                                {/* + 도착지 */}
                                                <th style={{ ...th, ...stickyTop, width: 130 }}>
                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                        <input
                                                            value={newSnkInput}
                                                            onChange={e => setNewSnkInput(e.target.value)}
                                                            onKeyDown={e => e.key === 'Enter' && addSink()}
                                                            onClick={e => e.stopPropagation()}
                                                            placeholder="도착지 ID"
                                                            style={addInput}
                                                        />
                                                        <button onClick={e => { e.stopPropagation(); addSink(); }} style={addBtn}>+</button>
                                                    </div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrix.sources.map((src, ri) => (
                                                <tr key={src}>
                                                    {/* 출발지 헤더 */}
                                                    <td style={{ ...td, ...stickyLeft, background: 'rgba(12,14,26,0.98)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                                            <span style={{ color: '#f5a623', fontFamily: 'monospace', fontSize: 11 }}>
                                                                {src}
                                                            </span>
                                                            <button
                                                                onClick={e => { e.stopPropagation(); deleteSource(src); }}
                                                                style={delBtn}
                                                                title="행 삭제"
                                                            >×</button>
                                                        </div>
                                                    </td>

                                                    {/* flow 셀 */}
                                                    {matrix.sinks.map(snk => {
                                                        const key  = cellKey(src, snk);
                                                        const flow = matrix.flowMap.get(key) ?? 0;
                                                        const isEditing = editCell?.src === src && editCell?.snk === snk;
                                                        return (
                                                            <td
                                                                key={snk}
                                                                onClick={e => { e.stopPropagation(); startEdit(src, snk); }}
                                                                style={{
                                                                    ...td,
                                                                    background: isEditing ? 'rgba(65,105,225,0.22)' : cellBg(flow),
                                                                    border: isEditing
                                                                        ? '1px solid rgba(100,140,255,0.6)'
                                                                        : `1px solid rgba(255,255,255,${flow > 0 ? '0.06' : '0.03'})`,
                                                                    cursor: 'text',
                                                                    textAlign: 'right',
                                                                    padding: '0 6px',
                                                                    minWidth: 72, height: 28,
                                                                    transition: 'background 0.1s',
                                                                }}
                                                            >
                                                                {isEditing ? (
                                                                    <input
                                                                        ref={editInputRef}
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={e => setEditValue(e.target.value)}
                                                                        onBlur={commitEdit}
                                                                        onKeyDown={e => {
                                                                            if (e.key === 'Enter') commitEdit();
                                                                            if (e.key === 'Escape') setEditCell(null);
                                                                        }}
                                                                        onClick={e => e.stopPropagation()}
                                                                        style={{
                                                                            width: '100%', background: 'transparent',
                                                                            border: 'none', outline: 'none',
                                                                            color: '#ddd', fontSize: 12,
                                                                            textAlign: 'right', fontFamily: 'monospace',
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <span style={{
                                                                        fontFamily: 'monospace',
                                                                        color: flow > 0
                                                                            ? (flow / maxFlow > 0.6 ? '#ffe0a0' : '#aac4ee')
                                                                            : '#2a2a35',
                                                                        fontSize: 12,
                                                                    }}>
                                                                        {flow > 0 ? formatFlow(flow) : '·'}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    <td style={td} />
                                                </tr>
                                            ))}

                                            {/* + 출발지 행 */}
                                            <tr>
                                                <td style={{ ...td, ...stickyLeft, background: 'rgba(12,14,26,0.98)', paddingTop: 6 }}>
                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                        <input
                                                            value={newSrcInput}
                                                            onChange={e => setNewSrcInput(e.target.value)}
                                                            onKeyDown={e => e.key === 'Enter' && addSource()}
                                                            onClick={e => e.stopPropagation()}
                                                            placeholder="출발지 ID"
                                                            style={addInput}
                                                        />
                                                        <button onClick={e => { e.stopPropagation(); addSource(); }} style={addBtn}>+</button>
                                                    </div>
                                                </td>
                                                {matrix.sinks.map(snk => <td key={snk} style={td} />)}
                                                <td style={td} />
                                            </tr>
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ── 서브 컴포넌트 ── */
const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13, ...style }}>
        {children}
    </div>
);

/* ── 스타일 ── */
const ov:    React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400 };
const panel: React.CSSProperties = { background: 'rgba(12,14,26,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.8)', width: '88vw', maxWidth: 1200, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const hdr:   React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 };
const badge: React.CSSProperties = { fontSize: 10, color: '#445', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4, padding: '2px 7px' };
const saveBtn = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 16px', fontSize: 12, borderRadius: 5, cursor: disabled ? 'default' : 'pointer', fontWeight: 600, transition: 'all 0.15s',
    background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(65,105,225,0.22)',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : 'rgba(100,140,255,0.5)'}`,
    color: disabled ? '#444' : '#8ab4ff',
});
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1 };
const sidebar:   React.CSSProperties = { width: 170, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 3 };
const sideTitle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#3a3a3a', letterSpacing: '0.6px', textTransform: 'uppercase', padding: '2px 6px 8px' };
const legend:    React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 };
const tabItem = (active: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', gap: 2, transition: 'all 0.15s', textAlign: 'left',
    background: active ? 'rgba(65,105,225,0.16)' : 'rgba(255,255,255,0.02)',
    border: `1px solid ${active ? 'rgba(100,140,255,0.3)' : 'rgba(255,255,255,0.04)'}`,
});

// 테이블 셀 스타일
const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 11, color: '#556', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.07)', whiteSpace: 'nowrap', background: 'rgba(12,14,26,0.98)' };
const td: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.03)', verticalAlign: 'middle' };
const stickyTop: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2 };
const stickyLeft: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2, padding: '4px 8px', whiteSpace: 'nowrap', minWidth: 110 };
const stickyTL:   React.CSSProperties = { position: 'sticky', top: 0, left: 0, zIndex: 3 };
const delBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '1px 3px', borderRadius: 3 };
const addInput: React.CSSProperties = { width: 80, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#888', fontSize: 11, padding: '3px 6px', outline: 'none' };
const addBtn: React.CSSProperties = { background: 'rgba(65,105,225,0.15)', border: '1px solid rgba(100,140,255,0.3)', borderRadius: 4, color: '#7aa2ff', cursor: 'pointer', fontSize: 13, padding: '2px 6px', lineHeight: 1 };

export default OdMatrixModal;
