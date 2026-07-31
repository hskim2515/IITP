import React, { useCallback, useEffect, useMemo, useState } from "react";
import SignalGroupedEditor from "@component/util/SignalGroupedEditor";
import SignalPlanEditor, {
    EditableSignalRecord,
} from "@component/util/SignalPlanEditor";
import SignalTodTimelineEditor from "@component/util/SignalTodTimelineEditor";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import {
    useSignalPlanHistoryStore,
    useSignalStore,
} from "@stores/useSignalStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { deleteSignalsForNodes } from "@hooks/useNetworkSelect";
import {
    buildSignalTurnGroups,
    SIGNAL_DIRECTIONS,
} from "@utils/signalTurnGroups";
import { findSignalCandidateNodeIds } from "@utils/signal";
import * as Cesium from "cesium";
import { fromLonLat } from "ol/proj";

export type SignalWorkspaceTab = "movements" | "plans" | "tod";

interface SignalWorkspaceEditorProps {
    containerHeight?: number;
    onTabChange?: (tab: SignalWorkspaceTab) => void;
}

interface SignalSummary {
    nodeId: string;
    signalCount: number;
    planCount: number;
    nodeConnected: boolean;
    signalConfigured: boolean;
    directions: typeof SIGNAL_DIRECTIONS[number][];
}

const INTERSECTION_FLY_RANGE_M = 240;
const INTERSECTION_OL_RESOLUTION = 0.25;

const SignalWorkspaceEditor: React.FC<SignalWorkspaceEditorProps> = ({
    containerHeight = 400,
    onTabChange,
}) => {
    const signalData = useSignalStore((state: any) => state.currentJsonData) as {
        signals?: EditableSignalRecord[];
    } | undefined;
    const networkData = useNetworkStore((state: any) => state.currentJsonData) as {
        nodes?: any[];
    } | undefined;
    const selectedGuids = useSelectionStore(state => state.selectedGuid);
    const viewer = useCesiumStore(state => state.viewer);
    const olMap = useOpenLayersStore(state => state.map);
    const signals = useMemo(() => signalData?.signals ?? [], [signalData]);
    const nodes = useMemo(() => networkData?.nodes ?? [], [networkData]);
    const [activeTab, setActiveTab] = useState<SignalWorkspaceTab>("movements");
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    const signalsByNode = useMemo(() => {
        const grouped = new Map<string, EditableSignalRecord[]>();
        for (const signal of signals) {
            const nodeId = String(signal.nodeId ?? "");
            if (!nodeId) continue;
            if (!grouped.has(nodeId)) grouped.set(nodeId, []);
            grouped.get(nodeId)!.push(signal);
        }
        return grouped;
    }, [signals]);

    const networkNodes = useMemo(
        () => new Map(nodes.map(node => [String(node.id), node])),
        [nodes],
    );

    const selectedNodeId = useMemo(() => {
        for (const guidValue of selectedGuids) {
            const guid = String(guidValue);
            const signal = signals.find(item => item.__guid === guid);
            if (signal) return String(signal.nodeId);
            const node = nodes.find(item => String(item.__guid) === guid);
            if (node?.id != null) return String(node.id);
        }
        return null;
    }, [nodes, selectedGuids, signals]);

    const signalCandidateNodeIds = useMemo(() => {
        if (!networkData) return new Set<string>();
        return new Set(findSignalCandidateNodeIds(networkData));
    }, [networkData]);

    const summaries = useMemo<SignalSummary[]>(() => {
        const nodeIds = new Set([...signalsByNode.keys(), ...signalCandidateNodeIds]);
        if (selectedNodeId) nodeIds.add(selectedNodeId);
        return [...nodeIds].map(nodeId => {
            const nodeSignals = signalsByNode.get(nodeId) ?? [];
            return {
                nodeId,
                signalCount: nodeSignals.length,
                planCount: nodeSignals.find(signal => signal.plans?.length)?.plans?.length ?? 0,
                nodeConnected: networkNodes.has(nodeId),
                signalConfigured: nodeSignals.length > 0,
                directions: SIGNAL_DIRECTIONS.filter(direction =>
                    nodeSignals.some(signal => {
                        const turning = String(signal.turning ?? "");
                        return turning === direction.key || turning === direction.key[0];
                    }),
                ),
            };
        }).sort((left, right) =>
            left.nodeId.localeCompare(right.nodeId, undefined, { numeric: true }),
        );
    }, [networkNodes, selectedNodeId, signalCandidateNodeIds, signalsByNode]);

    const visibleSummaries = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query
            ? summaries.filter(summary => summary.nodeId.toLowerCase().includes(query))
            : summaries;
    }, [search, summaries]);

    useEffect(() => {
        onTabChange?.(activeTab);
    }, [activeTab, onTabChange]);

    useEffect(() => {
        if (selectedNodeId) {
            setActiveNodeId(selectedNodeId);
            return;
        }
        if (activeNodeId && summaries.some(summary => summary.nodeId === activeNodeId)) return;
        setActiveNodeId(summaries[0]?.nodeId ?? null);
    }, [activeNodeId, selectedNodeId, summaries]);

    const selectIntersection = useCallback((nodeId: string) => {
        setActiveNodeId(nodeId);
        const node = networkNodes.get(nodeId);
        const guids = [
            node?.__guid,
            ...(node?.connections ?? []).map((connection: any) => connection?.__guid),
        ].filter((guid): guid is string => typeof guid === "string" && guid.length > 0);
        if (guids.length > 0) {
            useSelectionStore.getState().setSelectedGuid(guids);
        } else {
            const firstSignalGuid = signalsByNode.get(nodeId)?.[0]?.__guid;
            if (firstSignalGuid) useSelectionStore.getState().setSelectedGuid([firstSignalGuid]);
        }

        const lng = Number(node?.coordinates?.lng);
        const lat = Number(node?.coordinates?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        const view = olMap?.getView();
        view?.animate({
            center: fromLonLat([lng, lat]),
            resolution: INTERSECTION_OL_RESOLUTION,
            duration: 700,
        });

        if (viewer) {
            viewer.trackedEntity = undefined;
            const center = Cesium.Cartesian3.fromDegrees(lng, lat);
            const sphere = new Cesium.BoundingSphere(center, 10);
            viewer.camera.flyToBoundingSphere(sphere, {
                duration: 0.7,
                offset: new Cesium.HeadingPitchRange(
                    viewer.camera.heading,
                    -0.8,
                    INTERSECTION_FLY_RANGE_M,
                ),
            });
        }
    }, [networkNodes, olMap, signalsByNode, viewer]);

    const updatePlanRecord = useCallback((record: any) => {
        useSignalStore.getState().updateCurrentJsonData(record, useSignalPlanHistoryStore);
    }, []);

    const deletePlanRecords = useCallback((guids: string[]) => {
        useSignalStore.getState().removeRecordsByGuid(guids, useSignalPlanHistoryStore);
    }, []);

    const activeSignals = activeNodeId ? signalsByNode.get(activeNodeId) ?? [] : [];
    const activeNode = activeNodeId ? networkNodes.get(activeNodeId) : undefined;
    const activeNodeDisconnected = !!activeNodeId && activeSignals.length > 0 && !activeNode;
    const activeConnections = activeNode?.connections ?? [];
    const turnGroups = useMemo(
        () => buildSignalTurnGroups(activeSignals, activeConnections),
        [activeConnections, activeSignals],
    );
    const planCount = activeSignals.find(signal => signal.plans?.length)?.plans?.length ?? 0;
    const bodyHeight = Math.max(190, containerHeight - 62);
    const releaseDisconnectedSignals = useCallback(() => {
        if (!activeNodeId || !activeNodeDisconnected) return;
        useMessageStore.getState().setMessage({
            type: "confirm",
            text: `현재 네트워크에 없는 교차로 #${activeNodeId}의 신호 ${activeSignals.length}건과 관련 TOD를 해제하시겠습니까?`,
            onConfirm: () => deleteSignalsForNodes([activeNodeId]),
        });
    }, [activeNodeDisconnected, activeNodeId, activeSignals.length]);

    return (
        <div style={workspaceStyle(bodyHeight)}>
            <aside style={sidebarStyle}>
                <div style={sidebarSearchStyle}>
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="교차로 ID 검색"
                        style={searchInputStyle}
                    />
                    <span style={resultCountStyle}>교차로 {visibleSummaries.length}개</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {visibleSummaries.map(summary => {
                        const active = summary.nodeId === activeNodeId;
                        return (
                            <button
                                key={summary.nodeId}
                                type="button"
                                onClick={() => selectIntersection(summary.nodeId)}
                                style={intersectionButtonStyle(active, summary.nodeConnected)}
                            >
                                <div style={intersectionTitleStyle}>
                                    <strong>교차로 #{summary.nodeId}</strong>
                                    {summary.nodeConnected
                                        ? summary.signalConfigured
                                            ? <span style={signalCountStyle}>{summary.signalCount}</span>
                                            : <span style={unconfiguredSignalBadgeStyle}>신호 미설정</span>
                                        : <span style={disconnectedNodeBadgeStyle}>연결 끊김</span>}
                                </div>
                                <div style={intersectionMetaStyle}>
                                    <span style={{ display: "flex", gap: 4 }}>
                                        {summary.directions.map(direction => (
                                            <span key={direction.key} style={{ color: direction.color, fontSize: 13 }}>
                                                {direction.icon}
                                            </span>
                                        ))}
                                    </span>
                                    <span style={{ marginLeft: "auto" }}>
                                        {summary.signalConfigured
                                            ? `신호 ${summary.signalCount} · Plan ${summary.planCount}`
                                            : "자동 생성 필요"}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                    {visibleSummaries.length === 0 && (
                        <div style={sidebarEmptyStyle}>
                            지도에서 교차로를 선택하거나 신호를 자동 생성하세요.
                        </div>
                    )}
                </div>
            </aside>

            <section style={contentStyle}>
                <header style={workspaceHeaderStyle}>
                    <div style={{ minWidth: 165 }}>
                        <strong style={{ color: "#e2eaf7", fontSize: 13 }}>
                            {activeNodeId ? `교차로 #${activeNodeId}` : "교차로 미선택"}
                        </strong>
                        <div style={{ color: "#6f7f97", fontSize: 9, marginTop: 3 }}>
                            이동류 {activeSignals.length}개 · Turn {turnGroups.length}개 · Plan {planCount}개
                        </div>
                    </div>
                    <nav style={tabListStyle}>
                        <button
                            type="button"
                            onClick={() => setActiveTab("movements")}
                            style={tabButtonStyle(activeTab === "movements")}
                        >
                            신호등
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("plans")}
                            style={tabButtonStyle(activeTab === "plans")}
                        >
                            신호 PLAN
                            <span style={tabCountStyle}>{planCount}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("tod")}
                            style={tabButtonStyle(activeTab === "tod")}
                        >
                            신호 TOD
                        </button>
                    </nav>
                </header>

                <div style={editorBodyStyle}>
                    {activeNodeDisconnected ? (
                        <div style={disconnectedNodePanelStyle}>
                            <div style={disconnectedNodeIconStyle}>!</div>
                            <strong style={{ color: "#f2c4ca", fontSize: 15 }}>
                                교차로 연결이 끊겼습니다
                            </strong>
                            <p style={disconnectedNodeDescriptionStyle}>
                                저장된 교차로 #{activeNodeId}이(가) 현재 Network에 존재하지 않습니다.
                                다른 교차로로 임의 연결할 수 없으며, 현재 Network 구조와 맞지 않는 기존 신호 데이터입니다.
                            </p>
                            <div style={disconnectedActionsStyle}>
                                <button
                                    type="button"
                                    onClick={releaseDisconnectedSignals}
                                    style={releaseSignalButtonStyle}
                                >
                                    신호 데이터 해제
                                </button>
                            </div>
                            <span style={disconnectedNodeHintStyle}>
                                필요한 경우 이 데이터를 삭제한 뒤 현재 Network의 교차로에서 신호를 새로 생성하세요.
                            </span>
                        </div>
                    ) : activeTab === "movements" ? (
                        <div className="signal-workspace-movement-host" style={{ height: "100%", overflow: "hidden" }}>
                            <SignalGroupedEditor
                                containerHeight={containerHeight}
                                embeddedNodeId={activeNodeId}
                            />
                            <style>{`
                                .signal-workspace-movement-host > div {
                                    height: 100% !important;
                                }
                                .signal-workspace-movement-host > div > div:first-child > div:nth-child(1),
                                .signal-workspace-movement-host > div > div:first-child > div:nth-child(2) {
                                    display: none !important;
                                }
                                .signal-workspace-movement-host > div > div:first-child {
                                    justify-content: flex-end;
                                    min-height: 36px;
                                }
                            `}</style>
                        </div>
                    ) : activeTab === "plans" && activeNodeId ? (
                        <SignalPlanEditor
                            nodeId={activeNodeId}
                            signals={activeSignals}
                            networkData={networkData}
                            turnGroups={turnGroups}
                            onHighlightTurnGroup={guids => {
                                useSelectionStore.getState().setSelectedGuid(guids);
                            }}
                            onUpdateRecord={updatePlanRecord}
                            onDeleteRecords={deletePlanRecords}
                        />
                    ) : activeTab === "tod" ? (
                        <SignalTodTimelineEditor
                            containerHeight={containerHeight}
                            embeddedNodeId={activeNodeId}
                            hideSidebar
                        />
                    ) : (
                        <div style={emptyContentStyle}>왼쪽에서 교차로를 선택하세요.</div>
                    )}
                </div>
            </section>
        </div>
    );
};

const workspaceStyle = (height: number): React.CSSProperties => ({
    display: "flex",
    height,
    overflow: "hidden",
    background: "#080d18",
});

const sidebarStyle: React.CSSProperties = {
    width: 235,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #1d2a3e",
    background: "#09111d",
};

const sidebarSearchStyle: React.CSSProperties = {
    padding: 10,
    borderBottom: "1px solid #1a2638",
};

const searchInputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #293850",
    borderRadius: 5,
    background: "#0f1929",
    color: "#c8d4e6",
    padding: "6px 8px",
    fontSize: 10,
    outline: "none",
};

const resultCountStyle: React.CSSProperties = {
    display: "block",
    marginTop: 7,
    color: "#64738a",
    fontSize: 9,
};

const intersectionButtonStyle = (active: boolean, connected: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "10px 11px",
    border: "none",
    borderBottom: "1px solid #172235",
    borderLeft: `3px solid ${active ? (connected ? "#4f8ef7" : "#d95768") : "transparent"}`,
    background: active ? (connected ? "#14243e" : "#2a151b") : "transparent",
    color: connected ? (active ? "#e0eaff" : "#8997ac") : "#d9909a",
    textAlign: "left",
    cursor: "pointer",
});

const intersectionTitleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 11,
};

const signalCountStyle: React.CSSProperties = {
    minWidth: 20,
    borderRadius: 10,
    background: "#1c3152",
    color: "#91baff",
    padding: "2px 6px",
    textAlign: "center",
    fontSize: 8,
};

const unconfiguredSignalBadgeStyle: React.CSSProperties = {
    border: "1px solid #6f5927",
    borderRadius: 10,
    background: "#211b0d",
    color: "#d8b45c",
    padding: "2px 7px",
    fontSize: 8,
    fontWeight: 700,
};

const disconnectedNodeBadgeStyle: React.CSSProperties = {
    border: "1px solid #7d3440",
    borderRadius: 10,
    background: "#351820",
    color: "#f08090",
    padding: "2px 7px",
    fontSize: 8,
    fontWeight: 700,
};

const intersectionMetaStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    minHeight: 18,
    marginTop: 6,
    color: "#65748b",
    fontSize: 9,
};

const sidebarEmptyStyle: React.CSSProperties = {
    padding: 20,
    color: "#65748a",
    fontSize: 10,
    lineHeight: 1.6,
    textAlign: "center",
};

const contentStyle: React.CSSProperties = {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
};

const workspaceHeaderStyle: React.CSSProperties = {
    minHeight: 48,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: 18,
    padding: "7px 13px",
    borderBottom: "1px solid #213049",
    background: "#0c1524",
};

const tabListStyle: React.CSSProperties = {
    display: "flex",
    gap: 3,
    padding: 3,
    border: "1px solid #263650",
    borderRadius: 7,
    background: "#08101c",
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 12px",
    border: active ? "1px solid #487bc9" : "1px solid transparent",
    borderRadius: 5,
    background: active ? "#1a3d6d" : "transparent",
    color: active ? "#d8e8ff" : "#75839a",
    fontSize: 10,
    fontWeight: active ? 800 : 600,
    cursor: "pointer",
});

const tabCountStyle: React.CSSProperties = {
    minWidth: 15,
    borderRadius: 8,
    background: "#2d5e9f",
    color: "#dceaff",
    padding: "1px 5px",
    fontSize: 8,
    textAlign: "center",
};

const editorBodyStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
};

const disconnectedNodePanelStyle: React.CSSProperties = {
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    background: "#0d111c",
};

const disconnectedNodeIconStyle: React.CSSProperties = {
    width: 34,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    border: "1px solid #a44150",
    borderRadius: "50%",
    background: "#32161d",
    color: "#ff8797",
    fontSize: 19,
    fontWeight: 800,
};

const disconnectedNodeDescriptionStyle: React.CSSProperties = {
    maxWidth: 620,
    margin: "9px 0 16px",
    color: "#9d8790",
    fontSize: 11,
    lineHeight: 1.65,
    textAlign: "center",
};

const disconnectedActionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
};

const releaseSignalButtonStyle: React.CSSProperties = {
    height: 32,
    border: "1px solid #65313a",
    borderRadius: 5,
    background: "#29161b",
    color: "#e98792",
    padding: "0 12px",
    fontSize: 10,
    cursor: "pointer",
};

const disconnectedNodeHintStyle: React.CSSProperties = {
    marginTop: 13,
    color: "#657188",
    fontSize: 9,
};

const emptyContentStyle: React.CSSProperties = {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#65738a",
    fontSize: 11,
};

export default SignalWorkspaceEditor;
