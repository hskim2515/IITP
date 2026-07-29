import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSignalStore, useSignalHistoryStore } from "@stores/useSignalStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useMessageStore } from "@stores/useMessageStore";
import { featureUpdateLogs } from "@utils/history";
import { checkManualSignalEditConflicts, SignalPhaseConflict } from "@utils/signal";
import { extractFeatureTypeFromGuid } from "@utils/guid";
import { deleteSignalsForNodes, generateSignalsForNode } from "@hooks/useNetworkSelect";

/** 상충 경고를 사용자에게 보여주고 계속 저장할지 확인받는다. */
function confirmSignalConflicts(conflicts: SignalPhaseConflict[]): boolean {
    if (conflicts.length === 0) return true;
    const lines = conflicts.map(c =>
        `· 현시 ${c.phaseId}: 접근로 "${c.myFromLink}" ↔ "${c.conflictingFromLink}"(turn ${c.conflictingTurnId})가 같은 현시에서 동시 녹색이 됩니다 (마주보지 않는 방향)`
    );
    return window.confirm(
        `⚠️ 양방향 사고 위험 감지 — 서로 마주보지 않는 접근로가 같은 현시에서 동시에 녹색이 됩니다.\n\n${lines.join("\n")}\n\n그래도 저장하시겠습니까?`
    );
}

/* ─────────────────────────── 타입 ────────────────────────────── */
interface SignalRecord {
    __guid: string;
    featureType: string;
    nodeId: string;
    turning: string | null;
    type: string | null;
    connectionId: string | null;
    [key: string]: any;
}

/* ──────────────────── 방향 메타 ────────────────────────────────── */
const DIR = [
    { key: "Straight",   label: "직진",   icon: "↑", color: "#4f8ef7" },
    { key: "Left_Turn",  label: "좌회전", icon: "↰", color: "#4fc97a" },
    { key: "Right_Turn", label: "우회전", icon: "↱", color: "#f7c44f" },
    { key: "U_Turn",     label: "유턴",   icon: "↩", color: "#b04ff7" },
] as const;
type DirKey = typeof DIR[number]["key"];
const DIR_ORDER: string[] = DIR.map(d => d.key);

/** XML 단축코드(S/L/R/U) → DIR 키로 정규화 */
const TURNING_NORMALIZE: Record<string, string> = {
    S: "Straight", L: "Left_Turn", R: "Right_Turn", U: "U_Turn",
};
function normalizeTurning(t: string | null | undefined): string | null {
    if (!t) return null;
    return TURNING_NORMALIZE[t] ?? t;
}

function dirMeta(key: string | null) {
    return DIR.find(d => d.key === key) ?? { label: key ?? "—", icon: "?", color: "#556" };
}

/* ─────────────────────── 신호 행 ───────────────────────────────── */
interface RowProps {
    sig: SignalRecord;
    isSelected: boolean;
    rowRef: (el: HTMLTableRowElement | null) => void;
    onSave: (s: SignalRecord) => void;
    onDelete: () => void;
    onValidate: (candidate: SignalRecord) => SignalPhaseConflict[];
}

const SignalRow: React.FC<RowProps> = ({ sig, isSelected, rowRef, onSave, onDelete, onValidate }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState({ turning: sig.turning ?? "", type: sig.type ?? "", connectionId: sig.connectionId ?? "" });
    const meta = dirMeta(sig.turning);

    const startEdit = () => {
        // setDraft/setEditing 을 먼저 배치 → 이후 외부 스토어 업데이트
        setDraft({ turning: sig.turning ?? DIR[0]!.key, type: sig.type ?? "", connectionId: sig.connectionId ?? "" });
        setEditing(true);
        // 렌더 후 지도 하이라이트 (외부 스토어가 React 배치보다 앞서 flush되지 않도록 setTimeout)
        setTimeout(() => useSelectionStore.getState().setSelectedGuid([sig.__guid]), 0);
    };
    const save = () => {
        const updated = { ...sig, turning: draft.turning || null, type: draft.type || null, connectionId: draft.connectionId || null };
        if (!confirmSignalConflicts(onValidate(updated))) return;
        onSave(updated);
        setEditing(false);
    };
    const cancel = () => {
        setDraft({ turning: sig.turning ?? DIR[0]!.key, type: sig.type ?? "", connectionId: sig.connectionId ?? "" });
        setEditing(false);
    };

    if (editing) {
        return (
            <tr ref={rowRef} style={{ background: "#0c1322" }}>
                <td style={td}>
                    <select value={draft.turning} onChange={e => setDraft(d => ({ ...d, turning: e.target.value }))} style={sel} autoFocus>
                        {DIR.map(d => <option key={d.key} value={d.key}>{d.icon} {d.label}</option>)}
                    </select>
                </td>
                <td style={td}>
                    <input value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} placeholder="type" style={inp} />
                </td>
                <td style={td}>
                    <input value={draft.connectionId} onChange={e => setDraft(d => ({ ...d, connectionId: e.target.value }))} placeholder="connection ID" style={inp} />
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={save} style={btnS("#4f8ef7")}>저장</button>
                    <button onClick={cancel} style={{ ...btnS("#2a3050"), marginLeft: 4 }}>취소</button>
                </td>
            </tr>
        );
    }

    return (
        <tr
            ref={rowRef}
            className="signal-data-row"
            onClick={startEdit}
            style={{
                cursor: "pointer",
                borderBottom: "1px solid #0d1020",
                background: isSelected ? "#0d1e3a" : undefined,
                outline: isSelected ? "1px solid #4f8ef755" : undefined,
                outlineOffset: "-1px",
            }}
        >
            <td style={td}>
                <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    background: meta.color + "18", border: `1px solid ${meta.color}44`,
                    borderRadius: 5, padding: "2px 10px",
                    color: meta.color, fontSize: 12, fontWeight: 600,
                }}>
                    <span style={{ fontSize: 14 }}>{meta.icon}</span>{meta.label}
                </span>
            </td>
            <td style={{ ...td, color: "#556", fontSize: 12 }}>
                {sig.type || <span style={{ color: "#222" }}>—</span>}
            </td>
            <td style={{ ...td, color: "#7aa2ff", fontSize: 12, fontFamily: "monospace" }}>
                {sig.connectionId || <span style={{ color: "#222", fontFamily: "sans-serif" }}>—</span>}
            </td>
            <td style={{ ...td, textAlign: "right" }}>
                <button onClick={e => { e.stopPropagation(); onDelete(); }}
                    className="del-btn"
                    style={{ ...btnS("transparent"), color: "#c0392b", fontSize: 13, padding: "1px 6px" }}>✕</button>
            </td>
        </tr>
    );
};

/* ───────────────────── 신호 추가 행 ────────────────────────────── */
interface AddRowProps {
    nodeId: string;
    onAdd: (s: Omit<SignalRecord, "__guid">) => void;
    onCancel: () => void;
    onValidate: (candidate: SignalRecord) => SignalPhaseConflict[];
}

const AddRow: React.FC<AddRowProps> = ({ nodeId, onAdd, onCancel, onValidate }) => {
    const [draft, setDraft] = useState({ turning: "Straight" as DirKey, type: "", connectionId: "" });
    const add = () => {
        const candidate = { featureType: "signals", nodeId, turning: draft.turning, type: draft.type || null, connectionId: draft.connectionId || null } as unknown as SignalRecord;
        if (!confirmSignalConflicts(onValidate(candidate))) return;
        onAdd(candidate);
    };
    return (
        <tr style={{ background: "#090e1a" }}>
            <td style={td}>
                <select value={draft.turning} onChange={e => setDraft(d => ({ ...d, turning: e.target.value as DirKey }))} style={sel} autoFocus>
                    {DIR.map(d => <option key={d.key} value={d.key}>{d.icon} {d.label}</option>)}
                </select>
            </td>
            <td style={td}>
                <input value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} placeholder="type" style={inp} />
            </td>
            <td style={td}>
                <input value={draft.connectionId} onChange={e => setDraft(d => ({ ...d, connectionId: e.target.value }))} placeholder="connection ID" style={inp} />
            </td>
            <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                <button onClick={add} style={btnS("#4fc97a")}>추가</button>
                <button onClick={onCancel} style={{ ...btnS("#2a3050"), marginLeft: 4 }}>취소</button>
            </td>
        </tr>
    );
};

/* ─────────────────────── 메인 컴포넌트 ─────────────────────────── */
const SignalGroupedEditor: React.FC<{ containerHeight?: number }> = ({ containerHeight = 400 }) => {
    const rawData = useSignalStore((s: any) => s.currentJsonData) as { signals?: SignalRecord[] } | undefined;
    const signals: SignalRecord[] = useMemo(() =>
        (rawData?.signals ?? []).map((s: SignalRecord) => ({
            ...s,
            turning: normalizeTurning(s.turning),
        })),
    [rawData]);

    // 사용자가 탭을 직접 클릭했을 때만 사용 (지도 클릭은 여기를 바꾸지 않음)
    const [manualNodeId, setManualNodeId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [addingTo, setAddingTo] = useState<string | null>(null);

    // 지도 선택 sync
    const selectedGuid = useSelectionStore(s => s.selectedGuid[0] as string | undefined);
    const network = useNetworkStore(s => s.currentJsonData);
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

    /* 노드 그룹 */
    const nodeGroups = useMemo(() => {
        const map = new Map<string, SignalRecord[]>();
        for (const s of signals) {
            const id = String(s.nodeId ?? "?");
            if (!map.has(id)) map.set(id, []);
            map.get(id)!.push(s);
        }
        for (const [, sigs] of map) {
            sigs.sort((a, b) => {
                const ai = DIR_ORDER.indexOf(a.turning ?? "");
                const bi = DIR_ORDER.indexOf(b.turning ?? "");
                return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            });
        }
        return map;
    }, [signals]);

    /* 지도에서 클릭된 게 기존 신호면 그 신호의 nodeId, 교차로(노드)면 그 노드의 id —
     * 신호가 아직 하나도 없는 교차로도 노드 클릭만으로 바로 탭을 열 수 있어야
     * "교차로를 통째로 선택해서 신호를 추가/삭제"가 가능해진다(신호 마커가 없으면
     * 지도에서 골라낼 방법이 없었던 기존 공백 보완). */
    const mapNodeId = useMemo(() => {
        if (!selectedGuid) return null;
        const sig = signals.find(s => s.__guid === selectedGuid);
        if (sig) return String(sig.nodeId ?? "?");
        if (extractFeatureTypeFromGuid(selectedGuid) !== "nodes") return null;
        const node = (network?.nodes ?? []).find((n: any) => n.__guid === selectedGuid);
        return node?.id != null ? String(node.id) : null;
    }, [selectedGuid, signals, network]);

    const nodeIds = useMemo(() => {
        const ids = Array.from(nodeGroups.keys());
        if (mapNodeId && !ids.includes(mapNodeId)) ids.unshift(mapNodeId);
        const q = search.trim().toLowerCase();
        return q ? ids.filter(id => id.toLowerCase().includes(q)) : ids;
    }, [nodeGroups, search, mapNodeId]);

    /* activeId: 지도 클릭(신호든 노드든) > 탭 직접 클릭 > 첫 번째 노드 순서로 결정 */
    const activeId = useMemo(() => {
        if (mapNodeId) return mapNodeId;
        if (manualNodeId && nodeGroups.has(manualNodeId)) return manualNodeId;
        return nodeIds[0] ?? null;
    }, [mapNodeId, manualNodeId, nodeGroups, nodeIds]);

    const activeSignals: SignalRecord[] = activeId ? (nodeGroups.get(activeId) ?? []) : [];

    /* 지도 클릭 → 해당 행으로 스크롤 (state 변경 없음 → 재렌더 없음) */
    useEffect(() => {
        if (!selectedGuid) return;
        setTimeout(() => {
            rowRefs.current.get(selectedGuid)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 60);
    }, [selectedGuid]);

    /* 스토어 조작 */
    const updateSignal = useCallback((updated: SignalRecord) => {
        useSignalStore.getState().updateCurrentJsonData(updated, useSignalHistoryStore);
    }, []);
    const deleteSignal = useCallback((guid: string) => {
        useSignalStore.getState().removeRecordsByGuid([guid], useSignalHistoryStore);
    }, []);
    const addSignal = useCallback((partial: Omit<SignalRecord, "__guid">) => {
        const all = rawData?.signals ?? [];
        const newSig: SignalRecord = {
            featureType: "signals", nodeId: "", turning: null, type: null, connectionId: null,
            ...partial, __guid: `signals-${all.length}`,
        };
        useSignalStore.getState().updateCurrentJsonData(newSig, useSignalHistoryStore);
        featureUpdateLogs(useSignalHistoryStore, { guid: newSig.__guid, updateType: "added", properties: newSig });
        setAddingTo(null);
    }, [rawData]);

    /* "전체 삭제" — 이 교차로의 신호를 한 번에 전부 지운다. 지도 편집(NetworkEditToolbar)의
     * 노드 컨텍스트 바 "🗑 신호 삭제"와 동일한 deleteSignalsForNodes를 공유 — 신호 TOD의
     * 관련 노드 항목도 함께 정리된다. window.confirm 대신 앱 공통 모달(MessagePopup)을 쓴다
     * (네이티브 브라우저 다이얼로그는 이 앱의 다른 삭제 확인들과 스타일이 어긋난다). */
    const deleteAllForNode = useCallback((nodeId: string) => {
        const count = (nodeGroups.get(nodeId) ?? []).length;
        if (!count) return;
        useMessageStore.getState().setMessage({
            type: "confirm",
            text: `이 교차로(#${nodeId})의 신호 ${count}건을 모두 삭제하시겠습니까?`,
            onConfirm: () => deleteSignalsForNodes([nodeId]),
        });
    }, [nodeGroups]);

    /* "자동 생성" — 네트워크 토폴로지(접근로/방위각) 기준으로 이 교차로의 신호 세트를
     * 통째로 (재)생성한다. 지도 편집(NetworkEditToolbar)의 "⚡ 신호 생성"과 동일한
     * generateSignalsForNode를 공유(iitp-rest DummySignalGenerator와도 같은 판정) —
     * 조건 미충족(접근로 2개 미만 등)이면 null이라 알림만 띄우고 아무것도 만들지 않는다.
     * 기존 신호가 있으면 확인 후 전부 지우고 새로 채운다(부분 병합이 아니라 항상
     * "이 교차로의 완전한 신호 세트로 교체"가 목표). */
    const autoGenerateForNode = useCallback((nodeId: string) => {
        if (!network) return;
        const existing = nodeGroups.get(nodeId) ?? [];
        const run = () => {
            const count = generateSignalsForNode(network, nodeId);
            if (count == null) {
                useMessageStore.getState().setMessage({
                    type: "alert",
                    text: "이 교차로는 신호 생성 조건(접근로 2개 이상 등)을 충족하지 않습니다.",
                    onClose: () => {},
                });
            }
        };
        if (existing.length > 0) {
            useMessageStore.getState().setMessage({
                type: "confirm",
                text: `이 교차로(#${nodeId})의 기존 신호 ${existing.length}건을 삭제하고 새로 생성하시겠습니까?`,
                onConfirm: run,
            });
        } else {
            run();
        }
    }, [network, nodeGroups]);

    /* 양방향 사고 위험(상충) 검사 — 현재 노드의 신호 목록 + 네트워크 방위각 기준 */
    const validateConflicts = useCallback((candidate: SignalRecord): SignalPhaseConflict[] => {
        if (!network) return [];
        return checkManualSignalEditConflicts(network, activeSignals as any, candidate as any);
    }, [activeSignals, network]);

    if (!signals.length && !mapNodeId) {
        return <div style={{ color: "#445", padding: 40, textAlign: "center", fontSize: 13 }}>
            신호 데이터가 없습니다. 지도에서 교차로(노드)를 클릭하면 여기서 바로 신호를 추가할 수 있습니다.
        </div>;
    }

    const bodyH = containerHeight - 56;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: bodyH, overflow: "hidden" }}>

            {/* ── 상단 탭 바 ── */}
            <div style={{
                display: "flex", alignItems: "stretch",
                borderBottom: "1px solid #1a1e30", flexShrink: 0,
                background: "#080c18", overflow: "hidden",
            }}>
                {/* 검색 */}
                <div style={{ padding: "6px 8px", flexShrink: 0, display: "flex", alignItems: "center", borderRight: "1px solid #1a1e30" }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="교차로 검색"
                        style={{
                            background: "#0e1525", border: "1px solid #1e2540",
                            borderRadius: 4, color: "#aabbcc", padding: "3px 8px",
                            fontSize: 11, width: 90, outline: "none",
                        }}
                    />
                </div>

                {/* 탭 목록 */}
                <div style={{ flex: 1, display: "flex", alignItems: "stretch", overflowX: "auto", scrollbarWidth: "none" }}>
                    {nodeIds.map(nid => {
                        const isActive = nid === activeId;
                        // 지도에서 방금 클릭한 노드가 아직 신호 0건이면 nodeGroups에 없을 수 있다
                        // (mapNodeId를 nodeIds에 강제로 끼워 넣는 케이스) — ?? []로 안전 처리.
                        const nodeSigs = nodeGroups.get(nid) ?? [];
                        const dirDots = DIR.filter(d => nodeSigs.some(s => s.turning === d.key));
                        return (
                            <button
                                key={nid}
                                onClick={() => { setManualNodeId(nid); setAddingTo(null); }}
                                style={{
                                    padding: "0 14px",
                                    background: isActive ? "#141c30" : "none",
                                    border: "none",
                                    borderBottom: `2px solid ${isActive ? "#4f8ef7" : "transparent"}`,
                                    color: isActive ? "#c0d4f0" : "#445",
                                    cursor: "pointer", fontSize: 11,
                                    whiteSpace: "nowrap",
                                    display: "flex", alignItems: "center", gap: 5,
                                    flexShrink: 0, fontWeight: isActive ? 600 : 400,
                                }}
                            >
                                #{nid}
                                <span style={{ display: "flex", gap: 2 }}>
                                    {dirDots.map(d => (
                                        <span key={d.key} style={{
                                            width: 5, height: 5, borderRadius: "50%",
                                            background: isActive ? d.color : d.color + "55",
                                            display: "inline-block",
                                        }} />
                                    ))}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* 교차로 단위 일괄 조작 */}
                {activeId && (
                    <>
                        <button
                            onClick={() => autoGenerateForNode(activeId)}
                            title="이 교차로의 신호를 토폴로지 기준으로 통째로 생성/재생성"
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid #1a1e30",
                                color: "#4f8ef7", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
                            }}
                        >⚡ 자동 생성</button>
                        <button
                            onClick={() => deleteAllForNode(activeId)}
                            disabled={activeSignals.length === 0}
                            title="이 교차로의 신호를 한 번에 전부 삭제"
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid #1a1e30",
                                color: activeSignals.length === 0 ? "#334" : "#c0392b",
                                cursor: activeSignals.length === 0 ? "default" : "pointer",
                                fontSize: 12, whiteSpace: "nowrap",
                            }}
                        >🗑 전체 삭제</button>
                        <button
                            onClick={() => setAddingTo(activeId)}
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid #1a1e30",
                                color: "#4fc97a", cursor: "pointer", fontSize: 12,
                            }}
                        >+ 추가</button>
                    </>
                )}
            </div>

            {/* ── 테이블 ── */}
            {activeId ? (
                <div style={{ flex: 1, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <colgroup>
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "18%" }} />
                            <col />
                            <col style={{ width: "80px" }} />
                        </colgroup>
                        <thead>
                            <tr style={{ background: "#060910" }}>
                                <th style={th}>방향</th>
                                <th style={th}>Type</th>
                                <th style={th}>Connection ID</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeSignals.map(sig => (
                                <SignalRow
                                    key={sig.__guid}
                                    sig={sig}
                                    isSelected={selectedGuid === sig.__guid}
                                    rowRef={el => {
                                        if (el) rowRefs.current.set(sig.__guid, el);
                                        else rowRefs.current.delete(sig.__guid);
                                    }}
                                    onSave={updateSignal}
                                    onDelete={() => deleteSignal(sig.__guid)}
                                    onValidate={validateConflicts}
                                />
                            ))}
                            {addingTo === activeId && (
                                <AddRow nodeId={activeId} onAdd={addSignal} onCancel={() => setAddingTo(null)} onValidate={validateConflicts} />
                            )}
                            {activeSignals.length === 0 && addingTo !== activeId && (
                                <tr><td colSpan={4} style={{ padding: "24px", textAlign: "center", color: "#334", fontSize: 12 }}>
                                    이 교차로에 등록된 신호가 없습니다.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#334", fontSize: 12 }}>
                    상단 탭에서 교차로를 선택하세요.
                </div>
            )}

            <style>{`
                tr.signal-data-row:hover { background: #0f1828 !important; }
                .del-btn { opacity: 0; transition: opacity 0.15s; }
                tr.signal-data-row:hover .del-btn { opacity: 1; }
            `}</style>
        </div>
    );
};

/* ── 공통 스타일 ── */
const th: React.CSSProperties = {
    textAlign: "left", padding: "6px 12px",
    fontSize: 11, color: "#334", fontWeight: 600,
    borderBottom: "1px solid #1a1e30",
    position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "6px 12px", verticalAlign: "middle" };
const inp: React.CSSProperties = {
    background: "#0e1525", border: "1px solid #2a3050", borderRadius: 4,
    color: "#c0d4f0", padding: "4px 8px", fontSize: 11,
    width: "100%", boxSizing: "border-box", outline: "none",
};
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const btnS = (bg: string): React.CSSProperties => ({
    background: bg, border: "none", borderRadius: 4,
    color: bg === "transparent" ? undefined : "#fff",
    padding: "3px 10px", cursor: "pointer", fontSize: 11,
});

export default SignalGroupedEditor;
