import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSignalStore, useSignalHistoryStore } from "@stores/useSignalStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useMessageStore } from "@stores/useMessageStore";
import { featureUpdateLogs } from "@utils/history";
import { checkManualSignalEditConflicts, SignalPhaseConflict } from "@utils/signal";
import { extractFeatureTypeFromGuid } from "@utils/guid";
import { deleteSignalsForNodes, synchronizeSignalsForNode } from "@hooks/useNetworkSelect";
import { buildSignalTurnGroups } from "@utils/signalTurnGroups";

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
    turnId?: string | number | null;
    turning: string | null;
    type: string | null;
    connectionId: string | null;
    [key: string]: any;
}

interface NetworkConnection {
    id: string | number;
    fromLink?: string | number;
    fromLane?: string | number;
    toLink?: string | number;
    toLane?: string | number;
    turning?: string | null;
    [key: string]: any;
}

/* ──────────────────── 방향 메타 ────────────────────────────────── */
const DIR = [
    { key: "Straight",   label: "직진",   icon: "↑", color: "#4f8ef7" },
    { key: "Left_Turn",  label: "좌회전", icon: "↰", color: "#4fc97a" },
    { key: "Right_Turn", label: "우회전", icon: "↱", color: "#f7c44f" },
    { key: "U_Turn",     label: "유턴",   icon: "↩", color: "#b04ff7" },
] as const;
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

function signalTypeForConnection(connection: NetworkConnection): "RTOR" | "None" {
    return normalizeTurning(connection.turning) === "Right_Turn" ? "RTOR" : "None";
}

function connectionLabel(connection: NetworkConnection): string {
    const direction = dirMeta(normalizeTurning(connection.turning));
    const lane = connection.fromLane != null || connection.toLane != null
        ? ` · ${connection.fromLane ?? "?"}차로 → ${connection.toLane ?? "?"}차로`
        : "";
    return `#${connection.id} · ${connection.fromLink ?? "?"} → ${connection.toLink ?? "?"}${lane} · ${direction.icon} ${direction.label}`;
}

function inferTurnId(
    connection: NetworkConnection,
    signals: SignalRecord[],
    connections: NetworkConnection[],
    currentSignal?: SignalRecord,
): string {
    const connectionById = new Map(connections.map(item => [String(item.id), item]));
    const targetDirection = normalizeTurning(connection.turning);
    const sameApproach = signals.find(signal => {
        if (signal.__guid === currentSignal?.__guid || signal.turnId == null) return false;
        const linked = signal.connectionId == null
            ? undefined
            : connectionById.get(String(signal.connectionId));
        return linked
            && String(linked.fromLink) === String(connection.fromLink)
            && normalizeTurning(linked.turning) === targetDirection;
    });
    if (sameApproach?.turnId != null) return String(sameApproach.turnId);

    const currentConnection = currentSignal?.connectionId == null
        ? undefined
        : connectionById.get(String(currentSignal.connectionId));
    if (currentSignal?.turnId != null
            && currentConnection
            && String(currentConnection.fromLink) === String(connection.fromLink)
            && normalizeTurning(currentConnection.turning) === targetDirection) {
        return String(currentSignal.turnId);
    }

    const numericTurnIds = signals
        .map(signal => Number(signal.turnId))
        .filter(Number.isFinite);
    return String(numericTurnIds.length > 0 ? Math.max(...numericTurnIds) + 1 : 0);
}

/* ─────────────────────── 신호 행 ───────────────────────────────── */
interface RowProps {
    sig: SignalRecord;
    signals: SignalRecord[];
    connections: NetworkConnection[];
    isSelected: boolean;
    rowRef: (el: HTMLTableRowElement | null) => void;
    onSave: (s: SignalRecord) => void;
    onDelete: () => void;
    onValidate: (candidate: SignalRecord) => SignalPhaseConflict[];
}

const SignalRow: React.FC<RowProps> = ({
    sig,
    signals,
    connections,
    isSelected,
    rowRef,
    onSave,
    onDelete,
    onValidate,
}) => {
    const [editing, setEditing] = useState(false);
    const [connectionId, setConnectionId] = useState(sig.connectionId ?? "");
    const connection = connections.find(item => String(item.id) === String(sig.connectionId));
    const draftConnection = connections.find(item => String(item.id) === String(connectionId));
    const direction = normalizeTurning(connection?.turning) ?? normalizeTurning(sig.turning);
    const meta = dirMeta(direction);
    const disconnected = !connection;

    const startEdit = () => {
        setConnectionId(connection ? String(connection.id) : "");
        setEditing(true);
    };
    /** 행 클릭 = 지도 하이라이트만. source 를 생략해 'map' 으로 두는 것이 의도다 —
     *  'grid' 로 두면 목록을 훑을 때마다 카메라가 따라 움직여 화면이 계속 튄다. */
    const highlightConnection = () => {
        const guid = connection?.__guid;
        useSelectionStore.getState().setSelectedGuid([
            typeof guid === "string" && guid.length > 0 ? guid : sig.__guid,
        ]);
    };
    const save = () => {
        if (!draftConnection) return;
        const turning = normalizeTurning(draftConnection.turning);
        const updated = {
            ...sig,
            turnId: inferTurnId(draftConnection, signals, connections, sig),
            turning,
            type: signalTypeForConnection(draftConnection),
            connectionId: String(draftConnection.id),
        };
        if (!confirmSignalConflicts(onValidate(updated))) return;
        onSave(updated);
        setEditing(false);
    };
    const cancel = () => {
        setConnectionId(connection ? String(connection.id) : "");
        setEditing(false);
    };

    if (editing) {
        const draftMeta = dirMeta(normalizeTurning(draftConnection?.turning));
        return (
            <tr ref={rowRef} style={{ background: "rgb(var(--signal-surface-1-rgb))" }}>
                <td style={signalChildDirectionTd}>
                    <div style={directionAndTypeStyle}>
                        {draftConnection
                            ? <span style={{ ...readonlyValueStyle, color: draftMeta.color }}>
                                {draftMeta.icon} {draftMeta.label}
                            </span>
                            : <span style={requiredValueStyle}>Connection 선택 필요</span>}
                        {draftConnection && (
                            <span style={typeInlineBadgeStyle}>
                                {signalTypeForConnection(draftConnection)}
                            </span>
                        )}
                    </div>
                </td>
                <td style={td}>
                    <select
                        value={connectionId}
                        onChange={event => setConnectionId(event.target.value)}
                        style={sel}
                        autoFocus
                    >
                        <option value="">현재 교차로의 Connection 선택</option>
                        {connections.map(item => {
                            const owner = signals.find(signal =>
                                signal.__guid !== sig.__guid
                                && String(signal.connectionId) === String(item.id));
                            return (
                                <option key={String(item.id)} value={String(item.id)} disabled={!!owner}>
                                    {connectionLabel(item)}
                                    {owner ? ` · 사용 중 T${owner.turnId ?? "미지정"}` : ""}
                                </option>
                            );
                        })}
                    </select>
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                        onClick={save}
                        disabled={!draftConnection}
                        style={draftConnection ? btnS("var(--signal-accent)") : disabledButtonStyle}
                    >
                        연결
                    </button>
                    <button onClick={cancel} style={{ ...btnS("rgb(var(--signal-border-rgb))"), marginLeft: 4 }}>취소</button>
                </td>
            </tr>
        );
    }

    return (
        <tr
            ref={rowRef}
            className="signal-data-row"
            onClick={highlightConnection}
            style={{
                cursor: "pointer",
                borderBottom: "1px solid rgb(var(--signal-surface-1-rgb))",
                background: disconnected ? "rgb(var(--signal-danger-surface-rgb))" : isSelected ? "rgb(var(--signal-border-subtle-rgb))" : "rgb(var(--signal-surface-0-rgb))",
                outline: disconnected
                    ? "1px solid rgb(var(--signal-danger-border-rgb))"
                    : isSelected ? "1px solid rgba(var(--signal-accent-rgb), 0.33)" : undefined,
                outlineOffset: "-1px",
            }}
        >
            <td style={signalChildDirectionTd}>
                <div style={directionAndTypeStyle}>
                    {disconnected ? (
                        <span style={disconnectedBadgeStyle}>연결 끊김</span>
                    ) : (
                        <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            background: meta.color + "18", border: `1px solid ${meta.color}44`,
                            borderRadius: 5, padding: "2px 10px",
                            color: meta.color, fontSize: 12, fontWeight: 600,
                        }}>
                            <span style={{ fontSize: 14 }}>{meta.icon}</span>{meta.label}
                        </span>
                    )}
                    <span style={typeInlineBadgeStyle}>
                        {connection ? signalTypeForConnection(connection) : sig.type || "—"}
                    </span>
                </div>
            </td>
            <td style={{ ...td, color: disconnected ? "var(--signal-danger)" : "rgb(var(--signal-accent-text-rgb))", fontSize: 11 }}>
                {connection
                    ? connectionLabel(connection)
                    : `저장된 ID #${sig.connectionId || "없음"} · 현재 노드에 존재하지 않음`}
            </td>
            <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                    type="button"
                    onClick={event => {
                        event.stopPropagation();
                        startEdit();
                    }}
                    title={disconnected ? "Connection 다시 연결" : "신호 연결 수정"}
                    style={rowSecondaryButtonStyle}
                >
                    수정
                </button>
                <button
                    type="button"
                    onClick={event => {
                        event.stopPropagation();
                        onDelete();
                    }}
                    aria-label="신호 해제"
                    title="신호만 해제하며 네트워크 Connection은 삭제하지 않습니다."
                    style={{ ...rowDeleteButtonStyle, marginLeft: 4 }}
                >
                    X
                </button>
            </td>
        </tr>
    );
};

/* ───────────────────── 신호 추가 행 ────────────────────────────── */
interface AddRowProps {
    nodeId: string;
    signals: SignalRecord[];
    connections: NetworkConnection[];
    onAdd: (s: Omit<SignalRecord, "__guid">) => void;
    onCancel: () => void;
    onValidate: (candidate: SignalRecord) => SignalPhaseConflict[];
}

const AddRow: React.FC<AddRowProps> = ({
    nodeId,
    signals,
    connections,
    onAdd,
    onCancel,
    onValidate,
}) => {
    const [connectionId, setConnectionId] = useState("");
    const connection = connections.find(item => String(item.id) === connectionId);
    const meta = dirMeta(normalizeTurning(connection?.turning));
    const availableCount = connections.filter(item =>
        !signals.some(signal => String(signal.connectionId) === String(item.id))).length;

    const add = () => {
        if (!connection) return;
        const candidate = {
            featureType: "signals",
            nodeId,
            turnId: inferTurnId(connection, signals, connections),
            turning: normalizeTurning(connection.turning),
            type: signalTypeForConnection(connection),
            connectionId: String(connection.id),
        } as unknown as SignalRecord;
        if (!confirmSignalConflicts(onValidate(candidate))) return;
        onAdd(candidate);
    };

    if (connections.length === 0) {
        return (
            <tr>
                <td colSpan={3} style={emptyConnectionStyle}>
                    이 교차로에는 연결할 수 있는 Connection이 없습니다. 네트워크 데이터를 먼저 확인하세요.
                    <button onClick={onCancel} style={{ ...btnS("rgb(var(--signal-border-rgb))"), marginLeft: 8 }}>닫기</button>
                </td>
            </tr>
        );
    }

    return (
        <tr style={{ background: "rgb(var(--signal-surface-0-rgb))" }}>
            <td style={td}>
                <div style={directionAndTypeStyle}>
                    <span style={{ ...readonlyValueStyle, color: connection ? meta.color : "var(--signal-text-muted)" }}>
                        {connection ? `${meta.icon} ${meta.label}` : "자동 결정"}
                    </span>
                    {connection && (
                        <span style={typeInlineBadgeStyle}>
                            {signalTypeForConnection(connection)}
                        </span>
                    )}
                </div>
            </td>
            <td style={td}>
                <select
                    value={connectionId}
                    onChange={event => setConnectionId(event.target.value)}
                    style={sel}
                    autoFocus
                >
                    <option value="">
                        {availableCount > 0 ? "현재 교차로의 Connection 선택" : "사용 가능한 Connection 없음"}
                    </option>
                    {connections.map(item => {
                        const owner = signals.find(signal =>
                            String(signal.connectionId) === String(item.id));
                        return (
                            <option key={String(item.id)} value={String(item.id)} disabled={!!owner}>
                                {connectionLabel(item)}
                                {owner ? ` · 사용 중 T${owner.turnId ?? "미지정"}` : ""}
                            </option>
                        );
                    })}
                </select>
            </td>
            <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                    onClick={add}
                    disabled={!connection}
                    style={connection ? btnS("var(--color-success)") : disabledButtonStyle}
                >
                    신호 연결
                </button>
                <button onClick={onCancel} style={{ ...btnS("rgb(var(--signal-border-rgb))"), marginLeft: 4 }}>취소</button>
            </td>
        </tr>
    );
};

/* ─────────────────────── 메인 컴포넌트 ─────────────────────────── */
interface SignalGroupedEditorProps {
    containerHeight?: number;
    embeddedNodeId?: string | null;
}

const SignalGroupedEditor: React.FC<SignalGroupedEditorProps> = ({
    containerHeight = 400,
    embeddedNodeId,
}) => {
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
    const [collapsedTurnGroups, setCollapsedTurnGroups] = useState<Set<string>>(() => new Set());

    // 지도 선택 sync
    const selectedGuidValues = useSelectionStore(s => s.selectedGuid);
    const selectedGuids = useMemo(
        () => selectedGuidValues.map(String),
        [selectedGuidValues],
    );
    const selectedGuid = selectedGuids[0];
    const network = useNetworkStore(s => s.currentJsonData);
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
    const tableScrollRef = useRef<HTMLDivElement>(null);

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
        if (embeddedNodeId) return embeddedNodeId;
        if (mapNodeId) return mapNodeId;
        if (manualNodeId && nodeGroups.has(manualNodeId)) return manualNodeId;
        return nodeIds[0] ?? null;
    }, [embeddedNodeId, mapNodeId, manualNodeId, nodeGroups, nodeIds]);

    const activeSignals = useMemo<SignalRecord[]>(
        () => activeId ? (nodeGroups.get(activeId) ?? []) : [],
        [activeId, nodeGroups],
    );
    const activeNode = useMemo(
        () => activeId
            ? (network?.nodes ?? []).find((node: any) => String(node.id) === activeId)
            : undefined,
        [activeId, network],
    );
    const activeConnections = useMemo(
        () => activeNode?.connections ?? [],
        [activeNode],
    );
    const turnGroups = useMemo(
        () => buildSignalTurnGroups(activeSignals, activeConnections),
        [activeConnections, activeSignals],
    );
    const unassignedConnections = useMemo(() => {
        const assignedIds = new Set(
            activeSignals
                .map(signal => signal.connectionId)
                .filter(connectionId => connectionId != null)
                .map(String),
        );
        return activeConnections.filter(connection => !assignedIds.has(String(connection.id)));
    }, [activeConnections, activeSignals]);

    useEffect(() => {
        tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }, [activeId]);

    useEffect(() => {
        setCollapsedTurnGroups(current => {
            const availableKeys = new Set(turnGroups.map(group => group.key));
            const next = new Set([...current].filter(key => availableKeys.has(key)));
            const unchanged = next.size === current.size
                && [...next].every(key => current.has(key));
            return unchanged ? current : next;
        });
    }, [turnGroups]);

    const toggleTurnGroup = useCallback((groupKey: string) => {
        setCollapsedTurnGroups(current => {
            const next = new Set(current);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    }, []);

    const highlightTurnGroup = useCallback((connectionGuids: string[], fallbackSignalGuids: string[]) => {
        const guids = connectionGuids.length > 0 ? connectionGuids : fallbackSignalGuids;
        if (guids.length > 0) {
            useSelectionStore.getState().setSelectedGuid(guids);
        }
    }, []);

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

    useEffect(() => {
        if (!activeId || activeConnections.length === 0) return;
        const connectionById = new Map(
            activeConnections.map(connection => [String(connection.id), connection]),
        );
        for (const signal of activeSignals) {
            if (signal.connectionId == null) continue;
            const connection = connectionById.get(String(signal.connectionId));
            if (!connection) continue;

            const turning = normalizeTurning(connection.turning);
            const type = signalTypeForConnection(connection);
            const turnId = signal.turnId == null || String(signal.turnId).trim() === ""
                ? inferTurnId(connection, activeSignals, activeConnections, signal)
                : String(signal.turnId);
            if (normalizeTurning(signal.turning) === turning
                    && signal.type === type
                    && String(signal.turnId ?? "") === turnId) {
                continue;
            }
            updateSignal({
                ...signal,
                turnId,
                turning,
                type,
                connectionId: String(connection.id),
            });
        }
    }, [activeConnections, activeId, activeSignals, updateSignal]);

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

    /* 신규 교차로는 Signal/기본 PLAN/TOD를 최초 생성한다. 기존 교차로는 사용자가 편집한
     * PLAN/TOD를 보존하고, 현재 Network Connection과 Turn 그룹만 명시적으로 동기화한다. */
    const autoGenerateForNode = useCallback((nodeId: string) => {
        if (!network) return;
        const existing = nodeGroups.get(nodeId) ?? [];
        const run = () => {
            const result = synchronizeSignalsForNode(network, nodeId);
            if (result == null) {
                useMessageStore.getState().setMessage({
                    type: "alert",
                    text: "이 교차로는 신호 생성 조건(접근로 2개 이상 등)을 충족하지 않습니다.",
                    onClose: () => {},
                });
                return;
            }
            useMessageStore.getState().setMessage({
                type: "alert",
                text: result.mode === "created"
                    ? `신호 이동류 ${result.signalCount}건과 기본 PLAN/TOD를 생성했습니다.`
                    : `네트워크와 동기화했습니다.\n추가 Connection ${result.addedConnections}건 · 제거 Connection ${result.removedConnections}건 · 새 Turn ${result.addedTurns}건\n기존 PLAN 시간과 TOD는 유지됩니다.`,
                onClose: () => {},
            });
        };
        if (existing.length > 0) {
            useMessageStore.getState().setMessage({
                type: "confirm",
                text: `교차로 #${nodeId}의 신호를 현재 Network Connection과 동기화하시겠습니까?\n미포함 Connection ${unassignedConnections.length}건을 Turn 그룹에 반영하며 기존 PLAN 시간과 TOD는 유지됩니다.`,
                onConfirm: run,
            });
        } else {
            run();
        }
    }, [network, nodeGroups, unassignedConnections.length]);

    /* 양방향 사고 위험(상충) 검사 — 현재 노드의 신호 목록 + 네트워크 방위각 기준 */
    const validateConflicts = useCallback((candidate: SignalRecord): SignalPhaseConflict[] => {
        if (!network) return [];
        return checkManualSignalEditConflicts(network, activeSignals as any, candidate as any);
    }, [activeSignals, network]);

    if (!signals.length && !mapNodeId) {
        return <div style={{ color: "var(--signal-text-disabled)", padding: 40, textAlign: "center", fontSize: 13 }}>
            신호 데이터가 없습니다. 지도에서 교차로(노드)를 클릭하면 여기서 바로 신호를 추가할 수 있습니다.
        </div>;
    }

    const bodyH = containerHeight - 56;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: bodyH, overflow: "hidden" }}>

            {/* ── 상단 탭 바 ── */}
            <div style={{
                display: "flex", alignItems: "stretch",
                borderBottom: "1px solid rgb(var(--signal-surface-3-rgb))", flexShrink: 0,
                background: "rgb(var(--signal-surface-0-rgb))", overflow: "hidden",
            }}>
                {/* 검색 */}
                <div style={{ padding: "6px 8px", flexShrink: 0, display: "flex", alignItems: "center", borderRight: "1px solid rgb(var(--signal-surface-3-rgb))" }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="교차로 검색"
                        style={{
                            background: "rgb(var(--signal-surface-2-rgb))", border: "1px solid rgb(var(--signal-border-subtle-rgb))",
                            borderRadius: 4, color: "var(--signal-text-secondary)", padding: "3px 8px",
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
                                    background: isActive ? "rgb(var(--signal-surface-3-rgb))" : "none",
                                    border: "none",
                                    borderBottom: `2px solid ${isActive ? "var(--signal-accent)" : "transparent"}`,
                                    color: isActive ? "var(--signal-text-primary)" : "var(--signal-text-disabled)",
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
                            title={activeSignals.length > 0
                                ? "현재 Network Connection을 Turn 그룹에 동기화"
                                : "Signal, 기본 PLAN, TOD 최초 생성"}
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid rgb(var(--signal-surface-3-rgb))",
                                color: "var(--signal-accent)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
                            }}
                        >⚡ 자동 생성</button>
                        <button
                            onClick={() => deleteAllForNode(activeId)}
                            disabled={activeSignals.length === 0}
                            title="이 교차로의 신호를 한 번에 전부 삭제"
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid rgb(var(--signal-surface-3-rgb))",
                                color: activeSignals.length === 0 ? "rgb(var(--signal-border-rgb))" : "rgb(var(--signal-warning-border-rgb))",
                                cursor: activeSignals.length === 0 ? "default" : "pointer",
                                fontSize: 12, whiteSpace: "nowrap",
                            }}
                        >🗑 전체 삭제</button>
                        <button
                            onClick={() => setAddingTo(activeId)}
                            style={{
                                flexShrink: 0, padding: "0 12px",
                                background: "none", border: "none",
                                borderLeft: "1px solid rgb(var(--signal-surface-3-rgb))",
                                color: "var(--signal-text-muted)", cursor: "pointer", fontSize: 12,
                            }}
                        >+ 추가</button>
                    </>
                )}
            </div>

            {/* ── 테이블 ── */}
            {activeId ? (
                <div ref={tableScrollRef} style={{ flex: 1, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <colgroup>
                            <col style={{ width: "32%" }} />
                            <col />
                            <col style={{ width: "170px" }} />
                        </colgroup>
                        <thead>
                            <tr style={{ background: "rgb(var(--signal-surface-0-rgb))" }}>
                                <th style={th}>이동 방향</th>
                                <th style={th}>Connection ID</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {turnGroups.map(group => {
                                const collapsed = collapsedTurnGroups.has(group.key);
                                const connectionGuids = group.connections
                                    .map(connection => connection.__guid)
                                    .filter((guid): guid is string =>
                                        typeof guid === "string" && guid.length > 0);
                                const highlightGuids = connectionGuids.length > 0
                                    ? connectionGuids
                                    : group.signalGuids;
                                const groupSelected = highlightGuids.length > 0
                                    && highlightGuids.every(guid => selectedGuids.includes(String(guid)));
                                return (
                                    <React.Fragment key={group.key}>
                                        <tr
                                            onClick={() => highlightTurnGroup(connectionGuids, group.signalGuids)}
                                            style={{
                                                background: groupSelected
                                                    ? "rgb(var(--signal-border-rgb))"
                                                    : group.isRtor ? "rgb(var(--signal-warning-surface-rgb))" : "rgb(var(--signal-surface-2-rgb))",
                                                borderTop: "1px solid rgb(var(--signal-border-rgb))",
                                                borderBottom: "1px solid rgb(var(--signal-border-subtle-rgb))",
                                                cursor: "pointer",
                                            }}
                                        >
                                            <td
                                                colSpan={3}
                                                style={{
                                                    padding: "8px 12px",
                                                    boxShadow: group.isRtor
                                                        ? "inset 3px 0 rgb(var(--signal-warning-border-rgb))"
                                                        : "inset 3px 0 rgb(var(--signal-border-accent-rgb))",
                                                }}
                                            >
                                                <div style={turnGroupHeaderStyle}>
                                                    <button
                                                        type="button"
                                                        onClick={event => {
                                                            event.stopPropagation();
                                                            toggleTurnGroup(group.key);
                                                        }}
                                                        style={turnGroupToggleStyle}
                                                        title={collapsed ? "이동류 펼치기" : "이동류 접기"}
                                                    >
                                                        {collapsed ? "▶" : "▼"}
                                                    </button>
                                                    <span style={turnGroupBadgeStyle}>
                                                        {group.turnId == null ? "미지정" : `T${group.turnId}`}
                                                    </span>
                                                    <span style={turnDirectionIconsStyle}>
                                                        {group.directions.map(direction => (
                                                            <span
                                                                key={direction.key}
                                                                title={`${direction.label} ${direction.count}개`}
                                                                style={{ color: direction.color }}
                                                            >
                                                                {direction.icon}
                                                            </span>
                                                        ))}
                                                    </span>
                                                    <strong style={{ color: group.isRtor ? "var(--signal-warning)" : "var(--signal-text-primary)" }}>
                                                        {group.directionLabel || "방향 미지정"}
                                                    </strong>
                                                    <span style={turnGroupApproachStyle}>{group.approachLabel}</span>
                                                    <span style={turnGroupCountStyle}>
                                                        이동류 {group.signals.length}개
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                        {!collapsed && group.signals.map(signal => (
                                            <SignalRow
                                                key={signal.__guid}
                                                sig={signal as SignalRecord}
                                                signals={activeSignals}
                                                connections={activeConnections}
                                                isSelected={(() => {
                                                    const connection = activeConnections.find(item =>
                                                        String(item.id) === String(signal.connectionId));
                                                    const connectionGuid = connection?.__guid;
                                                    return typeof connectionGuid === "string" && connectionGuid.length > 0
                                                        ? selectedGuids.includes(connectionGuid)
                                                        : selectedGuids.includes(String(signal.__guid));
                                                })()}
                                                rowRef={el => {
                                                    if (el) rowRefs.current.set(signal.__guid, el);
                                                    else rowRefs.current.delete(signal.__guid);
                                                }}
                                                onSave={updateSignal}
                                                onDelete={() => deleteSignal(signal.__guid)}
                                                onValidate={validateConflicts}
                                            />
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                            {unassignedConnections.length > 0 && (
                                <>
                                    <tr>
                                        <td colSpan={3} style={unassignedSectionStyle}>
                                            <div>
                                                <strong>미포함 Connection {unassignedConnections.length}개</strong>
                                                <span style={unassignedDescriptionStyle}>
                                                    아직 신호 이동류와 Turn 그룹에 반영되지 않았습니다.
                                                </span>
                                            </div>
                                            <span style={unassignedHintStyle}>
                                                위의 자동 생성을 실행하면 반영됩니다.
                                            </span>
                                        </td>
                                    </tr>
                                    {unassignedConnections.map(connection => {
                                        const meta = dirMeta(normalizeTurning(connection.turning));
                                        return (
                                            <tr
                                                key={`unassigned-${connection.id}`}
                                                onClick={() => {
                                                    if (connection.__guid) {
                                                        useSelectionStore.getState().setSelectedGuid([connection.__guid]);
                                                    }
                                                }}
                                                style={unassignedRowStyle}
                                                title="지도에서 이 Connection 강조"
                                            >
                                                <td style={unassignedDirectionStyle}>
                                                    <span style={{ color: meta.color, fontWeight: 700 }}>
                                                        {meta.icon} {meta.label}
                                                    </span>
                                                    <span style={unassignedBadgeStyle}>미포함</span>
                                                </td>
                                                <td style={unassignedConnectionStyle}>
                                                    {connectionLabel(connection)}
                                                </td>
                                                <td style={unassignedActionStyle}>지도 강조</td>
                                            </tr>
                                        );
                                    })}
                                </>
                            )}
                            {addingTo === activeId && (
                                <AddRow
                                    nodeId={activeId}
                                    signals={activeSignals}
                                    connections={activeConnections}
                                    onAdd={addSignal}
                                    onCancel={() => setAddingTo(null)}
                                    onValidate={validateConflicts}
                                />
                            )}
                            {activeSignals.length === 0 && addingTo !== activeId && (
                                <tr><td colSpan={3} style={{ padding: "24px", textAlign: "center", color: "rgb(var(--signal-border-rgb))", fontSize: 12 }}>
                                    이 교차로에 등록된 신호가 없습니다.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgb(var(--signal-border-rgb))", fontSize: 12 }}>
                    상단 탭에서 교차로를 선택하세요.
                </div>
            )}

            <style>{`
                tr.signal-data-row:hover { background: rgb(var(--signal-surface-2-rgb)) !important; }
            `}</style>
        </div>
    );
};

/* ── 공통 스타일 ── */
const th: React.CSSProperties = {
    textAlign: "left", padding: "6px 12px",
    fontSize: 11, color: "rgb(var(--signal-border-rgb))", fontWeight: 600,
    borderBottom: "1px solid rgb(var(--signal-surface-3-rgb))",
    position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "6px 12px", verticalAlign: "middle" };
const signalChildDirectionTd: React.CSSProperties = {
    ...td,
    paddingLeft: 68,
};
const directionAndTypeStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
};
const typeInlineBadgeStyle: React.CSSProperties = {
    flexShrink: 0,
    padding: "2px 6px",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 4,
    background: "rgb(var(--signal-surface-2-rgb))",
    color: "var(--signal-text-muted)",
    fontSize: 9,
    fontWeight: 700,
};
const inp: React.CSSProperties = {
    background: "rgb(var(--signal-surface-2-rgb))", border: "1px solid rgb(var(--signal-border-rgb))", borderRadius: 4,
    color: "var(--signal-text-primary)", padding: "4px 8px", fontSize: 11,
    width: "100%", boxSizing: "border-box", outline: "none",
};
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const btnS = (bg: string): React.CSSProperties => ({
    background: bg, border: "none", borderRadius: 4,
    color: bg === "transparent" ? undefined : "var(--signal-text-primary)",
    padding: "3px 10px", cursor: "pointer", fontSize: 11,
});

const readonlyValueStyle: React.CSSProperties = {
    display: "inline-flex",
    minHeight: 27,
    alignItems: "center",
    color: "var(--signal-text-secondary)",
    fontSize: 11,
    fontWeight: 600,
};

const requiredValueStyle: React.CSSProperties = {
    ...readonlyValueStyle,
    color: "var(--signal-danger)",
};

const disabledButtonStyle: React.CSSProperties = {
    ...btnS("rgb(var(--signal-border-subtle-rgb))"),
    color: "var(--signal-text-disabled)",
    cursor: "not-allowed",
};

const rowSecondaryButtonStyle: React.CSSProperties = {
    height: 28,
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-surface-2-rgb))",
    color: "var(--signal-text-secondary)",
    padding: "0 9px",
    fontSize: 10,
    cursor: "pointer",
};

const rowDeleteButtonStyle: React.CSSProperties = {
    height: 28,
    border: "1px solid rgb(var(--signal-danger-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-danger-surface-rgb))",
    color: "var(--signal-danger)",
    padding: "0 9px",
    fontSize: 10,
    cursor: "pointer",
};

const disconnectedBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid rgb(var(--signal-warning-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-danger-surface-rgb))",
    color: "var(--signal-danger)",
    padding: "3px 8px",
    fontSize: 10,
    fontWeight: 800,
};

const emptyConnectionStyle: React.CSSProperties = {
    padding: 18,
    textAlign: "center",
    color: "var(--signal-danger)",
    fontSize: 11,
    background: "rgb(var(--signal-warning-surface-rgb))",
    borderBottom: "1px solid rgb(var(--signal-danger-border-rgb))",
};

const unassignedSectionStyle: React.CSSProperties = {
    padding: "14px 18px 10px",
    borderTop: "2px solid rgb(var(--signal-warning-border-rgb))",
    borderBottom: "1px solid rgb(var(--signal-danger-surface-rgb))",
    background: "rgb(var(--signal-warning-surface-rgb))",
    color: "var(--signal-warning)",
};

const unassignedDescriptionStyle: React.CSSProperties = {
    marginLeft: 10,
    color: "var(--signal-text-muted)",
    fontSize: 10,
    fontWeight: 400,
};

const unassignedHintStyle: React.CSSProperties = {
    display: "block",
    marginTop: 5,
    color: "rgb(var(--signal-warning-border-rgb))",
    fontSize: 9,
};

const unassignedRowStyle: React.CSSProperties = {
    borderBottom: "1px solid rgb(var(--signal-danger-surface-rgb))",
    background: "rgb(var(--signal-warning-surface-rgb))",
    cursor: "pointer",
};

const unassignedDirectionStyle: React.CSSProperties = {
    ...td,
    paddingLeft: 68,
};

const unassignedBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    marginLeft: 8,
    padding: "2px 6px",
    border: "1px solid rgb(var(--signal-warning-border-rgb))",
    borderRadius: 4,
    color: "var(--signal-warning)",
    background: "rgb(var(--signal-warning-surface-rgb))",
    fontSize: 9,
    fontWeight: 700,
};

const unassignedConnectionStyle: React.CSSProperties = {
    ...td,
    color: "var(--signal-text-muted)",
};

const unassignedActionStyle: React.CSSProperties = {
    ...td,
    color: "rgb(var(--signal-warning-border-rgb))",
    textAlign: "right",
    fontSize: 10,
};

const turnGroupHeaderStyle: React.CSSProperties = {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 9,
    fontSize: 11,
};

const turnGroupToggleStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    flexShrink: 0,
    padding: 0,
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 4,
    background: "rgb(var(--signal-surface-3-rgb))",
    color: "var(--signal-text-secondary)",
    cursor: "pointer",
    fontSize: 9,
};

const turnGroupBadgeStyle: React.CSSProperties = {
    minWidth: 42,
    flexShrink: 0,
    boxSizing: "border-box",
    display: "inline-flex",
    justifyContent: "center",
    padding: "4px 9px",
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-border-rgb))",
    color: "var(--signal-text-primary)",
    fontSize: 12,
    fontWeight: 800,
};

const turnDirectionIconsStyle: React.CSSProperties = {
    minWidth: 42,
    display: "inline-flex",
    gap: 5,
    fontSize: 15,
    fontWeight: 800,
};

const turnGroupApproachStyle: React.CSSProperties = {
    minWidth: 0,
    color: "var(--signal-text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
};

const turnGroupCountStyle: React.CSSProperties = {
    marginLeft: "auto",
    flexShrink: 0,
    padding: "3px 7px",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 9,
    background: "rgb(var(--signal-surface-3-rgb))",
    color: "var(--signal-text-muted)",
    fontSize: 9,
};

export default SignalGroupedEditor;
