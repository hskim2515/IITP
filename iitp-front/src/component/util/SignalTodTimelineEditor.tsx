import React, { useCallback, useMemo, useState } from "react";
import { useSignalTodStore } from "@stores/useSignalTodStore";

/* ───────────────────────────── 타입 ───────────────────────────── */
interface Plan {
    id: number | string;
    startTime: string;
    endTime: string;
    [key: string]: any;
}

interface TodNode {
    id: string | number;
    plans: Plan[];
    [key: string]: any;
}

interface TodData {
    id?: number;
    nodes?: TodNode[];
    [key: string]: any;
}

/* ───────────────────────── 색상 팔레트 ──────────────────────────── */
const PLAN_COLORS = [
    "#4f8ef7", "#f76c4f", "#4fc97a", "#f7c44f",
    "#b04ff7", "#4ff7e8", "#f74fb0", "#a8a8a8",
];

function planColor(planId: number | string): string {
    const idx = Number(planId) % PLAN_COLORS.length;
    return PLAN_COLORS[idx < 0 ? 0 : idx];
}

/* ────────────────────── 시간 유틸 ─────────────────────────── */
function toMinutes(hhmm: string): number {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
}

function toHHMM(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pct(minutes: number): string {
    return `${((minutes / 1440) * 100).toFixed(4)}%`;
}

/* ──────────────────── 편집 팝오버 ──────────────────────────── */
interface EditPopoverProps {
    plan: Plan;
    nodeId: string | number;
    x: number;
    y: number;
    onClose: () => void;
    onChange: (updated: Plan) => void;
    onDelete: () => void;
}

const EditPopover: React.FC<EditPopoverProps> = ({ plan, x, y, onClose, onChange, onDelete }) => {
    const [planId, setPlanId] = useState(String(plan.id));
    const [start, setStart] = useState(plan.startTime.slice(0, 5));
    const [end, setEnd] = useState(plan.endTime.slice(0, 5));

    const apply = () => {
        onChange({ ...plan, id: Number(planId) || planId, startTime: start, endTime: end });
        onClose();
    };

    return (
        <div
            style={{
                position: "fixed", left: x, top: y, zIndex: 9999,
                background: "#1e2235", border: "1px solid #3a4060",
                borderRadius: 8, padding: "12px 14px", minWidth: 200,
                boxShadow: "0 4px 20px rgba(0,0,0,0.6)", color: "#e0e0e0",
                fontSize: 12,
            }}
        >
            <div style={{ fontWeight: 600, marginBottom: 10, color: "#7aa2ff" }}>플랜 편집</div>
            <label style={{ display: "block", marginBottom: 6 }}>
                Plan ID
                <input
                    type="number"
                    value={planId}
                    onChange={e => setPlanId(e.target.value)}
                    style={inputStyle}
                />
            </label>
            <label style={{ display: "block", marginBottom: 6 }}>
                시작 시각
                <input
                    type="time"
                    value={start}
                    onChange={e => setStart(e.target.value)}
                    style={inputStyle}
                />
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
                종료 시각
                <input
                    type="time"
                    value={end}
                    onChange={e => setEnd(e.target.value)}
                    style={inputStyle}
                />
            </label>
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={apply} style={btnStyle("#4f8ef7")}>적용</button>
                <button onClick={onDelete} style={btnStyle("#e05555")}>삭제</button>
                <button onClick={onClose} style={btnStyle("#555")}>취소</button>
            </div>
        </div>
    );
};

const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", marginTop: 3,
    background: "#111827", border: "1px solid #3a4060",
    borderRadius: 4, color: "#e0e0e0", padding: "3px 6px", fontSize: 12,
};

const btnStyle = (bg: string): React.CSSProperties => ({
    flex: 1, background: bg, border: "none", borderRadius: 4,
    color: "#fff", padding: "4px 0", cursor: "pointer", fontSize: 11,
});

/* ──────────────────── 메인 컴포넌트 ──────────────────────── */
interface SignalTodTimelineEditorProps {
    containerHeight?: number;
}

const HOUR_MARKS = Array.from({ length: 25 }, (_, i) => i); // 0~24

const SignalTodTimelineEditor: React.FC<SignalTodTimelineEditorProps> = ({ containerHeight = 400 }) => {
    const store = useSignalTodStore;

    const rawData = store((s: any) => s.currentJsonData) as TodData | undefined;
    const nodes: TodNode[] = useMemo(() => rawData?.nodes ?? [], [rawData]);

    const [editTarget, setEditTarget] = useState<{
        nodeId: string | number;
        planIdx: number;
        x: number;
        y: number;
    } | null>(null);


    /* 데이터 업데이트 */
    const updateNodes = useCallback((updatedNodes: TodNode[]) => {
        const updated = { ...(rawData ?? {}), nodes: updatedNodes };
        store.getState().setCurrentJsonData(updated as any);
    }, [rawData]);

    /* 플랜 변경 */
    const handlePlanChange = useCallback((nodeId: string | number, planIdx: number, updated: Plan) => {
        const newNodes = nodes.map(node => {
            if (String(node.id) !== String(nodeId)) return node;
            const newPlans = [...node.plans];
            newPlans[planIdx] = updated;
            return { ...node, plans: newPlans };
        });
        updateNodes(newNodes);
    }, [nodes, updateNodes]);

    /* 플랜 삭제 */
    const handlePlanDelete = useCallback((nodeId: string | number, planIdx: number) => {
        const newNodes = nodes.map(node => {
            if (String(node.id) !== String(nodeId)) return node;
            const newPlans = node.plans.filter((_, i) => i !== planIdx);
            return { ...node, plans: newPlans };
        });
        updateNodes(newNodes);
        setEditTarget(null);
    }, [nodes, updateNodes]);

    /* 노드에 빈 플랜 추가 */
    const handleAddPlan = useCallback((nodeId: string | number) => {
        const node = nodes.find(n => String(n.id) === String(nodeId));
        if (!node) return;
        // 마지막 플랜의 endTime을 새 플랜의 startTime으로
        const lastEnd = node.plans.length > 0 ? node.plans[node.plans.length - 1].endTime : "00:00";
        const newPlan: Plan = {
            id: (node.plans.length + 1),
            startTime: lastEnd.slice(0, 5),
            endTime: toHHMM(Math.min(toMinutes(lastEnd.slice(0, 5)) + 60, 1439)),
        };
        const newNodes = nodes.map(n =>
            String(n.id) === String(nodeId)
                ? { ...n, plans: [...n.plans, newPlan] }
                : n
        );
        updateNodes(newNodes);
    }, [nodes, updateNodes]);

    /* 블록 클릭 → 팝오버 열기 */
    const openEdit = (e: React.MouseEvent, nodeId: string | number, planIdx: number) => {
        e.stopPropagation();
        setEditTarget({ nodeId, planIdx, x: e.clientX + 8, y: e.clientY - 20 });
    };

    if (!nodes.length) {
        return (
            <div style={{ color: "#666", padding: 32, textAlign: "center", fontSize: 13 }}>
                signalTOD 데이터가 없습니다.
            </div>
        );
    }

    return (
        <div style={{ position: "relative", display: "flex", flexDirection: "column", height: containerHeight - 60, overflow: "hidden" }}
             onClick={() => setEditTarget(null)}>

            {/* 팝오버 */}
            {editTarget && (() => {
                const node = nodes.find(n => String(n.id) === String(editTarget.nodeId));
                const plan = node?.plans[editTarget.planIdx];
                if (!plan) return null;
                return (
                    <EditPopover
                        plan={plan}
                        nodeId={editTarget.nodeId}
                        x={editTarget.x}
                        y={editTarget.y}
                        onClose={() => setEditTarget(null)}
                        onChange={updated => handlePlanChange(editTarget.nodeId, editTarget.planIdx, updated)}
                        onDelete={() => handlePlanDelete(editTarget.nodeId, editTarget.planIdx)}
                    />
                );
            })()}

            {/* 헤더: 시간 눈금 */}
            <div style={{ display: "flex", flexShrink: 0 }}>
                <div style={{ width: 90, flexShrink: 0 }} /> {/* 노드ID 칼럼 */}
                <div style={{ flex: 1, position: "relative", height: 24, borderBottom: "1px solid #2a2f4a" }}>
                    {HOUR_MARKS.map(h => (
                        <div key={h} style={{
                            position: "absolute", left: pct(h * 60),
                            top: 0, height: "100%",
                            borderLeft: h % 6 === 0 ? "1px solid #4a5080" : "1px solid #2a2f4a",
                            paddingLeft: 2, fontSize: 10, color: "#666",
                            transform: "translateX(-1px)",
                        }}>
                            {h % 6 === 0 ? `${String(h).padStart(2, "0")}:00` : ""}
                        </div>
                    ))}
                </div>
                <div style={{ width: 30, flexShrink: 0 }} />
            </div>

            {/* 노드 행 목록 */}
            <div style={{ overflowY: "auto", flex: 1 }}>
                {nodes.map(node => (
                    <div key={node.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #1a1e30", minHeight: 36 }}>
                        {/* 노드 ID */}
                        <div style={{
                            width: 90, flexShrink: 0, fontSize: 11, color: "#8899bb",
                            padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }} title={String(node.id)}>
                            #{node.id}
                        </div>

                        {/* 타임라인 트랙 */}
                        <div style={{ flex: 1, position: "relative", height: 28, background: "#111520", borderRadius: 2 }}>
                            {(node.plans ?? []).map((plan, idx) => {
                                const startMin = toMinutes(plan.startTime);
                                const endMin = toMinutes(plan.endTime);
                                const width = Math.max(0, endMin - startMin);
                                if (width === 0) return null;
                                const color = planColor(plan.id);
                                return (
                                    <div
                                        key={idx}
                                        onClick={e => openEdit(e, node.id, idx)}
                                        title={`Plan ${plan.id} | ${plan.startTime} ~ ${plan.endTime}`}
                                        style={{
                                            position: "absolute",
                                            left: pct(startMin),
                                            width: pct(width),
                                            top: 2, bottom: 2,
                                            background: color,
                                            borderRadius: 3,
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 10,
                                            color: "#fff",
                                            fontWeight: 600,
                                            overflow: "hidden",
                                            opacity: 0.88,
                                            border: editTarget?.nodeId === node.id && editTarget?.planIdx === idx
                                                ? "2px solid #fff" : "none",
                                            boxSizing: "border-box",
                                            transition: "opacity 0.1s",
                                            userSelect: "none",
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                                        onMouseLeave={e => (e.currentTarget.style.opacity = "0.88")}
                                    >
                                        {width > 30 ? `P${plan.id}` : ""}
                                    </div>
                                );
                            })}
                        </div>

                        {/* 플랜 추가 버튼 */}
                        <div style={{ width: 30, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                            <button
                                onClick={e => { e.stopPropagation(); handleAddPlan(node.id); }}
                                title="플랜 추가"
                                style={{
                                    background: "none", border: "1px solid #3a4060",
                                    color: "#7aa2ff", borderRadius: 3, cursor: "pointer",
                                    fontSize: 14, width: 20, height: 20, padding: 0,
                                    lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                                }}
                            >
                                +
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* 하단 범례 */}
            <div style={{ flexShrink: 0, padding: "6px 8px", borderTop: "1px solid #1a1e30", display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Array.from(new Set(nodes.flatMap(n => n.plans?.map(p => p.id) ?? []))).map(pid => (
                    <div key={pid} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#8899bb" }}>
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: planColor(pid), flexShrink: 0 }} />
                        Plan {pid}
                    </div>
                ))}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "#556", lineHeight: "12px" }}>
                    블록 클릭 시 편집 · + 버튼으로 플랜 추가
                </div>
            </div>
        </div>
    );
};

export default SignalTodTimelineEditor;
