import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSignalTodHistoryStore, useSignalTodStore } from "@stores/useSignalTodStore";
import { useSignalStore } from "@stores/useSignalStore";
import { useMessageStore } from "@stores/useMessageStore";
import {
    buildSignalPlanIdsByNode,
    findFirstTodGap,
    formatTodTime,
    nextIndexedGuid,
    parseTodTime,
    TodPlanLike,
    validateTodSchedule,
} from "@utils/signalEditorUtils";
import { generateDefaultSignalTod } from "@utils/signalGenerationRules";

interface Plan extends TodPlanLike {
    __guid?: string;
    featureType?: string;
    parentGuid?: string;
}

interface TodNode {
    id: string | number;
    plans: Plan[];
    __guid?: string;
    featureType?: string;
    [key: string]: any;
}

interface TodData {
    id?: number;
    nodes?: TodNode[];
    [key: string]: any;
}

const PLAN_COLORS = [
    "#4f8ef7", "#e7654f", "#4fc97a", "#f7c44f",
    "#b064f7", "#4fcfe8", "#e85ba8", "#8893a8",
];

const HOUR_MARKS = Array.from({ length: 25 }, (_, index) => index);

const ISSUE_LABELS: Record<string, string> = {
    empty: "시간 구간 없음",
    "invalid-time": "시간 형식 오류",
    reversed: "시작·종료 오류",
    overlap: "시간 중복",
    gap: "빈 시간대",
    "unknown-plan": "신호 Plan 연결 오류",
};

function planColor(planId: number | string): string {
    const numeric = Number(planId);
    const index = Number.isFinite(numeric)
        ? Math.abs(numeric) % PLAN_COLORS.length
        : Math.abs(String(planId).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % PLAN_COLORS.length;
    return PLAN_COLORS[index]!;
}

function percentage(minutes: number): string {
    return `${((minutes / 1440) * 100).toFixed(4)}%`;
}

function editablePlanIds(node: TodNode, definedPlanIds: string[]): string[] {
    if (definedPlanIds.length > 0) return definedPlanIds;
    return Array.from(new Set((node.plans ?? []).map(plan => String(plan.id))))
        .sort((left, right) => Number(left) - Number(right));
}

function resolveNodeGuid(node: TodNode): string | undefined {
    if (node.__guid) return node.__guid;
    const explicitParent = node.plans?.find(plan => plan.parentGuid)?.parentGuid;
    if (explicitParent) return explicitParent;
    const childGuid = node.plans?.find(plan => plan.__guid)?.__guid;
    return childGuid?.match(/^(.*)\.plans-\d+$/)?.[1];
}

interface DragPreview {
    nodeId: string;
    planGuid: string;
    neighborGuid?: string;
    edge: "start" | "end";
    minutes: number;
}

interface SignalTodTimelineEditorProps {
    containerHeight?: number;
    embeddedNodeId?: string | null;
    hideSidebar?: boolean;
}

const SignalTodTimelineEditor: React.FC<SignalTodTimelineEditorProps> = ({
    containerHeight = 400,
    embeddedNodeId,
    hideSidebar = false,
}) => {
    const rawData = useSignalTodStore((state: any) => state.currentJsonData) as TodData | undefined;
    const signalData = useSignalStore((state: any) => state.currentJsonData) as { signals?: any[] } | undefined;
    const nodes = useMemo<TodNode[]>(() => rawData?.nodes ?? [], [rawData]);
    const planIdsByNode = useMemo(
        () => buildSignalPlanIdsByNode(signalData?.signals ?? []),
        [signalData],
    );
    const [search, setSearch] = useState("");
    const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
    const selectedNodeId = embeddedNodeId !== undefined ? embeddedNodeId : internalSelectedNodeId;
    const [selectedPlanGuid, setSelectedPlanGuid] = useState<string | null>(null);
    const [issuesExpanded, setIssuesExpanded] = useState(false);
    const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
    const dragControllerRef = useRef<AbortController | null>(null);

    const nodeIssues = useMemo(() => {
        const result = new Map<string, ReturnType<typeof validateTodSchedule>>();
        for (const node of nodes) {
            const nodeId = String(node.id);
            result.set(nodeId, validateTodSchedule(node.plans ?? [], planIdsByNode.get(nodeId) ?? []));
        }
        return result;
    }, [nodes, planIdsByNode]);

    const visibleNodes = useMemo(() => {
        const query = search.trim().toLowerCase();
        return nodes.filter(node => !query || String(node.id).toLowerCase().includes(query));
    }, [nodes, search]);

    useEffect(() => {
        if (embeddedNodeId !== undefined) {
            setSelectedPlanGuid(null);
            return;
        }
        if (visibleNodes.length === 0) {
            setInternalSelectedNodeId(null);
            setSelectedPlanGuid(null);
            return;
        }
        if (!visibleNodes.some(node => String(node.id) === selectedNodeId)) {
            setInternalSelectedNodeId(String(visibleNodes[0]!.id));
            setSelectedPlanGuid(null);
        }
    }, [embeddedNodeId, selectedNodeId, visibleNodes]);

    useEffect(() => () => dragControllerRef.current?.abort(), []);

    useEffect(() => {
        setIssuesExpanded(false);
    }, [selectedNodeId]);

    const applyPlan = useCallback((nodeId: string, currentGuid: string, updated: Plan): string | null => {
        const node = nodes.find(item => String(item.id) === nodeId);
        if (!node) return "교차로 TOD 정보를 찾을 수 없습니다.";
        const nextPlans = node.plans.map(plan => plan.__guid === currentGuid ? updated : plan);
        const blockingIssue = validateTodSchedule(nextPlans, planIdsByNode.get(nodeId) ?? [])
            .find(issue => ["invalid-time", "reversed", "overlap"].includes(issue.code));
        if (blockingIssue) return blockingIssue.message;
        useSignalTodStore.getState().updateCurrentJsonData(updated as any, useSignalTodHistoryStore);
        return null;
    }, [nodes, planIdsByNode]);

    const deletePlan = useCallback((guid: string) => {
        useSignalTodStore.getState().removeRecordsByGuid([guid], useSignalTodHistoryStore);
        setSelectedPlanGuid(null);
    }, []);

    const addPlan = useCallback((node: TodNode) => {
        const nodeId = String(node.id);
        const planIds = editablePlanIds(node, planIdsByNode.get(nodeId) ?? []);
        const gap = findFirstTodGap(node.plans ?? []);
        const parentGuid = resolveNodeGuid(node);
        if (planIds.length === 0 || !parentGuid) return;

        const splittablePlans = (node.plans ?? [])
            .map(plan => ({
                plan,
                start: parseTodTime(plan.startTime, false),
                end: parseTodTime(plan.endTime, true),
            }))
            .filter((item): item is { plan: Plan; start: number; end: number } =>
                !!item.plan.__guid &&
                item.start != null &&
                item.end != null &&
                item.end - item.start >= 10,
            );
        const splitTarget = splittablePlans.find(item => item.plan.__guid === selectedPlanGuid)
            ?? splittablePlans.sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
        if (!gap && !splitTarget) return;

        const newGuid = nextIndexedGuid(node.plans ?? [], "plans", parentGuid);
        const sourcePlanId = splitTarget ? String(splitTarget.plan.id) : null;
        const nextPlanId = planIds.find(id => id !== sourcePlanId) ?? planIds[0]!;
        const startTime = gap?.startTime ?? formatTodTime(
            Math.max(
                splitTarget!.start + 5,
                Math.min(
                    splitTarget!.end - 5,
                    Math.round(((splitTarget!.start + splitTarget!.end) / 2) / 5) * 5,
                ),
            ),
        );
        const plan: Plan = {
            id: Number.isFinite(Number(nextPlanId)) ? Number(nextPlanId) : nextPlanId,
            startTime,
            endTime: gap?.endTime ?? splitTarget!.plan.endTime,
            __guid: newGuid,
            featureType: "plans",
            parentGuid,
        };

        if (!gap && splitTarget) {
            const shortened = { ...splitTarget.plan, endTime: startTime };
            if (node.__guid) {
                const nextPlans = (node.plans ?? []).map(item =>
                    item.__guid === shortened.__guid ? shortened : item,
                );
                nextPlans.push(plan);
                useSignalTodStore.getState().updateCurrentJsonData(
                    { ...node, plans: nextPlans } as any,
                    useSignalTodHistoryStore,
                );
            } else {
                useSignalTodStore.getState().updateCurrentJsonData(shortened as any, useSignalTodHistoryStore);
                useSignalTodStore.getState().updateCurrentJsonData(plan as any, useSignalTodHistoryStore);
            }
        } else {
            useSignalTodStore.getState().updateCurrentJsonData(plan as any, useSignalTodHistoryStore);
        }
        setInternalSelectedNodeId(nodeId);
        setSelectedPlanGuid(newGuid);
    }, [planIdsByNode, selectedPlanGuid]);

    const autoGenerateTod = useCallback((nodeId: string) => {
        const definedPlanIds = [...(planIdsByNode.get(nodeId) ?? [])];
        if (definedPlanIds.length === 0) {
            useMessageStore.getState().setMessage({
                type: "alert",
                text: "TOD 자동 생성에 사용할 Signal PLAN이 없습니다.",
                onClose: () => {},
            });
            return;
        }

        const existingNode = nodes.find(node => String(node.id) === nodeId);
        const run = () => {
            const nodeGuid = existingNode
                ? resolveNodeGuid(existingNode) ?? nextIndexedGuid(nodes, "nodes")
                : nextIndexedGuid(nodes, "nodes");
            const schedule = generateDefaultSignalTod(definedPlanIds);
            const plans = schedule.map((plan, index) => ({
                ...plan,
                __guid: `${nodeGuid}.plans-${index}`,
                featureType: "plans",
                parentGuid: nodeGuid,
            }));
            const nextNode: TodNode = {
                ...(existingNode ?? {}),
                id: nodeId,
                plans,
                __guid: nodeGuid,
                featureType: "nodes",
            };
            const store = useSignalTodStore.getState();
            if (rawData && existingNode && !existingNode.__guid) {
                store.setCurrentJsonData({
                    ...rawData,
                    nodes: (rawData.nodes ?? []).map(node => node === existingNode ? nextNode : node),
                } as any);
                store.setChange(true);
            } else if (rawData) {
                store.updateCurrentJsonData(nextNode as any, useSignalTodHistoryStore);
            } else {
                store.setCurrentJsonData({ id: 0, nodes: [nextNode] } as any);
                store.setChange(true);
            }
            setInternalSelectedNodeId(nodeId);
            setSelectedPlanGuid(null);
        };

        if ((existingNode?.plans ?? []).length > 0) {
            useMessageStore.getState().setMessage({
                type: "confirm",
                text: `교차로 #${nodeId}의 기존 TOD ${(existingNode?.plans ?? []).length}개 구간을 백엔드 기본 시간대로 다시 생성하시겠습니까?`,
                onConfirm: run,
            });
        } else {
            run();
        }
    }, [nodes, planIdsByNode, rawData]);

    const commitBoundary = useCallback((
        node: TodNode,
        planGuid: string,
        edge: "start" | "end",
        minutes: number,
    ) => {
        const sortedPlans = [...(node.plans ?? [])].sort((left, right) =>
            (parseTodTime(left.startTime, false) ?? 0) - (parseTodTime(right.startTime, false) ?? 0),
        );
        const index = sortedPlans.findIndex(plan => plan.__guid === planGuid);
        if (index < 0) return;

        const changedGuids = new Set<string>();
        const nextPlans = sortedPlans.map(plan => ({ ...plan }));
        const target = nextPlans[index]!;
        const nextTime = formatTodTime(minutes);

        if (edge === "start" && index > 0) {
            const previous = nextPlans[index - 1]!;
            target.startTime = nextTime;
            previous.endTime = nextTime;
            if (target.__guid) changedGuids.add(target.__guid);
            if (previous.__guid) changedGuids.add(previous.__guid);
        } else if (edge === "end" && index < nextPlans.length - 1) {
            const next = nextPlans[index + 1]!;
            target.endTime = nextTime;
            next.startTime = nextTime;
            if (target.__guid) changedGuids.add(target.__guid);
            if (next.__guid) changedGuids.add(next.__guid);
        } else {
            return;
        }

        if (node.__guid) {
            useSignalTodStore.getState().updateCurrentJsonData(
                { ...node, plans: nextPlans } as any,
                useSignalTodHistoryStore,
            );
            return;
        }
        nextPlans
            .filter(plan => plan.__guid && changedGuids.has(plan.__guid))
            .forEach(plan => useSignalTodStore.getState().updateCurrentJsonData(plan as any, useSignalTodHistoryStore));
    }, []);

    const startBoundaryDrag = useCallback((
        event: React.PointerEvent<HTMLDivElement>,
        node: TodNode,
        plan: Plan,
        edge: "start" | "end",
    ) => {
        event.preventDefault();
        event.stopPropagation();
        if (!plan.__guid) return;

        const timeline = event.currentTarget.closest<HTMLElement>("[data-tod-timeline]");
        if (!timeline) return;
        const timelineWidth = timeline.getBoundingClientRect().width;
        if (timelineWidth <= 0) return;

        const sortedPlans = [...(node.plans ?? [])].sort((left, right) =>
            (parseTodTime(left.startTime, false) ?? 0) - (parseTodTime(right.startTime, false) ?? 0),
        );
        const index = sortedPlans.findIndex(item => item.__guid === plan.__guid);
        if (index < 0) return;

        const startMinutes = parseTodTime(plan.startTime, false);
        const endMinutes = parseTodTime(plan.endTime, true);
        if (startMinutes == null || endMinutes == null) return;

        const previous = sortedPlans[index - 1];
        const next = sortedPlans[index + 1];
        if ((edge === "start" && !previous) || (edge === "end" && !next)) return;

        const min = edge === "start"
            ? (parseTodTime(previous!.startTime, false) ?? 0) + 5
            : startMinutes + 5;
        const max = edge === "start"
            ? endMinutes - 5
            : (parseTodTime(next!.endTime, true) ?? 1440) - 5;
        const original = edge === "start" ? startMinutes : endMinutes;
        const neighborGuid = edge === "start" ? previous?.__guid : next?.__guid;
        const startX = event.clientX;
        let latestMinutes = original;

        dragControllerRef.current?.abort();
        const controller = new AbortController();
        dragControllerRef.current = controller;

        const updatePreview = (pointerEvent: PointerEvent) => {
            const deltaMinutes = ((pointerEvent.clientX - startX) / timelineWidth) * 1440;
            latestMinutes = Math.max(min, Math.min(max, Math.round((original + deltaMinutes) / 5) * 5));
            setDragPreview({
                nodeId: String(node.id),
                planGuid: plan.__guid!,
                neighborGuid,
                edge,
                minutes: latestMinutes,
            });
        };
        const finishDrag = () => {
            controller.abort();
            dragControllerRef.current = null;
            setDragPreview(null);
            if (latestMinutes !== original) {
                commitBoundary(node, plan.__guid!, edge, latestMinutes);
            }
        };

        window.addEventListener("pointermove", updatePreview, { signal: controller.signal });
        window.addEventListener("pointerup", finishDrag, { signal: controller.signal, once: true });
        window.addEventListener("pointercancel", finishDrag, { signal: controller.signal, once: true });
    }, [commitBoundary]);

    if (!nodes.length) {
        const emptyNodeId = embeddedNodeId ?? null;
        const canGenerate = !!emptyNodeId && (planIdsByNode.get(emptyNodeId)?.length ?? 0) > 0;
        return (
            <div style={emptyStateStyle}>
                <div style={{ fontSize: 15, color: "#bac5d8", marginBottom: 8 }}>신호 TOD 데이터가 없습니다.</div>
                <div>신호 PLAN을 기준으로 백엔드 기본 TOD 시간표를 생성할 수 있습니다.</div>
                {canGenerate && (
                    <button
                        type="button"
                        onClick={() => autoGenerateTod(emptyNodeId!)}
                        style={{ ...toolbarButtonStyle, marginTop: 14, color: "#edc45e", borderColor: "#75591e" }}
                    >
                        ⚡ TOD 자동 생성
                    </button>
                )}
            </div>
        );
    }

    const bodyHeight = Math.max(190, containerHeight - 62);
    const activeNode = nodes.find(node => String(node.id) === selectedNodeId) ?? null;
    const activeNodeId = activeNode ? String(activeNode.id) : null;
    const activePlans = [...(activeNode?.plans ?? [])].sort((left, right) =>
        (parseTodTime(left.startTime, false) ?? 0) - (parseTodTime(right.startTime, false) ?? 0),
    );
    const activeIssues = activeNodeId ? nodeIssues.get(activeNodeId) ?? [] : [];
    const activeAllowedPlanIds = activeNode && activeNodeId
        ? editablePlanIds(activeNode, planIdsByNode.get(activeNodeId) ?? [])
        : [];
    const activeParentGuid = activeNode ? resolveNodeGuid(activeNode) : undefined;
    const activeGap = activeNode ? findFirstTodGap(activeNode.plans ?? []) : null;
    const selectedPlan = activePlans.find(plan => plan.__guid === selectedPlanGuid) ?? null;
    const selectablePlanIds = selectedPlan
        ? Array.from(new Set([...activeAllowedPlanIds, String(selectedPlan.id)]))
        : activeAllowedPlanIds;
    const activeCanSplit = activePlans.some(plan => {
        const start = parseTodTime(plan.startTime, false);
        const end = parseTodTime(plan.endTime, true);
        return !!plan.__guid && start != null && end != null && end - start >= 10;
    });
    const legendPlanIds = Array.from(new Set(activePlans.map(plan => String(plan.id))))
        .sort((a, b) => Number(a) - Number(b));

    return (
        <div style={{ display: "flex", height: bodyHeight, overflow: "hidden", background: "#080d18" }}>
            {!hideSidebar && <aside style={sidebarStyle}>
                <div style={{ padding: "9px 9px 7px", borderBottom: "1px solid #1d2739" }}>
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="교차로 ID 검색"
                        style={{ ...toolbarInputStyle, width: "100%" }}
                    />
                    <div style={{ color: "#657188", fontSize: 9, marginTop: 6 }}>
                        교차로 {visibleNodes.length}/{nodes.length}
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {visibleNodes.map(node => {
                        const nodeId = String(node.id);
                        const issues = nodeIssues.get(nodeId) ?? [];
                        const selected = selectedNodeId === nodeId;
                        return (
                            <button
                                key={nodeId}
                                onClick={() => {
                                    setInternalSelectedNodeId(nodeId);
                                    setSelectedPlanGuid(null);
                                }}
                                style={{
                                    width: "100%",
                                    minHeight: 48,
                                    padding: "8px 10px",
                                    textAlign: "left",
                                    border: "none",
                                    borderBottom: "1px solid #151e2e",
                                    borderLeft: selected ? "3px solid #4f8ef7" : "3px solid transparent",
                                    background: selected ? "#101d34" : "transparent",
                                    cursor: "pointer",
                                }}
                            >
                                <div style={{ color: selected ? "#d7e3f6" : "#96a4ba", fontSize: 11, fontWeight: 700 }}>
                                    교차로 #{nodeId}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                                    <span style={{ color: "#657188", fontSize: 9 }}>구간 {node.plans?.length ?? 0}</span>
                                    {issues.length > 0 && (
                                        <span title={issues.map(issue => issue.message).join("\n")} style={issueBadgeStyle}>
                                            오류 {issues.length}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                    {visibleNodes.length === 0 && (
                        <div style={{ padding: 18, textAlign: "center", color: "#6e7a8f", fontSize: 10 }}>
                            검색 결과가 없습니다.
                        </div>
                    )}
                </div>
            </aside>}

            <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {activeNode ? (
                    <>
                        <div style={toolbarStyle}>
                            <div>
                                <strong style={{ color: "#cbd7e9", fontSize: 12 }}>교차로 #{activeNodeId}</strong>
                                <div style={{ color: "#69768b", fontSize: 9, marginTop: 3 }}>
                                    TOD 구간 {activePlans.length}개
                                </div>
                            </div>
                            {activeIssues.length > 0 && (
                                <button
                                    onClick={() => setIssuesExpanded(value => !value)}
                                    aria-expanded={issuesExpanded}
                                    style={{ ...issueBadgeStyle, cursor: "pointer" }}
                                >
                                    유효성 오류 {activeIssues.length} {issuesExpanded ? "▲" : "▼"}
                                </button>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                {legendPlanIds.map(planId => (
                                    <span key={planId} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#8794a9", fontSize: 9 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: planColor(planId) }} />
                                        P{planId}
                                    </span>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => autoGenerateTod(activeNodeId!)}
                                style={{ ...toolbarButtonStyle, marginLeft: "auto", color: "#edc45e", borderColor: "#75591e" }}
                            >
                                ⚡ TOD 자동 생성
                            </button>
                            <button
                                onClick={() => addPlan(activeNode)}
                                disabled={(!activeGap && !activeCanSplit) || activeAllowedPlanIds.length === 0 || !activeParentGuid}
                                title={
                                    activeAllowedPlanIds.length === 0
                                            ? "추가에 사용할 Plan이 없습니다."
                                        : !activeParentGuid
                                            ? "TOD 교차로의 편집 경로를 찾을 수 없습니다."
                                            : activeGap
                                                ? `${activeGap.startTime}–${activeGap.endTime} 빈 구간에 추가`
                                                : activeCanSplit
                                                    ? `${selectedPlan ? "선택한" : "가장 긴"} 구간을 나누어 추가`
                                                    : "나눌 수 있는 시간 구간이 없습니다."
                                }
                                style={{
                                    ...toolbarButtonStyle,
                                    color: "#83adf5",
                                    opacity: (!activeGap && !activeCanSplit) || activeAllowedPlanIds.length === 0 || !activeParentGuid ? 0.35 : 1,
                                    cursor: (!activeGap && !activeCanSplit) || activeAllowedPlanIds.length === 0 || !activeParentGuid ? "not-allowed" : "pointer",
                                }}
                            >
                                + 구간 추가
                            </button>
                        </div>

                        {issuesExpanded && activeIssues.length > 0 && (
                            <div style={issuePanelStyle}>
                                <div style={{ color: "#f3b0b0", fontWeight: 700, marginBottom: 6 }}>
                                    이 교차로에서 확인이 필요한 항목
                                </div>
                                {activeIssues.map((issue, index) => (
                                    <div
                                        key={`${issue.code}-${index}`}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "112px 1fr",
                                            gap: 8,
                                            padding: "4px 0",
                                            borderTop: index === 0 ? "none" : "1px solid #3a2630",
                                        }}
                                    >
                                        <strong style={{ color: issue.code === "gap" ? "#f5bd72" : "#ff9898" }}>
                                            {ISSUE_LABELS[issue.code] ?? issue.code}
                                        </strong>
                                        <span style={{ color: "#c8b8bd" }}>{issue.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedPlan && selectedPlan.__guid && (
                            <div style={selectionBarStyle}>
                                <span style={{ color: "#8190a7" }}>적용 신호 계획</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    {selectablePlanIds.map(id => {
                                        const selected = String(selectedPlan.id) === id;
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => applyPlan(activeNodeId!, selectedPlan.__guid!, {
                                                    ...selectedPlan,
                                                    id: Number.isFinite(Number(id)) ? Number(id) : id,
                                                })}
                                                title={`이 시간 구간에 Plan ${id} 적용`}
                                                style={{
                                                    minWidth: 42,
                                                    border: selected ? "2px solid #fff" : "1px solid rgba(255,255,255,0.25)",
                                                    background: planColor(id),
                                                    color: "#fff",
                                                    borderRadius: 5,
                                                    padding: "4px 9px",
                                                    cursor: "pointer",
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    opacity: selected ? 1 : 0.68,
                                                    boxShadow: selected ? `0 0 0 2px ${planColor(id)}55` : "none",
                                                }}
                                            >
                                                P{id}
                                            </button>
                                        );
                                    })}
                                </div>
                                <strong style={{ color: "#cbd7e9", fontSize: 10 }}>
                                    {String(selectedPlan.startTime).slice(0, 5)}–{String(selectedPlan.endTime).slice(0, 5)}
                                </strong>
                                <span style={{ color: "#647188", fontSize: 9 }}>색상은 Plan 구분용입니다.</span>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`Plan ${selectedPlan.id} 구간을 삭제하시겠습니까?`)) {
                                            deletePlan(selectedPlan.__guid!);
                                        }
                                    }}
                                    style={{ ...toolbarButtonStyle, color: "#ef7b7b", marginLeft: "auto" }}
                                >
                                    구간 삭제
                                </button>
                            </div>
                        )}

                        <div style={{ position: "relative", height: 34, flexShrink: 0, borderBottom: "1px solid #263149", background: "#0a101c" }}>
                            {HOUR_MARKS.map(hour => (
                                <div
                                    key={hour}
                                    style={{
                                        position: "absolute",
                                        left: percentage(hour * 60),
                                        top: 0,
                                        height: "100%",
                                        borderLeft: hour % 6 === 0 ? "1px solid #4c5b79" : "1px solid #253047",
                                        paddingLeft: 4,
                                        color: hour % 6 === 0 ? "#7f8ca2" : "transparent",
                                        fontSize: 10,
                                        transform: "translateX(-1px)",
                                        boxSizing: "border-box",
                                    }}
                                >
                                    {hour % 6 === 0 ? `${String(hour).padStart(2, "0")}:00` : ""}
                                </div>
                            ))}
                        </div>

                        <div style={{ flex: 1, minHeight: 90, padding: "18px 10px", overflow: "auto" }}>
                            <div
                                data-tod-timeline
                                style={{ position: "relative", height: 48, background: "#111827", borderRadius: 5, overflow: "hidden" }}
                            >
                                {activePlans.map((plan, index) => {
                                    const baseStart = parseTodTime(plan.startTime, false);
                                    const baseEnd = parseTodTime(plan.endTime, true);
                                    if (baseStart == null || baseEnd == null || baseEnd <= baseStart) return null;

                                    let start = baseStart;
                                    let end = baseEnd;
                                    if (dragPreview?.nodeId === activeNodeId) {
                                        if (dragPreview.planGuid === plan.__guid) {
                                            if (dragPreview.edge === "start") start = dragPreview.minutes;
                                            else end = dragPreview.minutes;
                                        } else if (dragPreview.neighborGuid === plan.__guid) {
                                            if (dragPreview.edge === "start") end = dragPreview.minutes;
                                            else start = dragPreview.minutes;
                                        }
                                    }
                                    const width = end - start;
                                    const color = planColor(plan.id);
                                    const label = `P${plan.id} · ${formatTodTime(start)}–${formatTodTime(end)}`;
                                    const selected = selectedPlanGuid === plan.__guid;
                                    return (
                                        <div
                                            key={plan.__guid ?? `${plan.id}-${plan.startTime}-${plan.endTime}`}
                                            role="button"
                                            tabIndex={plan.__guid ? 0 : -1}
                                            onClick={() => plan.__guid && setSelectedPlanGuid(plan.__guid)}
                                            title={`${label} · 양쪽 경계를 드래그하여 시간 조정`}
                                            style={{
                                                position: "absolute",
                                                left: percentage(start),
                                                width: percentage(width),
                                                top: 3,
                                                bottom: 3,
                                                border: selected ? "2px solid #fff" : "1px solid rgba(255,255,255,0.15)",
                                                background: color,
                                                color: "#fff",
                                                borderRadius: 4,
                                                cursor: plan.__guid ? "pointer" : "default",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "0 9px",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                boxSizing: "border-box",
                                                userSelect: "none",
                                            }}
                                        >
                                            {index > 0 && (
                                                <div
                                                    aria-label={`${label} 시작 시각 조절`}
                                                    onPointerDown={event => startBoundaryDrag(event, activeNode, plan, "start")}
                                                    style={{ ...dragHandleStyle, left: 0 }}
                                                />
                                            )}
                                            {width >= 90 ? label : `P${plan.id}`}
                                            {index < activePlans.length - 1 && (
                                                <div
                                                    aria-label={`${label} 종료 시각 조절`}
                                                    onPointerDown={event => startBoundaryDrag(event, activeNode, plan, "end")}
                                                    style={{ ...dragHandleStyle, right: 0 }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                                {activeIssues.some(issue => issue.code === "gap") && (
                                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "1px dashed #f5ad55", borderRadius: 5 }} />
                                )}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", color: "#718097", fontSize: 9, marginTop: 8 }}>
                                <span>막대 경계를 드래그하면 맞닿은 두 구간이 5분 단위로 함께 조정됩니다.</span>
                                {dragPreview && <strong style={{ color: "#dbe7fb" }}>{formatTodTime(dragPreview.minutes)}</strong>}
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={emptyStateStyle}>
                        <div>
                            {hideSidebar && selectedNodeId
                                ? `교차로 #${selectedNodeId}의 TOD 일정이 없습니다.`
                                : "왼쪽에서 교차로를 선택해주세요."}
                        </div>
                        {selectedNodeId && (planIdsByNode.get(selectedNodeId)?.length ?? 0) > 0 && (
                            <button
                                type="button"
                                onClick={() => autoGenerateTod(selectedNodeId)}
                                style={{ ...toolbarButtonStyle, marginTop: 14, color: "#edc45e", borderColor: "#75591e" }}
                            >
                                ⚡ TOD 자동 생성
                            </button>
                        )}
                    </div>
                )}

                <div style={footerStyle}>
                    <span>막대 클릭: Plan 선택</span>
                    <span>경계 드래그: 시간 조정</span>
                    <span>＋ 구간 추가: 빈 시간대 생성 또는 기존 구간 분할</span>
                    <span style={{ marginLeft: "auto" }}>TOD는 00:00–24:00을 공백 없이 유지합니다.</span>
                </div>
            </section>
        </div>
    );
};

const toolbarStyle: React.CSSProperties = {
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderBottom: "1px solid #1e293d",
    background: "#0b121f",
    boxSizing: "border-box",
    flexShrink: 0,
};

const toolbarInputStyle: React.CSSProperties = {
    width: 155,
    background: "#111a2b",
    border: "1px solid #2b3850",
    borderRadius: 5,
    color: "#d4dcea",
    padding: "6px 8px",
    fontSize: 10,
    outline: "none",
};

const toolbarButtonStyle: React.CSSProperties = {
    border: "1px solid #2b3850",
    borderRadius: 5,
    padding: "5px 8px",
    cursor: "pointer",
    fontSize: 10,
    background: "#111a2b",
};

const sidebarStyle: React.CSSProperties = {
    width: 190,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #1e293d",
    background: "#0a101c",
};

const selectionBarStyle: React.CSSProperties = {
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 10px",
    borderBottom: "1px solid #1e293d",
    background: "#0d1626",
    fontSize: 10,
    boxSizing: "border-box",
    flexShrink: 0,
};

const dragHandleStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 8,
    zIndex: 2,
    cursor: "ew-resize",
    touchAction: "none",
    background: "rgba(255,255,255,0.22)",
    borderLeft: "1px solid rgba(255,255,255,0.45)",
    borderRight: "1px solid rgba(0,0,0,0.18)",
};

const issueBadgeStyle: React.CSSProperties = {
    background: "#3a1d25",
    border: "1px solid #713b43",
    borderRadius: 10,
    color: "#ff9292",
    padding: "1px 5px",
    fontSize: 8,
    cursor: "help",
};

const issuePanelStyle: React.CSSProperties = {
    maxHeight: 132,
    overflowY: "auto",
    padding: "8px 10px",
    borderBottom: "1px solid #59313a",
    background: "#24151c",
    fontSize: 9,
    boxSizing: "border-box",
    flexShrink: 0,
};

const footerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "6px 10px",
    borderTop: "1px solid #1e293d",
    background: "#0a101c",
    color: "#718097",
    fontSize: 9,
    flexShrink: 0,
};

const emptyStateStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
    color: "#748096",
    fontSize: 12,
    textAlign: "center",
};

export default SignalTodTimelineEditor;
