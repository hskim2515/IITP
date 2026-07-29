import React, { useEffect, useRef, useState } from 'react';
import { getDistance } from 'ol/sphere';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { useNetworkEditStore } from '@stores/useNetworkEditStore';
import { useMessageStore } from '@stores/useMessageStore';
import {
    deleteLinkFromNetwork, deleteNodeFromNetwork,
    updateLinkInNetwork, reverseLinkDirection,
    mergeNodesInNetwork, moveNode,
    batchDeleteLinksFromNetwork, batchUpdateLinksInNetwork,
    applyNetworkUpdate, markRemovedForTileMask,
    countSignalsForNodes, deleteSignalsForNodes,
    isPassThroughNode, mergeLinksAtNode, batchDeleteOrMergeNodes,
    reconcileSignalConnectionIds, farNodeIdsForCascadeDelete,
    toggleSegmentBlock, splitSegmentInNetwork, mergeSegmentInNetwork,
    getEffectiveSegments,
    countStationsForLinks, countStationsForNodes, deleteStationsForLinks, deletePavementMarkingsForLinks,
    deletePavementMarkingsForShrunkLanes,
} from '@hooks/useNetworkSelect';
import { createIntersectionAtNode, regenerateNodeConnections, splitLinkInNetwork } from '@hooks/useNetworkDraw';
import { segmentIndexAtFrac, cellIndexAtFrac } from '@utils/networkDrilldown';
import styles from '@css/ToolsPanel.module.css';

/**
 * 도로 편집 클릭 지점에 뜨는 맥락 툴바.
 *
 * <p>이전엔 클릭 결과가 화면 우측 고정 패널(구 NetworkSelectPanel)에 나타나 클릭 지점과
 * 멀리 떨어져 있었고, 레인/세그먼트/셀은 같은 지점을 반복 클릭해야만 접근할 수 있어
 * 불편하다는 실사용 피드백이 있었다. 이 컴포넌트는 그 대신 클릭 지점 근처에 작은
 * 버튼바를 띄우고, "차선보기"/"구간보기"/"셀보기" 같은 명시적 버튼으로 단계를 오가며
 * 그 단계에서 실제로 가능한 조작만 보여준다.
 */

// ── 스타일 ─────────────────────────────────────────────────────────
const barStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 1,
    background: 'rgba(14,16,28,0.97)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    padding: 4,
    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
    userSelect: 'none',
    whiteSpace: 'nowrap',
};
const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 9px',
    background: 'transparent',
    border: 'none',
    borderRadius: 5,
    fontSize: 12,
    cursor: 'pointer',
    lineHeight: 1,
};
const expandPanelStyle: React.CSSProperties = {
    marginTop: 4,
    background: 'rgba(14,16,28,0.97)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    padding: '8px 10px',
    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
    width: 240,
};
const inputStyle: React.CSSProperties = {
    width: '60px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px',
    color: '#ccc', fontSize: '12px', padding: '2px 6px', textAlign: 'right',
};
const coordInputStyle: React.CSSProperties = { ...inputStyle, width: '90px', fontSize: '11px' };
const counterBtnStyle: React.CSSProperties = {
    width: '22px', height: '22px', borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)',
    color: '#aaa', fontSize: '14px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
};
const infoRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', padding: '1px 0' };

const Btn: React.FC<{
    onClick: () => void; danger?: boolean; nav?: boolean; disabled?: boolean; title?: string; children: React.ReactNode;
}> = ({ onClick, danger, nav, disabled, title, children }) => (
    <button
        title={title}
        disabled={disabled}
        onClick={onClick}
        style={{
            ...btnBase,
            color: disabled ? '#555' : danger ? '#ff6b6b' : nav ? '#7aa2ff' : '#ddd',
            fontWeight: nav ? 600 : 400,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(255,80,80,0.14)' : 'rgba(122,162,255,0.14)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
        {children}
    </button>
);

const VDivider: React.FC = () => (
    <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.14)', margin: '2px 3px' }} />
);

// 삭제 실행 전/후 네트워크를 비교해 실제로 사라진 링크 id를 뽑는다 — busStation/railStation은
// linkRef로 특정 링크를 참조하는 별개 스토어라 링크가 없어져도 자동으로 안 지워지므로
// (useNetworkSelect.ts의 키보드 Delete 핸들러와 동일하게) 이 목록으로 deleteStationsForLinks를
// 호출해 고아 정류장이 남지 않게 한다.
function removedLinkIds(before: { links: { id: string | number }[] }, after: { links: { id: string | number }[] }): string[] {
    const afterIds = new Set(after.links.map((l) => String(l.id)));
    return before.links.filter((l) => !afterIds.has(String(l.id))).map((l) => String(l.id));
}

// ── 방위각 계산 ─────────────────────────────────────────────────────
function computeBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRad = Math.PI / 180;
    const lat1 = from.lat * toRad, lat2 = to.lat * toRad;
    const dLng = (to.lng - from.lng) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

const NetworkEditToolbar: React.FC = () => {
    const toolbar = useNetworkToolbarStore();
    const selectedLinkId  = useNetworkDrawStore((s) => s.selectedLinkId);
    const selectedNodeId  = useNetworkDrawStore((s) => s.selectedNodeId);
    const selectedLinkIds = useNetworkDrawStore((s) => s.selectedLinkIds);
    const selectedNodeIds = useNetworkDrawStore((s) => s.selectedNodeIds);
    const network = useNetworkStore((s) => s.currentJsonData);

    // ── 링크 속성 인라인 편집 상태 ───────────────────────────────────
    const [propsOpen, setPropsOpen] = useState(false);
    const [numLane, setNumLane] = useState(2);
    const [width,   setWidth]   = useState(7.0);
    const [maxSpd,  setMaxSpd]  = useState(50);
    const [saving,  setSaving]  = useState(false);
    const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── 노드 좌표 인라인 편집 상태 ────────────────────────────────────
    const [coordOpen, setCoordOpen] = useState(false);
    const [editLng, setEditLng] = useState('');
    const [editLat, setEditLat] = useState('');

    // ── 다중 링크 일괄 편집 상태 ──────────────────────────────────────
    const [batchOpen, setBatchOpen] = useState(false);
    const [batchNumLane, setBatchNumLane] = useState(2);
    const [batchMaxSpd,  setBatchMaxSpd]  = useState(50);

    const linkId  = toolbar.linkId;
    const nodeId  = toolbar.nodeId;
    const laneIdx = toolbar.laneIdx;
    const segIdx  = toolbar.segIdx;
    const cellIdx = toolbar.cellIdx;

    // 대상이 바뀌면 인라인 편집 패널 닫고 값 재동기화 (편집 중 외부 변경 덮어쓰기 방지 위해 network는 deps 제외)
    useEffect(() => {
        setPropsOpen(false);
        setCoordOpen(false);
        setBatchOpen(false);
        if (applyTimerRef.current) { clearTimeout(applyTimerRef.current); applyTimerRef.current = null; }
        setSaving(false);
        const link = linkId != null ? network?.links.find((l) => String(l.id) === linkId) : null;
        if (link) { setNumLane(link.numLane); setWidth(link.width); setMaxSpd(link.maxSpd); }
        const node = nodeId != null ? network?.nodes.find((n) => String(n.id) === nodeId) : null;
        if (node) { setEditLng(node.coordinates.lng.toFixed(6)); setEditLat(node.coordinates.lat.toFixed(6)); }
        if (selectedLinkIds.length > 0) {
            const links = selectedLinkIds.map((id) => network?.links.find((l) => String(l.id) === id)).filter((l): l is NonNullable<typeof l> => !!l);
            if (links.length > 0) {
                setBatchNumLane(links.every((l) => l.numLane === links[0]!.numLane) ? links[0]!.numLane : 2);
                setBatchMaxSpd(links.every((l) => l.maxSpd === links[0]!.maxSpd) ? links[0]!.maxSpd : 50);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolbar.level, linkId, nodeId, laneIdx, segIdx, cellIdx, selectedLinkIds.join(',')]);

    useEffect(() => () => { if (applyTimerRef.current) clearTimeout(applyTimerRef.current); }, []);

    const hasBaseSelection = selectedLinkId !== null || selectedNodeId !== null || selectedLinkIds.length > 0 || selectedNodeIds.length > 0;
    if (!toolbar.visible || !toolbar.level || !hasBaseSelection || !network) return null;

    const menuW = 320;
    const left = Math.min(toolbar.x, window.innerWidth  - menuW - 8);
    const top  = Math.min(toolbar.y + 8, window.innerHeight - 260);

    // ── 링크 차선수/폭/속도 자동 저장(400ms debounce) — 링크 레벨 전용 ──────
    const scheduleApply = (patch: Partial<{ numLane: number; width: number; maxSpd: number }>) => {
        if (linkId == null) return;
        const next = { numLane, width, maxSpd, ...patch };
        if (patch.numLane !== undefined) setNumLane(patch.numLane);
        if (patch.width   !== undefined) setWidth(patch.width);
        if (patch.maxSpd  !== undefined) setMaxSpd(patch.maxSpd);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
        setSaving(true);
        applyTimerRef.current = setTimeout(() => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) { setSaving(false); return; }
            const curLink = cur.links.find((l) => String(l.id) === linkId);
            let droppedConnCount = 0;
            if (curLink && next.numLane < curLink.numLane) {
                droppedConnCount = cur.nodes
                    .filter((n) => String(n.id) === String(curLink.fromNode) || String(n.id) === String(curLink.toNode))
                    .reduce((sum, n) => sum + n.connections.filter((c: any) =>
                        (String(c.fromLink) === linkId && c.fromLane >= next.numLane) ||
                        (String(c.toLink) === linkId && c.toLane >= next.numLane)
                    ).length, 0);
            }
            const updated = updateLinkInNetwork(cur, linkId, next);
            applyNetworkUpdate(updated);
            const clearedCount = curLink ? reconcileSignalConnectionIds(updated, [curLink.fromNode, curLink.toNode]) : 0;
            let removedMarkingCount = 0;
            if (curLink && next.numLane < curLink.numLane) {
                const updatedLink = updated.links.find((l) => String(l.id) === linkId);
                const remainingLaneIds = new Set((updatedLink?.lanes ?? []).map((l: any) => l.id));
                removedMarkingCount = deletePavementMarkingsForShrunkLanes(linkId, remainingLaneIds);
            }
            setSaving(false);
            if (droppedConnCount > 0 || clearedCount > 0 || removedMarkingCount > 0) {
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `차선 수 감소로 커넥션 ${droppedConnCount}개 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}`,
                });
            }
        }, 400);
    };

    // ══════════════════════════════════════════════════════════════
    // 멀티셀렉트 (링크/노드 여러 개)
    // ══════════════════════════════════════════════════════════════
    const isMultiLink = selectedLinkIds.length > 0;
    const isMultiNode = selectedNodeIds.length > 0;
    if (isMultiLink || isMultiNode) {
        const count = isMultiLink ? selectedLinkIds.length : selectedNodeIds.length;
        const label = isMultiLink ? '링크' : '노드';

        const handleBatchDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            if (isMultiLink) {
                // 정류장은 linkRef로 링크에 종속된 별개 스토어라 링크 삭제로 자동으로 안 지워짐
                // (신호처럼 참조만 비울 수 없는 파괴적 연쇄라 사전에 확인받는다 — 키보드 Delete
                // 핸들러, useNetworkSelect.ts와 동일 규칙).
                const stationCount = countStationsForLinks(selectedLinkIds);
                const proceedDelete = () => {
                    const net = useNetworkStore.getState().currentJsonData;
                    if (!net) return;
                    const affectedNodeIds = new Set(
                        net.links.filter((l) => selectedLinkIds.includes(String(l.id))).flatMap((l) => [String(l.fromNode), String(l.toNode)])
                    );
                    const next = batchDeleteLinksFromNetwork(net, selectedLinkIds);
                    applyNetworkUpdate(next);
                    const clearedCount = reconcileSignalConnectionIds(next, [...affectedNodeIds]);
                    const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
                    const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
                    markRemovedForTileMask(net, next);
                    useNetworkDrawStore.getState().clearSelection();
                    useNetworkToolbarStore.getState().hide();
                    useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${selectedLinkIds.length}개 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}` });
                };
                if (stationCount > 0) {
                    useMessageStore.getState().setMessage({
                        type: 'confirm',
                        text: `링크 ${selectedLinkIds.length}개를 삭제합니다. 이 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                        onConfirm: proceedDelete,
                    });
                } else {
                    proceedDelete();
                }
            } else {
                const mergeCount = selectedNodeIds.filter((id) => isPassThroughNode(cur, id)).length;
                const signalCount = countSignalsForNodes(selectedNodeIds);
                const stationCount = countStationsForNodes(cur, selectedNodeIds);
                const doDelete = () => {
                    const net = useNetworkStore.getState().currentJsonData;
                    if (!net) return;
                    const farIds = farNodeIdsForCascadeDelete(net, selectedNodeIds);
                    const next = batchDeleteOrMergeNodes(net, selectedNodeIds);
                    applyNetworkUpdate(next);
                    const clearedCount = reconcileSignalConnectionIds(next, farIds);
                    deleteSignalsForNodes(selectedNodeIds);
                    const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
                    const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
                    markRemovedForTileMask(net, next);
                    useNetworkDrawStore.getState().clearSelection();
                    useNetworkToolbarStore.getState().hide();
                    useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${selectedNodeIds.length}개 삭제됨${mergeCount > 0 ? ` (통과 노드 ${mergeCount}개는 링크 자동 병합)` : ''}${signalCount > 0 ? `, 신호 ${signalCount}개 삭제` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}${clearedCount > 0 ? `, 인접 신호 ${clearedCount}개 커넥션 참조 초기화` : ''}` });
                };
                if (stationCount > 0) {
                    useMessageStore.getState().setMessage({
                        type: 'confirm',
                        text: `노드 ${selectedNodeIds.length}개를 삭제합니다. 이 노드에 연결된 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                        onConfirm: doDelete,
                    });
                } else {
                    doDelete();
                }
            }
        };

        const handleBatchApply = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            const affectedNodeIds = new Set(
                cur.links.filter((l) => selectedLinkIds.includes(String(l.id))).flatMap((l) => [String(l.fromNode), String(l.toNode)])
            );
            const next = batchUpdateLinksInNetwork(cur, selectedLinkIds, { numLane: batchNumLane, maxSpd: batchMaxSpd });
            applyNetworkUpdate(next);
            const clearedCount = reconcileSignalConnectionIds(next, [...affectedNodeIds]);
            let removedMarkingCount = 0;
            for (const id of selectedLinkIds) {
                const before = cur.links.find((l) => String(l.id) === id);
                if (!before || batchNumLane >= before.numLane) continue;
                const after = next.links.find((l) => String(l.id) === id);
                const remainingLaneIds = new Set((after?.lanes ?? []).map((l: any) => l.id));
                removedMarkingCount += deletePavementMarkingsForShrunkLanes(id, remainingLaneIds);
            }
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `링크 ${selectedLinkIds.length}개 일괄 수정 (${batchNumLane}차선, ${batchMaxSpd}km/h)${clearedCount > 0 ? ` — 신호 ${clearedCount}개의 커넥션 참조 초기화` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}`,
            });
        };

        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <span style={{ padding: '0 8px', fontSize: 12, color: isMultiLink ? '#7aa2ff' : '#ffb347', fontWeight: 600 }}>
                        {label} {count}개
                    </span>
                    <VDivider />
                    {isMultiLink && (
                        <Btn onClick={() => setBatchOpen((v) => !v)} title="일괄 속성 변경">⚙ 속성</Btn>
                    )}
                    <Btn danger onClick={handleBatchDelete} title="선택 삭제 (Delete)">🗑 삭제</Btn>
                </div>
                {batchOpen && isMultiLink && (
                    <div style={expandPanelStyle}>
                        <div className={styles.settingRow}>
                            <span className={styles.settingLabel}>차선 수</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button style={counterBtnStyle} onClick={() => setBatchNumLane((v) => Math.max(1, v - 1))}>−</button>
                                <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{batchNumLane}</span>
                                <button style={counterBtnStyle} onClick={() => setBatchNumLane((v) => Math.min(8, v + 1))}>+</button>
                            </div>
                        </div>
                        <div className={styles.settingRow}>
                            <span className={styles.settingLabel}>제한속도</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="range" min={10} max={110} step={10} value={batchMaxSpd}
                                       onChange={(e) => setBatchMaxSpd(Number(e.target.value))} className={styles.settingRange} />
                                <span className={styles.settingValue} style={{ minWidth: 42 }}>{batchMaxSpd} km/h</span>
                            </div>
                        </div>
                        <button onClick={handleBatchApply} style={{ width: '100%', marginTop: 6, padding: '6px 14px', background: 'rgba(122,162,255,0.15)', border: '1px solid rgba(122,162,255,0.4)', borderRadius: 5, color: '#7aa2ff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                            일괄 적용
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // 셀 레벨 (읽기 전용 — 편집 기능 없음, 기존과 동일)
    // ══════════════════════════════════════════════════════════════
    if (toolbar.level === 'cell' && linkId != null && laneIdx != null && cellIdx != null) {
        const link = network.links.find((l) => String(l.id) === linkId);
        const lane = link?.lanes?.[laneIdx];
        const cell = lane?.cells?.[cellIdx];
        if (!link || !lane) return null;
        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <Btn onClick={() => useNetworkToolbarStore.getState().setLevel('segment', { linkId, laneIdx, segIdx: segmentIndexAtFrac(lane, link, toolbar.hitFrac ?? 0) })}>◀ 뒤로</Btn>
                    <VDivider />
                    <span style={{ padding: '0 8px', fontSize: 12, color: '#7ad0ff', fontWeight: 600 }}>셀 #{cellIdx}</span>
                </div>
                <div style={expandPanelStyle}>
                    <div style={infoRowStyle}><span>길이</span><span style={{ color: '#888' }}>{cell ? `${cell.length.toFixed(1)} m` : '-'}</span></div>
                    <div style={infoRowStyle}><span>오프셋</span><span style={{ color: '#888' }}>{cell ? `${cell.offset.toFixed(1)} m` : '-'}</span></div>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // 세그먼트(구간) 레벨
    // ══════════════════════════════════════════════════════════════
    if (toolbar.level === 'segment' && linkId != null && laneIdx != null && segIdx != null) {
        const link = network.links.find((l) => String(l.id) === linkId);
        const lane = link?.lanes?.[laneIdx];
        if (!link || !lane) return null;
        // 실측 KTDB 데이터는 레인 드롭 없는 레인이면 segments가 아예 빈 배열 — "전체 구간
        // 통행 가능" 1개로 합성해 항상 뭔가 보여준다(안 그러면 seg가 undefined라 아무것도 안 뜸).
        const segments = getEffectiveSegments(lane, link);
        const seg = segments[segIdx];
        if (!seg) return null;

        const handleToggleBlock = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            const wasBlocked = seg.block;
            applyNetworkUpdate(toggleSegmentBlock(cur, linkId, laneIdx, segIdx));
            useMessageStore.getState().setMessage({ type: 'info', text: wasBlocked ? '구간을 통행 가능으로 변경했습니다' : '구간을 차단(block)으로 변경했습니다' });
        };
        const handleSplit = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(splitSegmentInNetwork(cur, linkId, laneIdx, segIdx));
            useNetworkToolbarStore.getState().setLevel('lane', { linkId, laneIdx });
            useMessageStore.getState().setMessage({ type: 'info', text: '구간을 둘로 분할했습니다' });
        };
        const canMerge = segments.length > 1;
        const mergeDirection = segIdx < segments.length - 1 ? '다음' : '이전';
        const handleMerge = () => {
            if (!canMerge) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(mergeSegmentInNetwork(cur, linkId, laneIdx, segIdx));
            useNetworkToolbarStore.getState().setLevel('lane', { linkId, laneIdx });
            useMessageStore.getState().setMessage({ type: 'info', text: `${mergeDirection} 구간과 병합했습니다` });
        };

        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <Btn onClick={() => useNetworkToolbarStore.getState().setLevel('lane', { linkId, laneIdx })}>◀ 뒤로</Btn>
                    <VDivider />
                    <Btn onClick={handleToggleBlock} title={seg.block ? '차단 해제' : '차단(block) 설정'}>
                        {seg.block ? '🟨 차단됨' : '🟦 통행가능'}
                    </Btn>
                    <Btn onClick={handleSplit} title="중간 지점에서 분할">✂ 분할</Btn>
                    <Btn onClick={handleMerge} disabled={!canMerge} title={`${mergeDirection} 구간과 병합`}>⊕ 병합</Btn>
                    <VDivider />
                    <Btn nav onClick={() => useNetworkToolbarStore.getState().setLevel('cell', { linkId, laneIdx, segIdx, cellIdx: cellIndexAtFrac(lane, link, toolbar.hitFrac ?? (seg.initPoint + seg.endPoint) / 2 / (link.length || 1)) })}>
                        셀보기 ▸
                    </Btn>
                </div>
                <div style={expandPanelStyle}>
                    <div style={infoRowStyle}><span>범위</span><span style={{ color: '#888' }}>{seg.initPoint.toFixed(1)} ~ {seg.endPoint.toFixed(1)} m</span></div>
                    <div style={infoRowStyle}><span>길이</span><span style={{ color: '#888' }}>{(seg.endPoint - seg.initPoint).toFixed(1)} m</span></div>
                    <div style={infoRowStyle}><span>상태</span><span style={{ color: seg.block ? '#ff6b6b' : '#4caf50' }}>{seg.block ? '차단(block)' : '통행 가능'}</span></div>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // 레인 레벨 — 편집 액션은 없고(레인 속성은 링크 레벨의 차선수/폭에서 다룸), 정보 + 구간보기 nav만.
    // ══════════════════════════════════════════════════════════════
    if (toolbar.level === 'lane' && linkId != null && laneIdx != null) {
        const link = network.links.find((l) => String(l.id) === linkId);
        const lane = link?.lanes?.[laneIdx];
        if (!link || !lane) return null;

        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <Btn onClick={() => useNetworkToolbarStore.getState().setLevel('link', { linkId })}>◀ 뒤로</Btn>
                    <VDivider />
                    <span style={{ padding: '0 8px', fontSize: 12, color: '#7ad0ff', fontWeight: 600 }}>레인 L{laneIdx}</span>
                    <VDivider />
                    <Btn nav onClick={() => useNetworkToolbarStore.getState().setLevel('segment', { linkId, laneIdx, segIdx: segmentIndexAtFrac(lane, link, toolbar.hitFrac ?? 0) })}>
                        구간보기 ▸
                    </Btn>
                </div>
                <div style={expandPanelStyle}>
                    <div style={infoRowStyle}><span>왼쪽 인접</span><span style={{ color: '#888' }}>{String(lane.leftLaneId ?? '-')}</span></div>
                    <div style={infoRowStyle}><span>오른쪽 인접</span><span style={{ color: '#888' }}>{String(lane.rightLaneId ?? '-')}</span></div>
                    <div style={infoRowStyle}><span>구간(세그먼트) 수</span><span style={{ color: '#888' }}>{getEffectiveSegments(lane, link).length}개</span></div>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // 링크 레벨
    // ══════════════════════════════════════════════════════════════
    if (toolbar.level === 'link' && linkId != null) {
        const link = network.links.find((l) => String(l.id) === linkId);
        if (!link) return null;
        const bearing = link.coordinates.length >= 2
            ? computeBearing(link.coordinates[0]!, link.coordinates[link.coordinates.length - 1]!)
            : null;

        const handleDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            const connCount = cur.nodes
                .filter((n) => String(n.id) === String(link.fromNode) || String(n.id) === String(link.toNode))
                .reduce((sum, n) => sum + n.connections.filter((c: any) => String(c.fromLink) === linkId || String(c.toLink) === linkId).length, 0);
            const stationCount = countStationsForLinks([linkId]);
            const proceedDelete = () => {
                const net = useNetworkStore.getState().currentJsonData;
                if (!net) return;
                const next = deleteLinkFromNetwork(net, linkId);
                applyNetworkUpdate(next);
                const clearedCount = reconcileSignalConnectionIds(next, [link.fromNode, link.toNode]);
                const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
                const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
                markRemovedForTileMask(net, next);
                useNetworkDrawStore.getState().clearSelection();
                useNetworkToolbarStore.getState().hide();
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: `링크 ${linkId} 삭제됨${connCount > 0 ? ` (커넥션 ${connCount}개 함께 삭제)` : ''}${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ''}`,
                });
            };
            if (stationCount > 0) {
                useMessageStore.getState().setMessage({
                    type: 'confirm',
                    text: `링크 ${linkId}을(를) 삭제합니다. 이 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                    onConfirm: proceedDelete,
                });
            } else {
                proceedDelete();
            }
        };

        const handleReverse = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            let net = reverseLinkDirection(cur, linkId);
            net = regenerateNodeConnections(net, link.fromNode);
            net = regenerateNodeConnections(net, link.toNode);
            applyNetworkUpdate(net);
            const clearedCount = reconcileSignalConnectionIds(net, [link.fromNode, link.toNode]);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `링크 ${linkId} 방향 반전 + 양끝 교차로 커넥션 재생성됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}`,
            });
        };

        const handleSplit = () => {
            if (!toolbar.clickCoord) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            const { updatedNetwork, newNodeId } = splitLinkInNetwork(cur, link, toolbar.clickCoord, Date.now());
            applyNetworkUpdate(updatedNetwork);
            useNetworkEditStore.getState().addDeleted([String(linkId)]);
            useNetworkDrawStore.getState().setSelectedNode(newNodeId);
            useNetworkToolbarStore.getState().show({ x: toolbar.x, y: toolbar.y }, 'node', { nodeId: String(newNodeId) });
            useMessageStore.getState().setMessage({ type: 'info', text: `링크를 분할했습니다 — 새 노드 ${String(newNodeId)} (통과 커넥션 자동 생성)` });
        };

        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <Btn onClick={handleReverse} title={`방향 반전 (${link.toNode} → ${link.fromNode})`}>⇄ 반전</Btn>
                    <Btn onClick={handleSplit} disabled={!toolbar.clickCoord} title="클릭 지점에서 분할">✂ 분할</Btn>
                    <Btn onClick={() => setPropsOpen((v) => !v)} title="차선 수 / 폭 / 속도">⚙ 속성{saving ? '…' : ''}</Btn>
                    <Btn danger onClick={handleDelete} title="링크 삭제 (Delete)">🗑 삭제</Btn>
                    <VDivider />
                    <Btn nav disabled={laneIdx == null} onClick={() => useNetworkToolbarStore.getState().setLevel('lane', { linkId, laneIdx: laneIdx ?? 0 })} title={laneIdx == null ? '레인 위를 클릭해야 활성화됩니다' : undefined}>
                        차선보기 ▸
                    </Btn>
                </div>
                {propsOpen && (
                    <div style={expandPanelStyle}>
                        <div className={styles.settingRow}>
                            <span className={styles.settingLabel}>차선 수</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button style={counterBtnStyle} onClick={() => scheduleApply({ numLane: Math.max(1, numLane - 1) })}>−</button>
                                <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{numLane}</span>
                                <button style={counterBtnStyle} onClick={() => scheduleApply({ numLane: Math.min(8, numLane + 1) })}>+</button>
                            </div>
                        </div>
                        <div className={styles.settingRow}>
                            <span className={styles.settingLabel}>도로 폭 (m)</span>
                            <input type="number" min={2} max={40} step={0.5} value={width}
                                   onChange={(e) => scheduleApply({ width: Number(e.target.value) })} style={inputStyle} />
                        </div>
                        <div className={styles.settingRow}>
                            <span className={styles.settingLabel}>제한속도</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="range" min={10} max={110} step={10} value={maxSpd}
                                       onChange={(e) => scheduleApply({ maxSpd: Number(e.target.value) })} className={styles.settingRange} />
                                <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                            </div>
                        </div>
                        <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 4 }}>
                            <div style={infoRowStyle}><span>길이</span><span style={{ color: '#888' }}>{Math.round(link.length)} m</span></div>
                            <div style={infoRowStyle}><span>방위각</span><span style={{ color: '#888' }}>{bearing !== null ? `${bearing}°` : '-'}</span></div>
                            <div style={infoRowStyle}><span>방향</span><span style={{ color: '#888' }}>{link.fromNode} → {link.toNode}</span></div>
                            <div style={infoRowStyle}><span>차선 폭</span><span style={{ color: '#888' }}>{(link.width / link.numLane).toFixed(1)} m</span></div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // 노드 레벨
    // ══════════════════════════════════════════════════════════════
    if (toolbar.level === 'node' && nodeId != null) {
        const node = network.nodes.find((n) => String(n.id) === nodeId);
        if (!node) return null;
        const inCount  = node.ports.filter((p) => p.type === 'in').length;
        const outCount = node.ports.filter((p) => p.type === 'out').length;
        const linkedLinkIds = [...new Set(node.ports.map((p) => p.linkId))];
        const nodeSignalCount = countSignalsForNodes([nodeId]);
        const nodePassThrough = isPassThroughNode(network, nodeId);
        const canCreateIntersection = inCount >= 1 && outCount >= 1;

        let nearestNode: typeof network.nodes[0] | null = null;
        let nearestDist = Infinity;
        for (const n of network.nodes) {
            if (String(n.id) === nodeId) continue;
            const d = getDistance([node.coordinates.lng, node.coordinates.lat], [n.coordinates.lng, n.coordinates.lat]);
            if (d < nearestDist) { nearestDist = d; nearestNode = n; }
        }
        const canMerge = nearestNode !== null && nearestDist < 30; // 30m: 교차로 클러스터 분리 노드 수준만 병합 후보

        const nodeStationCount = countStationsForNodes(network, [nodeId]);

        const handleDelete = () => {
            const doDelete = () => {
                const net = useNetworkStore.getState().currentJsonData;
                if (!net) return;
                const merged = mergeLinksAtNode(net, nodeId);
                const farIds = merged ? [] : farNodeIdsForCascadeDelete(net, [nodeId]);
                const next = merged ?? deleteNodeFromNetwork(net, nodeId);
                applyNetworkUpdate(next);
                const clearedCount = reconcileSignalConnectionIds(next, farIds);
                deleteSignalsForNodes([nodeId]);
                const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
                const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
                markRemovedForTileMask(net, next);
                useNetworkDrawStore.getState().clearSelection();
                useNetworkToolbarStore.getState().hide();
                useMessageStore.getState().setMessage({
                    type: 'info',
                    text: (merged
                        ? `노드 ${nodeId} 삭제 및 인접 링크 자동 병합됨${nodeSignalCount > 0 ? ` (신호 ${nodeSignalCount}개 삭제)` : ''}`
                        : `노드 ${nodeId}${nodeSignalCount > 0 ? ` (신호 ${nodeSignalCount}개 포함)` : ''} 삭제됨`)
                        + (removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : '')
                        + (removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : '')
                        + (clearedCount > 0 ? `, 인접 신호 ${clearedCount}개 커넥션 참조 초기화` : ''),
                });
            };
            if (nodeStationCount > 0) {
                useMessageStore.getState().setMessage({
                    type: 'confirm',
                    text: `노드 ${nodeId}을(를) 삭제합니다. 연결된 링크 위 정류장 ${nodeStationCount}개도 함께 삭제됩니다. 계속할까요?`,
                    onConfirm: doDelete,
                });
            } else {
                doDelete();
            }
        };

        const handleMerge = () => {
            if (!nearestNode) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            const absorbedSignalCount = countSignalsForNodes([nearestNode.id]);
            let net = mergeNodesInNetwork(cur, nodeId, nearestNode.id);
            net = regenerateNodeConnections(net, nodeId);
            applyNetworkUpdate(net);
            const clearedCount = reconcileSignalConnectionIds(net, [nodeId]);
            deleteSignalsForNodes([nearestNode.id]);
            markRemovedForTileMask(cur, net);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `노드 ${nodeId}에 ${nearestNode.id} 병합 + 교차로 커넥션 재생성됨`
                    + (absorbedSignalCount > 0 ? `, 흡수된 노드의 신호 ${absorbedSignalCount}개 삭제` : '')
                    + (clearedCount > 0 ? `, 신호 ${clearedCount}개 커넥션 참조 초기화` : ''),
            });
        };

        const handleCoordApply = () => {
            const lng = parseFloat(editLng);
            const lat = parseFloat(editLat);
            if (isNaN(lng) || isNaN(lat)) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(moveNode(cur, nodeId, { lng, lat }));
            setCoordOpen(false);
            useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${nodeId} 좌표 수정됨` });
        };

        const handleCreateIntersection = () => {
            if (!canCreateIntersection) return;
            const clearedCount = createIntersectionAtNode(nodeId);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `노드 ${nodeId} 교차로 connection 재생성 완료` + (clearedCount > 0 ? ` — 신호 ${clearedCount}개의 커넥션 참조 초기화` : ''),
            });
        };

        // 이 노드로 곧장 진입한 채 커넥션 편집 모드 시작 — 지도에서 노드를 다시 클릭할 필요 없음.
        // 커넥션 편집 중엔 이 툴바 대신 커넥션 편집 자체 UI(차선 점 드래그)가 상호작용을 담당.
        const handleEditConnections = () => {
            if (!canCreateIntersection) return;
            useNetworkDrawStore.getState().activateConnectionAndReset(nodeId);
            useNetworkToolbarStore.getState().hide();
        };

        return (
            <div style={{ position: 'fixed', left, top, zIndex: 4000 }}>
                <div style={barStyle}>
                    <Btn onClick={handleCreateIntersection} disabled={!canCreateIntersection} title={canCreateIntersection ? 'S/L/R 커넥션 자동 생성' : `in:${inCount} out:${outCount} — 포트 부족`}>⬡ 교차로</Btn>
                    <Btn onClick={handleEditConnections} disabled={!canCreateIntersection} title={canCreateIntersection ? '커넥션(회전 동선) 수동 편집으로 진입' : `in:${inCount} out:${outCount} — 포트 부족`}>🔀 커넥션 편집</Btn>
                    <Btn onClick={() => setCoordOpen((v) => !v)} title="좌표 직접 입력">✏ 좌표</Btn>
                    <Btn onClick={handleMerge} disabled={!canMerge} title={canMerge ? `노드 ${String(nearestNode!.id)}에 병합 (${Math.round(nearestDist)}m)` : '30m 이내 인접 노드 없음'}>⊕ 병합</Btn>
                    <Btn danger onClick={handleDelete} title="노드 삭제 (Delete)">🗑 삭제</Btn>
                </div>
                {coordOpen && (
                    <div style={expandPanelStyle}>
                        <div style={{ marginBottom: 4, fontSize: 10, color: '#555' }}>좌표 직접 입력</div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                            <input type="number" step="0.000001" placeholder="경도 (lng)" value={editLng} onChange={(e) => setEditLng(e.target.value)} style={coordInputStyle} />
                            <input type="number" step="0.000001" placeholder="위도 (lat)" value={editLat} onChange={(e) => setEditLat(e.target.value)} style={coordInputStyle} />
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={handleCoordApply} style={{ flex: 1, padding: '6px 14px', background: 'rgba(122,162,255,0.15)', border: '1px solid rgba(122,162,255,0.4)', borderRadius: 5, color: '#7aa2ff', fontSize: 12, cursor: 'pointer' }}>적용</button>
                            <button onClick={() => setCoordOpen(false)} style={{ flex: 1, padding: '6px 14px', background: 'rgba(220,50,50,0.15)', border: '1px solid rgba(220,50,50,0.35)', borderRadius: 5, color: '#ff6b6b', fontSize: 12, cursor: 'pointer' }}>취소</button>
                        </div>
                    </div>
                )}
                {!coordOpen && (
                    <div style={expandPanelStyle}>
                        <div style={infoRowStyle}><span>좌표</span><span style={{ color: '#888' }}>{node.coordinates.lng.toFixed(5)}, {node.coordinates.lat.toFixed(5)}</span></div>
                        <div style={infoRowStyle}><span>in / out 포트</span><span style={{ color: '#7aa2ff' }}>{inCount} / {outCount}</span></div>
                        <div style={infoRowStyle}><span>connection</span><span style={{ color: '#aaa' }}>{node.numConnection}개</span></div>
                        {(linkedLinkIds.length > 0 || nodeSignalCount > 0 || nodeStationCount > 0) && (
                            <div style={{ marginTop: 4, fontSize: 10, color: '#555' }}>
                                {nodePassThrough
                                    ? `삭제 시 인접 링크(레인 포함)가 자동 병합됩니다${nodeSignalCount > 0 ? ` · 신호 ${nodeSignalCount}개는 삭제` : ''}`
                                    : `삭제 시 연결 링크 ${linkedLinkIds.length}개, 커넥션${nodeSignalCount > 0 ? `, 신호 ${nodeSignalCount}개` : ''}${nodeStationCount > 0 ? `, 정류장 ${nodeStationCount}개` : ''}도 함께 삭제`}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return null;
};

export default NetworkEditToolbar;
