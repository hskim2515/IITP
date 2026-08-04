import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useMenuStore } from '@stores/useMenuStore';
import type { PassengerDemandEntry } from '@type/Passenger';

const MENU_CODE = 'PASSENGER';

/* ── 매트릭스 내부 상태 (OdMatrixModal과 동일 패턴, source/sink → origin/dest) ── */
interface MatrixState {
    origins: string[];
    dests:   string[];
    flowMap: Map<string, number>;   // cellKey → flow
    distMap: Map<string, string>;   // cellKey → dist
}

const cellKey = (o: string, d: string) => `${o}||${d}`;

function demandsToMatrix(demands: PassengerDemandEntry[]): MatrixState {
    const origins = [...new Set(demands.map(d => d.origin))].filter(Boolean);
    const dests   = [...new Set(demands.map(d => d.dest))].filter(Boolean);
    const flowMap = new Map<string, number>();
    const distMap = new Map<string, string>();
    for (const d of demands) {
        if (!d.origin || !d.dest) continue;
        flowMap.set(cellKey(d.origin, d.dest), d.flow);
        if (d.dist) distMap.set(cellKey(d.origin, d.dest), d.dist);
    }
    return { origins, dests, flowMap, distMap };
}

function matrixToDemands(m: MatrixState): PassengerDemandEntry[] {
    const out: PassengerDemandEntry[] = [];
    m.flowMap.forEach((flow, key) => {
        const [origin, dest] = key.split('||');
        if (origin && dest && (flow ?? 0) > 0) {
            out.push({ origin, dest, flow, dist: m.distMap.get(key) ?? '' });
        }
    });
    return out;
}

function formatFlow(v: number): string {
    if (v === 0) return '';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/* ── 컴포넌트 ── */
const PassengerModal: React.FC = () => {
    const closeSession = useWorkflowStore((s: any) => s.closeSession) as (code: string) => void;
    const setActiveSubmenu = useMenuStore((s) => s.setActiveSubmenu);
    const versionId    = useScenarioStore((s) => s.selectedScenarioVersion)?.key ?? '';

    // OdMatrixModal과 동일하게, 이 모달은 자체 닫기 버튼만 있어 activeSubmenu 동기화를
    // 직접 해주지 않으면 지도 클릭 선택이 영구히 무시된다.
    const handleClose = useCallback(() => {
        closeSession(MENU_CODE);
        const state = useWorkflowStore.getState() as any;
        const next = (state.sessions as any[]).find((s: any) => s.menuCode === state.activeMenuCode);
        setActiveSubmenu(next?.menu ?? null);
    }, [closeSession, setActiveSubmenu]);

    const [loading, setLoading] = useState(true);
    const [saving,  setSaving]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);
    const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const [matrix, setMatrix] = useState<MatrixState>({ origins: [], dests: [], flowMap: new Map(), distMap: new Map() });

    // 인라인 셀 편집
    const [editCell,  setEditCell]  = useState<{ o: string; d: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const editInputRef = useRef<HTMLInputElement>(null);

    // 새 행/열 추가 입력
    const [newOriginInput, setNewOriginInput] = useState('');
    const [newDestInput,   setNewDestInput]   = useState('');

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
        axiosInstance.get(`/passenger/${versionId}`)
            .then(res => {
                const demands: PassengerDemandEntry[] = (res.data.odPax?.demands ?? []).map((d: any) => ({
                    origin: d.origin ?? '', dest: d.dest ?? '',
                    flow: d.flow ?? 0, dist: d.dist ?? '',
                }));
                setMatrix(demandsToMatrix(demands));
            })
            .catch(e => {
                if (e?.response?.status === 404) {
                    // passenger.xml 이 아직 없는 버전 — 신규 작성 시작
                    setMatrix(demandsToMatrix([]));
                } else {
                    setError(e.message ?? '불러오기 실패');
                }
            })
            .finally(() => setLoading(false));
    }, [versionId]);

    /* ── 셀 클릭 → 편집 ── */
    const startEdit = (o: string, d: string) => {
        const v = matrix.flowMap.get(cellKey(o, d)) ?? 0;
        setEditCell({ o, d });
        setEditValue(v === 0 ? '' : String(v));
        setTimeout(() => editInputRef.current?.select(), 0);
    };

    const commitEdit = () => {
        if (!editCell) return;
        const flow = parseFloat(editValue) || 0;
        const key  = cellKey(editCell.o, editCell.d);
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            if (flow > 0) fm.set(key, flow); else fm.delete(key);
            return { ...prev, flowMap: fm };
        });
        setEditCell(null);
    };

    /* ── 행 삭제 (출발지) ── */
    const deleteOrigin = (o: string) => {
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            const dm = new Map(prev.distMap);
            prev.dests.forEach(d => { const k = cellKey(o, d); fm.delete(k); dm.delete(k); });
            return { ...prev, origins: prev.origins.filter(x => x !== o), flowMap: fm, distMap: dm };
        });
    };

    /* ── 열 삭제 (도착지) ── */
    const deleteDest = (d: string) => {
        setMatrix(prev => {
            const fm = new Map(prev.flowMap);
            const dm = new Map(prev.distMap);
            prev.origins.forEach(o => { const k = cellKey(o, d); fm.delete(k); dm.delete(k); });
            return { ...prev, dests: prev.dests.filter(x => x !== d), flowMap: fm, distMap: dm };
        });
    };

    /* ── 행 추가 ── */
    const addOrigin = () => {
        const v = newOriginInput.trim();
        if (!v || matrix.origins.includes(v)) return;
        setMatrix(prev => ({ ...prev, origins: [...prev.origins, v] }));
        setNewOriginInput('');
    };

    /* ── 열 추가 ── */
    const addDest = () => {
        const v = newDestInput.trim();
        if (!v || matrix.dests.includes(v)) return;
        setMatrix(prev => ({ ...prev, dests: [...prev.dests, v] }));
        setNewDestInput('');
    };

    /* ── 저장 ── */
    const handleSave = useCallback(async (): Promise<boolean> => {
        if (!versionId) return false;
        const demands = matrixToDemands(matrixRef.current);
        const payload = {
            odPax: {
                demands: demands.map(d => ({
                    origin: d.origin, dest: d.dest, flow: d.flow, dist: d.dist ?? '',
                })),
            },
        };
        setSaving(true);
        try {
            await axiosInstance.post(`/passenger/${versionId}`, {
                data: payload,
                logs: { added: [], modified: [], deleted: [] },
            });
            setSaveMsg({ ok: true, text: '저장 완료' });
            return true;
        } catch (e: any) {
            setSaveMsg({ ok: false, text: e.message ?? '저장 실패' });
            return false;
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMsg(null), 2500);
        }
    }, [versionId]);

    /* ── 셀 색상 ── */
    const cellBg = (flow: number) => {
        if (!flow) return 'transparent';
        const ratio = Math.min(flow / maxFlow, 1);
        const r = Math.round(40  + ratio * 215);
        const g = Math.round(100 - ratio * 50);
        const b = Math.round(225 - ratio * 200);
        return `rgba(${r},${g},${b},${0.15 + ratio * 0.55})`;
    };

    return (
        <div style={ov}>
            <div style={panel}>

                {/* ── 헤더 ── */}
                <div style={hdr}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                            PASSENGER 승객 수요 편집
                        </span>
                        {versionId && (
                            <span style={badge}>{versionId}</span>
                        )}
                        {saveMsg && (
                            <span style={{
                                fontSize: 11, borderRadius: 5, padding: '3px 10px',
                                color:       saveMsg.ok ? 'var(--color-success)' : 'var(--color-danger)',
                                background:  saveMsg.ok ? 'rgba(var(--color-success-rgb), 0.08)' : 'rgba(var(--color-danger-rgb), 0.1)',
                                border: `1px solid ${saveMsg.ok ? 'rgba(var(--color-success-rgb), 0.25)' : 'rgba(var(--color-danger-rgb), 0.25)'}`,
                            }}>
                                {saveMsg.text}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={handleSave} disabled={saving || loading} style={saveBtn(saving || loading)}>
                            {saving ? '저장 중…' : '저장'}
                        </button>
                        <button onClick={handleClose} style={closeBtn}>✕</button>
                    </div>
                </div>

                {/* ── 상태 ── */}
                {loading && <Center>불러오는 중…</Center>}
                {!loading && error && <Center style={{ color: 'var(--color-danger)' }}>{error}</Center>}

                {/* ── 본문 ── */}
                {!loading && !error && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                        {/* 범례 + 통계 */}
                        <div style={legend}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {[0, 0.25, 0.5, 0.75, 1].map(r => (
                                    <div key={r} style={{
                                        width: 18, height: 14, borderRadius: 2,
                                        background: cellBg(r * maxFlow + (r === 0 ? 0 : 0.01)),
                                        border: '1px solid rgba(var(--overlay-rgb), 0.06)',
                                    }}/>
                                ))}
                                <span style={{ fontSize: 10, color: 'var(--text-disabled)', marginLeft: 2 }}>
                                    0 → {maxFlow.toLocaleString()}
                                </span>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>
                                {matrix.origins.length} 출발지 × {matrix.dests.length} 도착지
                            </span>
                        </div>

                        {/* 매트릭스 테이블 */}
                        <div
                            style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}
                            onClick={e => {
                                if ((e.target as HTMLElement).tagName !== 'INPUT') commitEdit();
                            }}
                        >
                            {matrix.origins.length === 0 && matrix.dests.length === 0 && (
                                <div style={{ color: 'var(--text-disabled)', fontSize: 12, padding: '12px 0 6px' }}>
                                    데이터가 없습니다. 도착지/출발지 ID(터미널 노드)를 입력해 추가하세요.
                                </div>
                            )}
                            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...th, ...stickyTL, width: 110 }}>
                                            <span style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.3)' }}>출발↓ / 도착→</span>
                                        </th>

                                        {matrix.dests.map(dest => (
                                            <th key={dest} style={{ ...th, ...stickyTop, minWidth: 72 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                    <span style={{ color: 'var(--accent-text)', fontFamily: 'monospace', fontSize: 11 }}>
                                                        {dest}
                                                    </span>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); deleteDest(dest); }}
                                                        style={delBtn}
                                                        title="열 삭제"
                                                    >×</button>
                                                </div>
                                            </th>
                                        ))}

                                        <th style={{ ...th, ...stickyTop, width: 130 }}>
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <input
                                                    value={newDestInput}
                                                    onChange={e => setNewDestInput(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && addDest()}
                                                    onClick={e => e.stopPropagation()}
                                                    placeholder="도착지 ID"
                                                    style={addInput}
                                                />
                                                <button onClick={e => { e.stopPropagation(); addDest(); }} style={addBtn}>+</button>
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrix.origins.map((origin) => (
                                        <tr key={origin}>
                                            <td style={{ ...td, ...stickyLeft, background: 'rgba(var(--surface-1-rgb), 0.98)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                                    <span style={{ color: 'var(--color-warning)', fontFamily: 'monospace', fontSize: 11 }}>
                                                        {origin}
                                                    </span>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); deleteOrigin(origin); }}
                                                        style={delBtn}
                                                        title="행 삭제"
                                                    >×</button>
                                                </div>
                                            </td>

                                            {matrix.dests.map(dest => {
                                                const key  = cellKey(origin, dest);
                                                const flow = matrix.flowMap.get(key) ?? 0;
                                                const isEditing = editCell?.o === origin && editCell?.d === dest;
                                                return (
                                                    <td
                                                        key={dest}
                                                        onClick={e => { e.stopPropagation(); startEdit(origin, dest); }}
                                                        style={{
                                                            ...td,
                                                            background: isEditing ? 'rgba(var(--accent-rgb), 0.22)' : cellBg(flow),
                                                            border: isEditing
                                                                ? '1px solid rgba(var(--accent-text-rgb), 0.6)'
                                                                : `1px solid rgba(var(--overlay-rgb), ${flow > 0 ? '0.06' : '0.03'})`,
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
                                                                    color: 'var(--text-secondary)', fontSize: 12,
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

                                    <tr>
                                        <td style={{ ...td, ...stickyLeft, background: 'rgba(var(--surface-1-rgb), 0.98)', paddingTop: 6 }}>
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <input
                                                    value={newOriginInput}
                                                    onChange={e => setNewOriginInput(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && addOrigin()}
                                                    onClick={e => e.stopPropagation()}
                                                    placeholder="출발지 ID"
                                                    style={addInput}
                                                />
                                                <button onClick={e => { e.stopPropagation(); addOrigin(); }} style={addBtn}>+</button>
                                            </div>
                                        </td>
                                        {matrix.dests.map(dest => <td key={dest} style={td} />)}
                                        <td style={td} />
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ── 서브 컴포넌트 ── */
const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)', fontSize: 13, ...style }}>
        {children}
    </div>
);

/* ── 스타일 (OdMatrixModal과 동일) ── */
const ov:    React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(var(--surface-overlay-rgb), 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400 };
const panel: React.CSSProperties = { background: 'rgba(var(--surface-1-rgb), 0.98)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 10, boxShadow: '0 20px 60px rgba(var(--surface-overlay-rgb), 0.8)', width: '88vw', maxWidth: 1200, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const hdr:   React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(var(--overlay-rgb), 0.07)', flexShrink: 0 };
const badge: React.CSSProperties = { fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.35)', background: 'rgba(var(--overlay-rgb), 0.04)', border: '1px solid rgba(var(--overlay-rgb), 0.07)', borderRadius: 4, padding: '2px 7px' };
const saveBtn = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 16px', fontSize: 12, borderRadius: 5, cursor: disabled ? 'default' : 'pointer', fontWeight: 600, transition: 'all 0.15s',
    background: disabled ? 'rgba(var(--overlay-rgb), 0.03)' : 'rgba(var(--accent-rgb), 0.22)',
    border: `1px solid ${disabled ? 'rgba(var(--overlay-rgb), 0.08)' : 'rgba(var(--accent-text-rgb), 0.5)'}`,
    color: disabled ? 'var(--text-disabled)' : 'var(--accent-text)',
});
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--text-disabled)', fontSize: 18, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1 };
const legend:    React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: '1px solid rgba(var(--overlay-rgb), 0.04)', flexShrink: 0 };

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.35)', fontWeight: 600, borderBottom: '1px solid rgba(var(--overlay-rgb), 0.07)', whiteSpace: 'nowrap', background: 'rgba(var(--surface-1-rgb), 0.98)' };
const td: React.CSSProperties = { border: '1px solid rgba(var(--overlay-rgb), 0.03)', verticalAlign: 'middle' };
const stickyTop: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2 };
const stickyLeft: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2, padding: '4px 8px', whiteSpace: 'nowrap', minWidth: 110 };
const stickyTL:   React.CSSProperties = { position: 'sticky', top: 0, left: 0, zIndex: 3 };
const delBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'rgba(var(--overlay-rgb), 0.3)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '1px 3px', borderRadius: 3 };
const addInput: React.CSSProperties = { width: 80, background: 'rgba(var(--overlay-rgb), 0.04)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, padding: '3px 6px', outline: 'none' };
const addBtn: React.CSSProperties = { background: 'rgba(var(--accent-rgb), 0.15)', border: '1px solid rgba(var(--accent-text-rgb), 0.3)', borderRadius: 4, color: 'var(--accent-text)', cursor: 'pointer', fontSize: 13, padding: '2px 6px', lineHeight: 1 };

export default PassengerModal;
