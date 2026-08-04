import React, { useEffect, useMemo, useState } from "react";
import {
    buildDefaultSignalPlansForNode,
    checkManualSignalEditConflicts,
    SignalPhaseConflict,
} from "@utils/signal";
import { useMessageStore } from "@stores/useMessageStore";
import {
    nextIndexedGuid,
    nextNumericId,
    SignalPlanIssue,
    validateSignalPlans,
} from "@utils/signalEditorUtils";
import { SignalTurnGroup } from "@utils/signalTurnGroups";

export interface EditableSignalPhase {
    id: string | number;
    duration?: string | number;
    turnList?: string;
    __guid?: string;
    featureType?: string;
    parentGuid?: string;
    [key: string]: any;
}

export interface EditableSignalPlan {
    id: string | number;
    cycle?: string | number;
    offset?: string | number;
    phases?: EditableSignalPhase[];
    __guid?: string;
    featureType?: string;
    parentGuid?: string;
    [key: string]: any;
}

export interface EditableSignalRecord {
    __guid: string;
    featureType: string;
    nodeId: string;
    turnId?: string;
    connectionId?: string | null;
    plans?: EditableSignalPlan[];
    [key: string]: any;
}

interface SignalPlanEditorProps {
    nodeId: string;
    signals: EditableSignalRecord[];
    networkData: any;
    turnGroups: SignalTurnGroup[];
    onHighlightTurnGroup: (signalGuids: string[]) => void;
    onUpdateRecord: (record: any) => void;
    onDeleteRecords: (guids: string[]) => void;
}

function numericSort(left: { id: string | number }, right: { id: string | number }): number {
    const leftNumber = Number(left.id);
    const rightNumber = Number(right.id);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return String(left.id).localeCompare(String(right.id));
}

function splitTurnList(value: string | undefined): string[] {
    return String(value ?? "").split(/\s+/).filter(Boolean);
}

function highlightGuidsForTurnGroups(groups: SignalTurnGroup[]): string[] {
    const connectionGuids = groups.flatMap(group =>
        group.connections
            .map(connection => connection.__guid)
            .filter((guid): guid is string => typeof guid === "string" && guid.length > 0),
    );
    if (connectionGuids.length > 0) return [...new Set(connectionGuids)];
    return [...new Set(groups.flatMap(group => group.signalGuids))];
}

function uniqueConflicts(conflicts: SignalPhaseConflict[]): SignalPhaseConflict[] {
    const seen = new Set<string>();
    return conflicts.filter(conflict => {
        const approaches = [conflict.myFromLink, conflict.conflictingFromLink].sort().join(":");
        const key = `${conflict.planId}:${conflict.phaseId}:${approaches}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function confirmPlanConflicts(conflicts: SignalPhaseConflict[]): boolean {
    if (conflicts.length === 0) return true;
    const lines = conflicts.map(conflict =>
        `· 현시 ${conflict.phaseId}: 접근로 ${conflict.myFromLink} ↔ ${conflict.conflictingFromLink}`,
    );
    return window.confirm(
        `사고 위험이 있는 동시 녹색 조합을 감지했습니다.\n\n${lines.join("\n")}\n\n그래도 적용하시겠습니까?`,
    );
}

interface PhaseRowProps {
    phase: EditableSignalPhase;
    phaseIndex: number;
    startTime: number;
    initiallyExpanded: boolean;
    turnGroups: SignalTurnGroup[];
    onApply: (phase: EditableSignalPhase) => void;
    onDelete: () => void;
    onTurnListChange: (phase: EditableSignalPhase) => void;
    onHighlightTurnGroup: (signalGuids: string[]) => void;
}

const PhaseRow: React.FC<PhaseRowProps> = ({
    phase,
    phaseIndex,
    startTime,
    initiallyExpanded,
    turnGroups,
    onApply,
    onDelete,
    onTurnListChange,
    onHighlightTurnGroup,
}) => {
    const [isChoosingTurns, setIsChoosingTurns] = useState(false);
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [hoveredTurnKey, setHoveredTurnKey] = useState<string | null>(null);
    const [expandedTurnKey, setExpandedTurnKey] = useState<string | null>(null);
    const [draft, setDraft] = useState({
        id: String(phase.id ?? ""),
        duration: String(phase.duration ?? ""),
    });
    const activeTurns = splitTurnList(phase.turnList);
    const activeGroups = turnGroups.filter(group =>
        group.turnId != null && activeTurns.includes(group.turnId),
    );
    const phaseDisplayId = String(phase.id ?? phaseIndex);
    const durationSeconds = Number(phase.duration);
    const endTime = startTime + (Number.isFinite(durationSeconds) ? durationSeconds : 0);
    const togglePhase = () => {
        setIsExpanded(value => !value);
    };

    useEffect(() => {
        setDraft({
            id: String(phase.id ?? ""),
            duration: String(phase.duration ?? ""),
        });
    }, [phase.id, phase.duration]);

    const applyFields = () => {
        if (draft.id === String(phase.id ?? "") && draft.duration === String(phase.duration ?? "")) return;
        onApply({ ...phase, id: draft.id, duration: draft.duration });
    };

    const toggleTurn = (turnId: string) => {
        const selected = new Set(activeTurns);
        if (selected.has(turnId)) selected.delete(turnId);
        else selected.add(turnId);
        const ordered = turnGroups
            .map(group => group.turnId)
            .filter((id): id is string => id != null && selected.has(id));
        onTurnListChange({ ...phase, turnList: ordered.join(" ") });
    };

    return (
        <div style={phaseRowStyle}>
            <div
                role="button"
                tabIndex={0}
                onClick={togglePhase}
                onMouseEnter={() => {
                    const guids = highlightGuidsForTurnGroups(activeGroups);
                    if (guids.length > 0) onHighlightTurnGroup(guids);
                }}
                onMouseLeave={() => onHighlightTurnGroup([])}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        togglePhase();
                    }
                }}
                style={{
                    ...phaseHeaderStyle,
                    paddingBottom: isExpanded ? 9 : 0,
                    borderBottom: isExpanded ? "1px solid rgb(var(--signal-border-subtle-rgb))" : "none",
                    cursor: "pointer",
                }}
            >
                <span style={accordionChevronStyle}>{isExpanded ? "▼" : "▶"}</span>
                <div style={phaseOrderStyle}>{phaseDisplayId}</div>
                <div style={{ minWidth: 180 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong style={{ color: "var(--signal-text-primary)", fontSize: 12 }}>현시 {phaseDisplayId}</strong>
                        <span style={phaseTimeStyle}>{startTime}~{endTime}초</span>
                    </div>
                    <div style={{ color: "var(--signal-text-muted)", fontSize: 9, marginTop: 3 }}>
                        허용 Turn {activeGroups.length}개 · {Number.isFinite(durationSeconds) ? durationSeconds : 0}초
                    </div>
                </div>
                <div
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => event.stopPropagation()}
                    style={{ marginLeft: "auto", display: "flex", alignItems: "end", gap: 8 }}
                >
                    <label style={compactFieldStyle}>
                        <span style={fieldLabelStyle}>현시 ID</span>
                        <input
                            value={draft.id}
                            inputMode="numeric"
                            onChange={event => setDraft(current => ({ ...current, id: event.target.value }))}
                            onBlur={applyFields}
                            style={{ ...inputStyle, width: 60 }}
                        />
                    </label>
                    <label style={compactFieldStyle}>
                        <span style={fieldLabelStyle}>시간</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                                value={draft.duration}
                                inputMode="numeric"
                                onChange={event => setDraft(current => ({ ...current, duration: event.target.value }))}
                                onBlur={applyFields}
                                style={{ ...inputStyle, width: 62 }}
                            />
                            <span style={{ color: "var(--signal-text-muted)", fontSize: 9 }}>초</span>
                        </div>
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm(`현시 ${phase.id}를 삭제하시겠습니까?`)) onDelete();
                        }}
                        style={phaseDeleteButtonStyle}
                    >
                        삭제
                    </button>
                </div>
            </div>

            {isExpanded && <div style={activeMovementAreaStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                        <strong style={{ color: "var(--signal-text-secondary)", fontSize: 10 }}>허용 이동류</strong>
                        <span style={{ color: "var(--signal-text-muted)", fontSize: 9, marginLeft: 7 }}>
                            카드를 누르면 지도에서 강조됩니다.
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsChoosingTurns(value => {
                            const next = !value;
                            if (next) {
                                const guids = highlightGuidsForTurnGroups(activeGroups);
                                if (guids.length > 0) onHighlightTurnGroup(guids);
                            }
                            return next;
                        })}
                        style={changeMovementButtonStyle}
                    >
                        <span style={{ fontSize: 13 }}>↔</span>
                        {isChoosingTurns ? "선택 완료" : "진입 방향 변경"}
                    </button>
                </div>
                <div style={activeMovementListStyle}>
                    {activeGroups.map(group => (
                        <button
                            key={group.key}
                            type="button"
                            title="포함된 Connection 보기"
                            onMouseEnter={() => {
                                setHoveredTurnKey(group.key);
                                onHighlightTurnGroup(highlightGuidsForTurnGroups([group]));
                            }}
                            onMouseLeave={() => {
                                setHoveredTurnKey(null);
                                onHighlightTurnGroup([]);
                            }}
                            onClick={() => {
                                setExpandedTurnKey(current => current === group.key ? null : group.key);
                                onHighlightTurnGroup(highlightGuidsForTurnGroups([group]));
                            }}
                            style={{
                                ...activeMovementChipStyle,
                                borderColor: hoveredTurnKey === group.key || expandedTurnKey === group.key
                                    ? "rgb(var(--signal-accent-text-rgb))"
                                    : "rgb(var(--signal-border-accent-rgb))",
                                background: hoveredTurnKey === group.key || expandedTurnKey === group.key
                                    ? "linear-gradient(135deg, rgb(var(--signal-border-rgb)) 0%, rgb(var(--signal-border-subtle-rgb)) 100%)"
                                    : activeMovementChipStyle.background,
                            }}
                        >
                            <span style={activeTurnBadgeStyle}>T{group.turnId}</span>
                            <span style={activeMovementInfoStyle}>
                                <span style={activeDirectionStyle}>
                                    <span style={{ color: "rgb(var(--signal-accent-text-rgb))", fontSize: 14 }}>
                                        {group.directions.map(direction => direction.icon).join(" ")}
                                    </span>
                                    <strong>{group.directionLabel}</strong>
                                </span>
                                <span style={approachLinkStyle}>
                                    {group.approachLabel}
                                </span>
                            </span>
                            <span style={mapHighlightHintStyle}>
                                {expandedTurnKey === group.key ? "접기" : "상세"}
                            </span>
                            {expandedTurnKey === group.key && (
                                <span style={connectionHoverListStyle}>
                                    <span style={connectionHoverTitleStyle}>
                                        T{group.turnId} 포함 Connection {group.connections.length}개
                                    </span>
                                    {group.connections.map(connection => (
                                        <span key={String(connection.__guid ?? connection.id)} style={connectionHoverRowStyle}>
                                            <strong>#{String(connection.id)}</strong>
                                            <span>
                                                링크 {String(connection.fromLink ?? "-")} → {String(connection.toLink ?? "-")}
                                            </span>
                                            <span>
                                                차로 {String(connection.fromLane ?? "-")} → {String(connection.toLane ?? "-")}
                                            </span>
                                        </span>
                                    ))}
                                    {group.connections.length === 0 && (
                                        <span style={connectionMissingStyle}>현재 네트워크에서 연결된 Connection을 찾지 못했습니다.</span>
                                    )}
                                </span>
                            )}
                        </button>
                    ))}
                    {activeGroups.length === 0 && (
                        <div style={noMovementStyle}>허용된 이동류가 없습니다. 진입 방향을 선택하세요.</div>
                    )}
                </div>
            </div>}

            {isExpanded && isChoosingTurns && (
                <div style={movementChooserStyle}>
                    <div style={{ color: "var(--signal-text-muted)", fontSize: 9, marginBottom: 7 }}>
                        동시에 통행시킬 이동류를 선택하세요. 선택 시 지도에서도 강조됩니다.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
                        {turnGroups.map(group => {
                            const turnId = group.turnId!;
                            const active = activeTurns.includes(turnId);
                            return (
                                <button
                                    key={turnId}
                                    type="button"
                                    onClick={() => {
                                        onHighlightTurnGroup(highlightGuidsForTurnGroups([group]));
                                        toggleTurn(turnId);
                                    }}
                                    style={{
                                        ...turnCardStyle,
                                        color: active ? "var(--signal-text-primary)" : "var(--signal-text-muted)",
                                        borderColor: active ? "rgb(var(--signal-border-accent-rgb))" : "rgb(var(--signal-border-rgb))",
                                        background: active ? "rgb(var(--signal-border-rgb))" : "rgb(var(--signal-surface-2-rgb))",
                                    }}
                                >
                                    <span style={candidateTurnHeadingStyle}>
                                        <span style={{
                                            ...candidateTurnBadgeStyle,
                                            borderColor: active ? "rgb(var(--signal-accent-text-rgb))" : "var(--signal-text-disabled)",
                                            background: active ? "rgb(var(--signal-border-accent-rgb))" : "rgb(var(--signal-surface-3-rgb))",
                                            color: active ? "var(--signal-text-primary)" : "var(--signal-text-secondary)",
                                        }}>
                                            T{turnId}
                                        </span>
                                        <span style={{ fontSize: 15 }}>
                                            {group.directions.map(direction => direction.icon).join(" ")}
                                        </span>
                                        <strong>{group.directionLabel}</strong>
                                    </span>
                                    <span style={{
                                        color: active ? "var(--signal-text-secondary)" : "var(--signal-text-muted)",
                                        fontSize: 9,
                                        paddingLeft: 1,
                                    }}>
                                        진입 링크 · {group.approachLabel.replace("진입 링크 ", "")}
                                    </span>
                                    <span style={{
                                        ...candidateStateStyle,
                                        color: active ? "var(--signal-text-primary)" : "var(--signal-text-muted)",
                                    }}>
                                        {active ? "선택됨" : "선택"}
                                    </span>
                                </button>
                            );
                        })}
                        {turnGroups.length === 0 && (
                            <span style={{ color: "var(--signal-warning)", fontSize: 10 }}>이동 방향 탭에서 Turn을 먼저 추가하세요.</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

interface PlanCardProps {
    plan: EditableSignalPlan;
    initiallyExpanded: boolean;
    issues: SignalPlanIssue[];
    turnGroups: SignalTurnGroup[];
    onUpdateRecord: (record: any) => void;
    onDeletePlan: () => void;
    onAddPhase: () => void;
    onDeletePhase: (phase: EditableSignalPhase) => void;
    onTurnListChange: (phase: EditableSignalPhase) => void;
    onHighlightTurnGroup: (signalGuids: string[]) => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
    plan,
    initiallyExpanded,
    issues,
    turnGroups,
    onUpdateRecord,
    onDeletePlan,
    onAddPhase,
    onDeletePhase,
    onTurnListChange,
    onHighlightTurnGroup,
}) => {
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [draft, setDraft] = useState({
        offset: String(plan.offset ?? ""),
    });
    const phases = [...(plan.phases ?? [])].sort(numericSort);
    const durationTotal = phases.reduce((sum, phase) => {
        const duration = Number(phase.duration);
        return sum + (Number.isFinite(duration) ? duration : 0);
    }, 0);
    let accumulatedTime = 0;
    const phaseTimings = phases.map(phase => {
        const startTime = accumulatedTime;
        const duration = Number(phase.duration);
        accumulatedTime += Number.isFinite(duration) ? duration : 0;
        return { phase, startTime };
    });

    useEffect(() => {
        setDraft({
            offset: String(plan.offset ?? ""),
        });
    }, [plan.offset]);

    useEffect(() => {
        if (String(plan.cycle ?? "") === String(durationTotal)) return;
        onUpdateRecord({
            ...plan,
            cycle: String(durationTotal),
        });
    }, [durationTotal, onUpdateRecord, plan]);

    const applyPlanFields = () => {
        if (draft.offset === String(plan.offset ?? "")) return;
        onUpdateRecord({
            ...plan,
            offset: draft.offset,
        });
    };

    return (
        <article style={{
            ...planCardStyle,
            borderColor: issues.length > 0 ? "rgb(var(--signal-danger-border-rgb))" : "rgb(var(--signal-border-accent-rgb))",
            boxShadow: issues.length > 0
                ? "0 0 0 1px rgba(var(--signal-danger-border-rgb), 0.28)"
                : "0 7px 20px rgba(var(--surface-overlay-rgb), 0.18)",
        }}>
            <div
                role="button"
                tabIndex={0}
                onClick={() => setIsExpanded(value => !value)}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setIsExpanded(value => !value);
                    }
                }}
                style={{
                    ...planHeaderStyle,
                    marginBottom: isExpanded ? 11 : -11,
                    borderBottom: isExpanded ? "1px solid rgb(var(--signal-border-rgb))" : "none",
                    cursor: "pointer",
                }}
            >
                <div style={planHeaderMainStyle}>
                    <span style={accordionChevronStyle}>{isExpanded ? "▼" : "▶"}</span>
                    <div style={planIdentityStyle}>
                        <span style={planIdentityLabelStyle}>PLAN</span>
                        <strong style={planIdBadgeStyle}>P{String(plan.id ?? "-")}</strong>
                    </div>
                    <span style={planPhaseCountStyle}>현시 {phases.length}개</span>
                    <div style={cycleSummaryStyle}>
                        <span>주기</span>
                        <strong>{durationTotal}초</strong>
                    </div>
                    <label
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => event.stopPropagation()}
                        style={compactFieldStyle}
                    >
                        <span style={fieldLabelStyle}>Offset(초)</span>
                        <input
                            value={draft.offset}
                            inputMode="numeric"
                            onChange={event => setDraft(current => ({ ...current, offset: event.target.value }))}
                            onBlur={applyPlanFields}
                            style={{ ...inputStyle, width: 76 }}
                        />
                    </label>
                </div>
                <div
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => event.stopPropagation()}
                    style={{ display: "flex", gap: 6 }}
                >
                    <button type="button" onClick={onAddPhase} style={secondaryButtonStyle}>+ 현시 추가</button>
                    <button
                        type="button"
                        onClick={onDeletePlan}
                        title="Plan 삭제"
                        style={deleteButtonStyle}
                    >
                        Plan 삭제
                    </button>
                </div>
            </div>

            {isExpanded && issues.length > 0 && (
                <div style={issueBoxStyle}>
                    {issues.map((issue, index) => (
                        <div key={`${issue.code}-${issue.phaseId ?? ""}-${index}`}>• {issue.message}</div>
                    ))}
                </div>
            )}

            <div style={{
                display: isExpanded ? "flex" : "none",
                flexDirection: "column",
                gap: 7,
            }}>
                {phaseTimings.map(({ phase, startTime }, phaseIndex) => (
                    <PhaseRow
                        key={phase.__guid ?? String(phase.id)}
                        phase={phase}
                        phaseIndex={phaseIndex}
                        startTime={startTime}
                        initiallyExpanded={false}
                        turnGroups={turnGroups}
                        onApply={onUpdateRecord}
                        onDelete={() => onDeletePhase(phase)}
                        onTurnListChange={onTurnListChange}
                        onHighlightTurnGroup={onHighlightTurnGroup}
                    />
                ))}
                {phases.length === 0 && (
                    <div style={phaseEmptyStyle}>
                        현시가 없습니다. TOD에서 이 Plan을 사용하기 전에 현시를 추가하세요.
                    </div>
                )}
            </div>
        </article>
    );
};

const SignalPlanEditor: React.FC<SignalPlanEditorProps> = ({
    nodeId,
    signals,
    networkData,
    turnGroups,
    onHighlightTurnGroup,
    onUpdateRecord,
    onDeleteRecords,
}) => {
    const planOwner = signals.find(signal => Array.isArray(signal.plans)) ?? signals[0];
    const plans = [...(planOwner?.plans ?? [])].sort(numericSort);
    const selectableTurnGroups = useMemo(
        () => turnGroups.filter(group => group.selectable && group.turnId != null),
        [turnGroups],
    );
    const turnIds = useMemo(
        () => turnGroups.map(group => group.turnId).filter((turnId): turnId is string => turnId != null),
        [turnGroups],
    );
    const issues = useMemo(
        () => validateSignalPlans(plans, turnIds),
        [plans, turnIds],
    );
    const addPlan = () => {
        if (!planOwner?.__guid) return;
        const planId = nextNumericId(plans);
        const planGuid = nextIndexedGuid(plans, "plans", planOwner.__guid);
        onUpdateRecord({
            id: planId,
            cycle: "0",
            offset: "0",
            phases: [],
            __guid: planGuid,
            featureType: "plans",
            parentGuid: planOwner.__guid,
        });
    };
    const autoGeneratePlans = () => {
        if (!planOwner?.__guid) return;
        const templates = buildDefaultSignalPlansForNode(networkData, nodeId, signals);
        const existingIds = new Set(plans.map(plan => String(plan.id)));
        const missingTemplates = templates.filter(plan => !existingIds.has(String(plan.id)));
        if (missingTemplates.length === 0) {
            useMessageStore.getState().setMessage({
                type: "alert",
                text: "백엔드 기본 규칙의 P0(평시)과 P1(혼잡)이 이미 존재합니다.",
                onClose: () => {},
            });
            return;
        }

        const createdPlans: EditableSignalPlan[] = [];
        for (const template of missingTemplates) {
            const planGuid = nextIndexedGuid([...plans, ...createdPlans], "plans", planOwner.__guid);
            const phases = (template.phases ?? []).map((phase, index) => ({
                ...phase,
                __guid: `${planGuid}.phases-${index}`,
                featureType: "phases",
                parentGuid: planGuid,
            }));
            createdPlans.push({
                ...template,
                phases,
                __guid: planGuid,
                featureType: "plans",
                parentGuid: planOwner.__guid,
            });
        }
        onUpdateRecord({
            ...planOwner,
            plans: [...(planOwner.plans ?? []), ...createdPlans],
        });
    };

    const addPhase = (plan: EditableSignalPlan) => {
        if (!plan.__guid) return;
        const phases = plan.phases ?? [];
        onUpdateRecord({
            id: nextNumericId(phases),
            duration: "",
            turnList: "",
            __guid: nextIndexedGuid(phases, "phases", plan.__guid),
            featureType: "phases",
            parentGuid: plan.__guid,
        });
    };

    const deletePlan = (plan: EditableSignalPlan) => {
        if (!plan.__guid) return;
        if (window.confirm(`P${plan.id}을 삭제하시겠습니까?`)) {
            onDeleteRecords([plan.__guid]);
        }
    };

    const applyTurnList = (plan: EditableSignalPlan, phase: EditableSignalPhase) => {
        const ownerWithCandidatePlan = {
            ...planOwner,
            plans: plans.map(item => item.__guid === plan.__guid
                ? {
                    ...item,
                    phases: (item.phases ?? []).map(current =>
                        current.__guid === phase.__guid ? phase : current),
                }
                : item),
        };
        const signalsWithCandidate = signals.map(signal =>
            signal.__guid === planOwner?.__guid ? ownerWithCandidatePlan : signal,
        );
        const conflicts = uniqueConflicts(
            signalsWithCandidate.flatMap(signal =>
                checkManualSignalEditConflicts(networkData, signalsWithCandidate as any, signal as any),
            ),
        );
        if (confirmPlanConflicts(conflicts)) onUpdateRecord(phase);
    };

    if (!planOwner) {
        return <div style={emptyStyle}>이 교차로에는 Signal 레코드가 없어 Plan을 연결할 수 없습니다.</div>;
    }

    return (
        <div style={{
            width: "100%",
            height: "100%",
            flex: 1,
            boxSizing: "border-box",
            overflowY: "auto",
            overflowX: "hidden",
            padding: 12,
            minHeight: 0,
        }}>
            <div style={toolbarStyle}>
                <div>
                    <strong style={{ color: "var(--signal-text-primary)", fontSize: 12 }}>교차로 #{nodeId} 신호 Plan</strong>
                    <div style={{ color: "var(--signal-text-muted)", fontSize: 10, marginTop: 3 }}>
                        Plan {plans.length}개 · 선택 가능한 진입 방향 {selectableTurnGroups.length}개
                    </div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    {issues.length > 0 && <span style={issueBadgeStyle}>오류 {issues.length}</span>}
                    <button type="button" onClick={autoGeneratePlans} style={autoGenerateButtonStyle}>
                        ⚡ PLAN 자동 생성
                    </button>
                    <button type="button" onClick={addPlan} style={primaryButtonStyle}>+ Plan 추가</button>
                </div>
            </div>

            {plans.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    {plans.map(plan => (
                        <PlanCard
                            key={plan.__guid ?? String(plan.id)}
                            plan={plan}
                            initiallyExpanded={false}
                            issues={issues.filter(issue => issue.planId === String(plan.id ?? "").trim())}
                            turnGroups={selectableTurnGroups}
                            onUpdateRecord={onUpdateRecord}
                            onDeletePlan={() => deletePlan(plan)}
                            onAddPhase={() => addPhase(plan)}
                            onDeletePhase={phase => {
                                if (phase.__guid) onDeleteRecords([phase.__guid]);
                            }}
                            onTurnListChange={phase => applyTurnList(plan, phase)}
                            onHighlightTurnGroup={onHighlightTurnGroup}
                        />
                    ))}
                </div>
            ) : (
                <div style={emptyStyle}>
                    <div style={{ color: "var(--signal-text-primary)", fontSize: 14, fontWeight: 700 }}>이 교차로에 신호 Plan이 없습니다.</div>
                    <div style={{ marginTop: 6 }}>신호 TOD에서 사용할 P0/P1을 만들려면 Plan을 먼저 추가하세요.</div>
                    <button type="button" onClick={addPlan} style={{ ...primaryButtonStyle, marginTop: 14 }}>
                        + 첫 Plan 추가
                    </button>
                    <button type="button" onClick={autoGeneratePlans} style={{ ...autoGenerateButtonStyle, marginTop: 8 }}>
                        ⚡ P0/P1 자동 생성
                    </button>
                </div>
            )}
        </div>
    );
};

const inputStyle: React.CSSProperties = {
    height: 29,
    boxSizing: "border-box",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-surface-1-rgb))",
    color: "var(--signal-text-primary)",
    padding: "4px 7px",
    fontSize: 11,
    outline: "none",
};

const toolbarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    minHeight: 42,
    padding: "7px 10px",
    border: "1px solid rgb(var(--signal-border-subtle-rgb))",
    borderRadius: 7,
    background: "rgb(var(--signal-surface-1-rgb))",
};

const planCardStyle: React.CSSProperties = {
    border: "2px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 9,
    background: "rgb(var(--signal-surface-1-rgb))",
    padding: 11,
    overflow: "hidden",
};

const planHeaderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 52,
    padding: "8px 12px",
    borderBottom: "1px solid rgb(var(--signal-border-rgb))",
    margin: "-11px -11px 11px",
    background: "linear-gradient(90deg, rgb(var(--signal-border-subtle-rgb)) 0%, rgb(var(--signal-surface-2-rgb)) 60%, rgb(var(--signal-surface-1-rgb)) 100%)",
};

const planHeaderMainStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    minWidth: 0,
};

const planIdentityStyle: React.CSSProperties = {
    minWidth: 112,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "4px 8px",
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 6,
    background: "rgb(var(--signal-surface-3-rgb))",
};

const planIdentityLabelStyle: React.CSSProperties = {
    color: "rgb(var(--signal-accent-text-rgb))",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.12em",
};

const planIdBadgeStyle: React.CSSProperties = {
    minWidth: 42,
    boxSizing: "border-box",
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 5,
    padding: "4px 8px",
    background: "rgb(var(--signal-border-rgb))",
    color: "var(--signal-text-primary)",
    fontSize: 13,
    textAlign: "center",
};

const planPhaseCountStyle: React.CSSProperties = {
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 10,
    padding: "3px 8px",
    background: "rgb(var(--signal-surface-3-rgb))",
    color: "var(--signal-text-secondary)",
    fontSize: 9,
    whiteSpace: "nowrap",
};

const phaseRowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "9px 11px",
    border: "1px solid rgb(var(--signal-border-subtle-rgb))",
    borderRadius: 8,
    background: "rgb(var(--signal-surface-2-rgb))",
};

const phaseHeaderStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 9,
    paddingBottom: 9,
    borderBottom: "1px solid rgb(var(--signal-border-subtle-rgb))",
};

const phaseOrderStyle: React.CSSProperties = {
    width: 25,
    height: 25,
    borderRadius: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    background: "rgb(var(--signal-border-rgb))",
    color: "var(--signal-text-primary)",
    fontSize: 10,
    fontWeight: 800,
};

const accordionChevronStyle: React.CSSProperties = {
    width: 18,
    flexShrink: 0,
    color: "rgb(var(--signal-accent-text-rgb))",
    fontSize: 9,
    textAlign: "center",
};

const phaseTimeStyle: React.CSSProperties = {
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 9,
    padding: "2px 7px",
    background: "rgb(var(--signal-surface-3-rgb))",
    color: "var(--signal-text-secondary)",
    fontSize: 9,
    fontFamily: "monospace",
};

const activeMovementAreaStyle: React.CSSProperties = {
    width: "100%",
};

const activeMovementListStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))",
    gap: 6,
    marginTop: 7,
};

const activeMovementChipStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    minHeight: 54,
    display: "grid",
    gridTemplateColumns: "50px minmax(120px, 1fr) auto",
    alignItems: "center",
    gap: 9,
    padding: "7px 9px",
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 7,
    background: "linear-gradient(135deg, rgb(var(--signal-border-subtle-rgb)) 0%, rgb(var(--signal-surface-3-rgb)) 100%)",
    color: "var(--signal-text-primary)",
    textAlign: "left",
    fontSize: 10,
    cursor: "pointer",
};

const activeTurnBadgeStyle: React.CSSProperties = {
    minWidth: 48,
    boxSizing: "border-box",
    border: "1px solid rgb(var(--signal-accent-text-rgb))",
    borderRadius: 6,
    padding: "6px 8px",
    color: "var(--signal-text-primary)",
    background: "rgb(var(--signal-border-accent-rgb))",
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "monospace",
    textAlign: "center",
};

const activeDirectionStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--signal-text-primary)",
};

const activeMovementInfoStyle: React.CSSProperties = {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
};

const approachLinkStyle: React.CSSProperties = {
    color: "var(--signal-text-muted)",
    fontSize: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
};

const mapHighlightHintStyle: React.CSSProperties = {
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 9,
    padding: "2px 6px",
    color: "var(--signal-text-secondary)",
    fontSize: 8,
    whiteSpace: "nowrap",
};

const connectionHoverListStyle: React.CSSProperties = {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 2,
    paddingTop: 7,
    borderTop: "1px solid rgb(var(--signal-border-accent-rgb))",
};

const connectionHoverTitleStyle: React.CSSProperties = {
    color: "rgb(var(--signal-accent-text-rgb))",
    fontSize: 9,
    fontWeight: 800,
};

const connectionHoverRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "54px minmax(130px, 1fr) minmax(90px, auto)",
    alignItems: "center",
    gap: 7,
    minHeight: 25,
    padding: "3px 7px",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-surface-3-rgb))",
    color: "var(--signal-text-secondary)",
    fontSize: 8,
};

const connectionMissingStyle: React.CSSProperties = {
    padding: "6px 7px",
    border: "1px dashed rgb(var(--signal-danger-border-rgb))",
    borderRadius: 5,
    color: "var(--signal-danger)",
    background: "rgb(var(--signal-danger-surface-rgb))",
    fontSize: 8,
};

const noMovementStyle: React.CSSProperties = {
    padding: "10px",
    border: "1px dashed rgb(var(--signal-danger-border-rgb))",
    borderRadius: 6,
    color: "var(--signal-warning)",
    background: "rgb(var(--signal-warning-surface-rgb))",
    fontSize: 10,
};

const changeMovementButtonStyle: React.CSSProperties = {
    height: 31,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--signal-accent)",
    borderRadius: 6,
    background: "rgb(var(--signal-border-accent-rgb))",
    color: "var(--signal-text-primary)",
    padding: "0 12px",
    fontSize: 10,
    fontWeight: 800,
    boxShadow: "0 3px 10px rgba(var(--signal-accent-rgb), 0.35)",
    cursor: "pointer",
};

const movementChooserStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 7,
    background: "rgb(var(--signal-surface-1-rgb))",
};

const phaseDeleteButtonStyle: React.CSSProperties = {
    height: 29,
    border: "1px solid transparent",
    borderRadius: 5,
    background: "transparent",
    color: "var(--signal-danger)",
    padding: "0 7px",
    fontSize: 9,
    cursor: "pointer",
};

const compactFieldStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
};

const cycleSummaryStyle: React.CSSProperties = {
    height: 31,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 10px",
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 6,
    background: "rgb(var(--signal-surface-2-rgb))",
    color: "var(--signal-text-primary)",
    fontSize: 10,
};

const fieldLabelStyle: React.CSSProperties = {
    color: "var(--signal-text-muted)",
    fontSize: 9,
    fontWeight: 700,
};

const turnCardStyle: React.CSSProperties = {
    position: "relative",
    minHeight: 62,
    border: "1px solid",
    borderRadius: 6,
    padding: "8px 54px 8px 9px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 4,
    textAlign: "left",
    fontSize: 10,
    cursor: "pointer",
};

const candidateTurnHeadingStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
};

const candidateTurnBadgeStyle: React.CSSProperties = {
    minWidth: 42,
    boxSizing: "border-box",
    border: "1px solid",
    borderRadius: 5,
    padding: "5px 7px",
    fontSize: 11,
    fontWeight: 900,
    fontFamily: "monospace",
    textAlign: "center",
};

const candidateStateStyle: React.CSSProperties = {
    position: "absolute",
    right: 9,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 8,
    fontWeight: 800,
};

const primaryButtonStyle: React.CSSProperties = {
    height: 29,
    border: "1px solid rgb(var(--signal-border-accent-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-border-rgb))",
    color: "var(--signal-text-primary)",
    padding: "0 11px",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
};

const autoGenerateButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    borderColor: "rgb(var(--signal-warning-border-rgb))",
    background: "rgb(var(--signal-warning-surface-rgb))",
    color: "var(--signal-warning)",
};

const secondaryButtonStyle: React.CSSProperties = {
    height: 28,
    border: "1px solid rgb(var(--signal-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-surface-2-rgb))",
    color: "var(--signal-text-secondary)",
    padding: "0 9px",
    fontSize: 10,
    cursor: "pointer",
};

const deleteButtonStyle: React.CSSProperties = {
    height: 28,
    border: "1px solid rgb(var(--signal-danger-border-rgb))",
    borderRadius: 5,
    background: "rgb(var(--signal-danger-surface-rgb))",
    color: "var(--signal-danger)",
    padding: "0 9px",
    fontSize: 10,
    cursor: "pointer",
};

const issueBoxStyle: React.CSSProperties = {
    marginBottom: 9,
    padding: "7px 9px",
    border: "1px solid rgb(var(--signal-danger-border-rgb))",
    borderRadius: 6,
    background: "rgb(var(--signal-danger-surface-rgb))",
    color: "var(--signal-danger)",
    fontSize: 10,
    lineHeight: 1.55,
};

const issueBadgeStyle: React.CSSProperties = {
    border: "1px solid rgb(var(--signal-danger-border-rgb))",
    borderRadius: 10,
    background: "rgb(var(--signal-danger-surface-rgb))",
    color: "var(--signal-danger)",
    padding: "3px 7px",
    fontSize: 9,
    fontWeight: 700,
};

const phaseEmptyStyle: React.CSSProperties = {
    padding: 15,
    border: "1px dashed rgb(var(--signal-border-rgb))",
    borderRadius: 6,
    color: "var(--signal-text-muted)",
    textAlign: "center",
    fontSize: 10,
};

const emptyStyle: React.CSSProperties = {
    margin: "45px auto",
    maxWidth: 430,
    padding: 24,
    border: "1px dashed rgb(var(--signal-border-rgb))",
    borderRadius: 8,
    color: "var(--signal-text-muted)",
    textAlign: "center",
    fontSize: 11,
    background: "rgb(var(--signal-surface-1-rgb))",
};

export default SignalPlanEditor;
