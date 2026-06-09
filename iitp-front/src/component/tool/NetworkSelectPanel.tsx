import React, { useEffect, useRef, useState } from 'react';
import { getDistance } from 'ol/sphere';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import {
    deleteLinkFromNetwork, deleteNodeFromNetwork,
    updateLinkInNetwork, reverseLinkDirection,
    mergeNodesInNetwork, moveNode,
    batchDeleteLinksFromNetwork, batchDeleteNodesFromNetwork,
    batchUpdateLinksInNetwork,
    applyNetworkUpdate,
} from '@hooks/useNetworkSelect';
import { createIntersectionAtNode } from '@hooks/useNetworkDraw';
import { useMessageStore } from '@stores/useMessageStore';
import { Coordinates } from '@type/Network';
import styles from '@css/ToolsPanel.module.css';

const useNetworkData = () => useNetworkStore(s => s.currentJsonData);

// ── 방위각 계산 ─────────────────────────────────────────────────────
function computeBearing(from: Coordinates, to: Coordinates): number {
    const toRad = Math.PI / 180;
    const lat1 = from.lat * toRad, lat2 = to.lat * toRad;
    const dLng = (to.lng - from.lng) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

// ── 스타일 ─────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
    width: '60px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    color: '#ccc',
    fontSize: '12px',
    padding: '2px 6px',
    textAlign: 'right',
};
const counterBtnStyle: React.CSSProperties = {
    width: '22px', height: '22px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#aaa', fontSize: '14px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
};
const deleteBtnStyle: React.CSSProperties = {
    width: '100%', padding: '7px 14px',
    background: 'rgba(220,50,50,0.15)',
    border: '1px solid rgba(220,50,50,0.35)',
    borderRadius: '5px', color: '#ff6b6b', fontSize: 12, cursor: 'pointer', marginTop: 6,
};
const actionBtnStyle: React.CSSProperties = {
    width: '100%', padding: '6px 14px',
    background: 'rgba(122,162,255,0.12)',
    border: '1px solid rgba(122,162,255,0.3)',
    borderRadius: '5px', color: '#7aa2ff', fontSize: 12, cursor: 'pointer', marginTop: 4,
};
const coordInputStyle: React.CSSProperties = {
    width: '90px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    color: '#ccc',
    fontSize: '11px',
    padding: '2px 5px',
    textAlign: 'right',
};

const NetworkSelectPanel: React.FC = () => {
    const selectedLinkId  = useNetworkDrawStore(s => s.selectedLinkId);
    const selectedNodeId  = useNetworkDrawStore(s => s.selectedNodeId);
    const selectedLinkIds = useNetworkDrawStore(s => s.selectedLinkIds);
    const selectedNodeIds = useNetworkDrawStore(s => s.selectedNodeIds);
    const network = useNetworkData();

    // ── 링크 로컬 상태 ──────────────────────────────────────────────
    const [numLane, setNumLane] = useState(2);
    const [width,   setWidth]   = useState(7.0);
    const [maxSpd,  setMaxSpd]  = useState(50);
    const [saving,  setSaving]  = useState(false);
    const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── 노드 좌표 편집 ──────────────────────────────────────────────
    const [editLng, setEditLng] = useState('');
    const [editLat, setEditLat] = useState('');
    const [coordEditing, setCoordEditing] = useState(false);

    // 링크 선택 변경 시 진행 중인 타이머 취소 + 값 동기화
    useEffect(() => {
        if (applyTimerRef.current) {
            clearTimeout(applyTimerRef.current);
            applyTimerRef.current = null;
        }
        setSaving(false);
        if (selectedLinkId === null) return;
        const link = network?.links.find(l => String(l.id) === String(selectedLinkId));
        if (!link) return;
        setNumLane(link.numLane);
        setWidth(link.width);
        setMaxSpd(link.maxSpd);
    }, [selectedLinkId]); // network 제외: 편집 중 외부 변경으로 값 덮어쓰기 방지

    // 언마운트 시 타이머 정리
    useEffect(() => {
        return () => { if (applyTimerRef.current) clearTimeout(applyTimerRef.current); };
    }, []);

    // 노드 선택 시 좌표 동기화
    useEffect(() => {
        if (selectedNodeId === null) { setCoordEditing(false); return; }
        const node = network?.nodes.find(n => String(n.id) === String(selectedNodeId));
        if (!node) return;
        setEditLng(node.coordinates.lng.toFixed(6));
        setEditLat(node.coordinates.lat.toFixed(6));
    }, [selectedNodeId, network]);

    // ── 링크 속성 자동 저장 (400ms debounce) ───────────────────────
    const scheduleApply = (patch: Partial<{ numLane: number; width: number; maxSpd: number }>) => {
        const next = { numLane, width, maxSpd, ...patch };
        if (patch.numLane !== undefined) setNumLane(patch.numLane);
        if (patch.width   !== undefined) setWidth(patch.width);
        if (patch.maxSpd  !== undefined) setMaxSpd(patch.maxSpd);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
        setSaving(true);
        applyTimerRef.current = setTimeout(() => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur || selectedLinkId === null) { setSaving(false); return; }
            applyNetworkUpdate(updateLinkInNetwork(cur, selectedLinkId, next));
            setSaving(false);
        }, 400);
    };

    // ── 멀티셀렉트 패널 ─────────────────────────────────────────────
    const isMultiLink = selectedLinkIds.length > 0;
    const isMultiNode = selectedNodeIds.length > 0;

    if (isMultiLink || isMultiNode) {
        const count       = isMultiLink ? selectedLinkIds.length : selectedNodeIds.length;
        const label       = isMultiLink ? '링크' : '노드';
        const accentColor = isMultiLink ? '#7aa2ff' : '#ffb347';

        const handleBatchDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            if (isMultiLink) {
                applyNetworkUpdate(batchDeleteLinksFromNetwork(cur, selectedLinkIds));
                useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${selectedLinkIds.length}개 삭제됨` });
            } else {
                applyNetworkUpdate(batchDeleteNodesFromNetwork(cur, selectedNodeIds));
                useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${selectedNodeIds.length}개 삭제됨` });
            }
            useNetworkDrawStore.getState().clearSelection();
        };

        return (
            <div style={{ marginTop: 8 }}>
                <div className={styles.sectionDivider} />
                <div style={{ padding: '6px 10px', fontSize: 11, color: accentColor, fontWeight: 600 }}>
                    {label} {count}개 선택됨
                </div>
                <div style={{
                    margin: '2px 10px 6px',
                    padding: '6px 8px',
                    background: 'rgba(100,200,255,0.07)',
                    border: '1px solid rgba(100,200,255,0.2)',
                    borderRadius: 5,
                    fontSize: 10, color: '#64b4ff', lineHeight: 1.7,
                }}>
                    Shift+클릭 → 추가 선택<br />
                    <span style={{ color: '#555' }}>빈 곳 클릭 → 선택 해제</span>
                </div>

                {isMultiLink && <BatchLinkEditor linkIds={selectedLinkIds} network={network} />}

                <div style={{ padding: '0 10px' }}>
                    <button style={deleteBtnStyle} onClick={handleBatchDelete}>
                        선택된 {label} {count}개 삭제 (Delete)
                    </button>
                </div>
            </div>
        );
    }

    if (selectedLinkId === null && selectedNodeId === null) return null;

    // ── 링크 패널 ─────────────────────────────────────────────────
    if (selectedLinkId !== null) {
        const link = network?.links.find(l => String(l.id) === String(selectedLinkId));
        if (!link || !network) return null;

        const bearing = link.coordinates.length >= 2
            ? computeBearing(link.coordinates[0]!, link.coordinates[link.coordinates.length - 1]!)
            : null;

        const handleDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(deleteLinkFromNetwork(cur, selectedLinkId));
            useNetworkDrawStore.getState().clearSelection();
        };

        const handleReverse = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(reverseLinkDirection(cur, selectedLinkId));
            useMessageStore.getState().setMessage({ type: 'info', text: `링크 ${selectedLinkId} 방향 반전됨 (교차로 재생성 권장)` });
        };

        return (
            <div style={{ marginTop: 8 }}>
                <div className={styles.sectionDivider} />
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#7aa2ff', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>선택된 링크 · {String(selectedLinkId)}</span>
                    {saving && <span style={{ fontSize: 10, color: '#4caf50' }}>저장 중...</span>}
                </div>

                {/* 형상 편집 안내 */}
                <div style={{
                    margin: '2px 10px 6px', padding: '6px 8px',
                    background: 'rgba(100,180,255,0.07)',
                    border: '1px solid rgba(100,180,255,0.2)',
                    borderRadius: 5, fontSize: 10, color: '#64b4ff', lineHeight: 1.7,
                }}>
                    꼭짓점 드래그 → 형상 변경 · Shift+클릭 → 다중 선택<br />
                    <span style={{ color: '#555' }}>파란 점선 위에서 드래그</span>
                </div>

                {/* 차선 수 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>차선 수</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button style={counterBtnStyle} onClick={() => scheduleApply({ numLane: Math.max(1, numLane - 1) })}>−</button>
                        <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{numLane}</span>
                        <button style={counterBtnStyle} onClick={() => scheduleApply({ numLane: Math.min(8, numLane + 1) })}>+</button>
                    </div>
                </div>

                {/* 도로 폭 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>도로 폭 (m)</span>
                    <input
                        type="number" min={2} max={40} step={0.5}
                        value={width}
                        onChange={e => scheduleApply({ width: Number(e.target.value) })}
                        style={inputStyle}
                    />
                </div>

                {/* 제한속도 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>제한속도</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="range" min={10} max={110} step={10}
                            value={maxSpd}
                            onChange={e => scheduleApply({ maxSpd: Number(e.target.value) })}
                            className={styles.settingRange}
                        />
                        <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                    </div>
                </div>

                {/* 읽기 전용 정보 */}
                <div style={{ padding: '4px 10px', fontSize: 10, color: '#555', lineHeight: 1.9 }}>
                    {[
                        ['길이', `${Math.round(link.length)} m`],
                        ['방위각', bearing !== null ? `${bearing}°` : '-'],
                        ['방향', `${link.fromNode} → ${link.toNode}`],
                        ['차선 폭', `${(link.width / link.numLane).toFixed(1)} m`],
                    ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{label}</span><span style={{ color: '#888' }}>{value}</span>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '0 10px' }}>
                    <button style={actionBtnStyle} onClick={handleReverse}>
                        ⇄ 방향 반전 ({link.toNode} → {link.fromNode})
                    </button>
                    <button style={deleteBtnStyle} onClick={handleDelete}>링크 삭제 (Delete)</button>
                </div>
            </div>
        );
    }

    // ── 노드 패널 ─────────────────────────────────────────────────
    if (selectedNodeId !== null) {
        const node = network?.nodes.find(n => String(n.id) === String(selectedNodeId));
        if (!node || !network) return null;

        const inCount  = node.ports.filter(p => p.type === 'in').length;
        const outCount = node.ports.filter(p => p.type === 'out').length;
        const linkedLinkIds = [...new Set(node.ports.map(p => p.linkId))];

        // 가장 가까운 노드 (병합 후보)
        let nearestNode: typeof network.nodes[0] | null = null;
        let nearestDist = Infinity;
        for (const n of network.nodes) {
            if (String(n.id) === String(selectedNodeId)) continue;
            const d = getDistance(
                [node.coordinates.lng, node.coordinates.lat],
                [n.coordinates.lng, n.coordinates.lat],
            );
            if (d < nearestDist) { nearestDist = d; nearestNode = n; }
        }
        const canMerge = nearestNode !== null && nearestDist < 50;

        const handleDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(deleteNodeFromNetwork(cur, selectedNodeId));
            useNetworkDrawStore.getState().clearSelection();
        };

        const handleMerge = () => {
            if (!nearestNode) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(mergeNodesInNetwork(cur, selectedNodeId, nearestNode.id));
            useNetworkDrawStore.getState().clearSelection();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `노드 ${selectedNodeId}에 ${nearestNode.id} 병합됨 (교차로 재생성 권장)`,
            });
        };

        const handleCoordApply = () => {
            const lng = parseFloat(editLng);
            const lat = parseFloat(editLat);
            if (isNaN(lng) || isNaN(lat)) return;
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(moveNode(cur, selectedNodeId, { lng, lat }));
            setCoordEditing(false);
            useMessageStore.getState().setMessage({ type: 'info', text: `노드 ${selectedNodeId} 좌표 수정됨` });
        };

        return (
            <div style={{ marginTop: 8 }}>
                <div className={styles.sectionDivider} />
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#ffb347', fontWeight: 600 }}>
                    선택된 노드 · {String(selectedNodeId)}
                </div>

                {/* 노드 이동 안내 */}
                <div style={{
                    margin: '2px 10px 6px', padding: '6px 8px',
                    background: 'rgba(100,180,255,0.07)',
                    border: '1px solid rgba(100,180,255,0.2)',
                    borderRadius: 5, fontSize: 10, color: '#64b4ff', lineHeight: 1.7,
                }}>
                    파란 원 드래그 → 이동 · Shift+클릭 → 다중 선택<br />
                    <span style={{ color: '#555' }}>연결된 링크 끝점 자동 업데이트</span>
                </div>

                {/* 포트 / connection 정보 */}
                <div style={{ padding: '4px 10px', fontSize: 10, color: '#555', lineHeight: 1.9 }}>
                    {[
                        ['in 포트', `${inCount}개`],
                        ['out 포트', `${outCount}개`],
                        ['connection', `${node.numConnection}개`],
                    ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{label}</span>
                            <span style={{ color: label === 'connection' ? '#aaa' : '#7aa2ff' }}>{value}</span>
                        </div>
                    ))}
                </div>

                {/* 좌표 편집 */}
                <div style={{ padding: '2px 10px 6px' }}>
                    {!coordEditing ? (
                        <div
                            style={{ fontSize: 10, color: '#555', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => setCoordEditing(true)}
                        >
                            <span>좌표</span>
                            <span style={{ color: '#666', textDecoration: 'underline dotted' }}>
                                {node.coordinates.lng.toFixed(5)}, {node.coordinates.lat.toFixed(5)}
                            </span>
                        </div>
                    ) : (
                        <div style={{ fontSize: 10, color: '#555' }}>
                            <div style={{ marginBottom: 4 }}>좌표 직접 입력</div>
                            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                                <input
                                    type="number" step="0.000001" placeholder="경도 (lng)"
                                    value={editLng}
                                    onChange={e => setEditLng(e.target.value)}
                                    style={coordInputStyle}
                                />
                                <input
                                    type="number" step="0.000001" placeholder="위도 (lat)"
                                    value={editLat}
                                    onChange={e => setEditLat(e.target.value)}
                                    style={coordInputStyle}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={handleCoordApply} style={{ ...actionBtnStyle, marginTop: 0, flex: 1 }}>적용</button>
                                <button onClick={() => setCoordEditing(false)} style={{ ...deleteBtnStyle, marginTop: 0, flex: 1 }}>취소</button>
                            </div>
                        </div>
                    )}
                </div>

                {linkedLinkIds.length > 0 && (
                    <div style={{ padding: '0 10px 4px', fontSize: 10, color: '#555' }}>
                        삭제 시 연결 링크 {linkedLinkIds.length}개도 함께 삭제
                    </div>
                )}

                <div style={{ padding: '0 10px' }}>
                    {/* 교차로 재생성: in/out 포트 모두 있을 때만 활성 */}
                    {inCount >= 1 && outCount >= 1 && (
                        <button
                            style={actionBtnStyle}
                            onClick={() => {
                                createIntersectionAtNode(selectedNodeId);
                                useMessageStore.getState().setMessage({
                                    type: 'info',
                                    text: `노드 ${String(selectedNodeId)} 교차로 재생성 완료`,
                                });
                            }}
                        >
                            ⬡ 교차로 connection 재생성
                        </button>
                    )}
                    {canMerge && nearestNode && (
                        <button style={{ ...actionBtnStyle, color: '#ffb347', borderColor: 'rgba(255,180,70,0.3)', background: 'rgba(255,180,70,0.06)' }} onClick={handleMerge}>
                            ⊕ 노드 {String(nearestNode.id)} 병합 ({Math.round(nearestDist)}m)
                        </button>
                    )}
                    <button style={deleteBtnStyle} onClick={handleDelete}>노드 삭제 (Delete)</button>
                </div>
            </div>
        );
    }

    return null;
};

// ── 다중 링크 일괄 속성 편집 ──────────────────────────────────────
interface BatchLinkEditorProps {
    linkIds: string[];
    network: ReturnType<typeof useNetworkData>;
}

const BatchLinkEditor: React.FC<BatchLinkEditorProps> = ({ linkIds, network }) => {
    const selectedLinks = linkIds
        .map(id => network?.links.find(l => String(l.id) === id))
        .filter((l): l is NonNullable<typeof l> => !!l);

    const initNumLane = selectedLinks.length > 0
        ? (selectedLinks.every(l => l.numLane === selectedLinks[0]!.numLane)
            ? selectedLinks[0]!.numLane : 2)
        : 2;
    const initMaxSpd = selectedLinks.length > 0
        ? (selectedLinks.every(l => l.maxSpd === selectedLinks[0]!.maxSpd)
            ? selectedLinks[0]!.maxSpd : 50)
        : 50;

    const [numLane, setNumLane] = React.useState(initNumLane);
    const [maxSpd,  setMaxSpd]  = React.useState(initMaxSpd);

    const handleApply = () => {
        const cur = useNetworkStore.getState().currentJsonData;
        if (!cur) return;
        applyNetworkUpdate(batchUpdateLinksInNetwork(cur, linkIds, { numLane, maxSpd }));
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `링크 ${linkIds.length}개 일괄 수정 (${numLane}차선, ${maxSpd}km/h)`,
        });
    };

    const mixedLane = selectedLinks.length > 0 && !selectedLinks.every(l => l.numLane === selectedLinks[0]!.numLane);
    const mixedSpd  = selectedLinks.length > 0 && !selectedLinks.every(l => l.maxSpd  === selectedLinks[0]!.maxSpd);

    return (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '4px 0' }}>
            <div style={{ padding: '6px 10px 2px', fontSize: 10, color: '#555' }}>일괄 속성 변경</div>

            <div className={styles.settingRow}>
                <span className={styles.settingLabel} style={{ color: mixedLane ? '#ffb347' : undefined }}>
                    차선 수{mixedLane ? ' (혼합)' : ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button style={counterBtnStyle} onClick={() => setNumLane(Math.max(1, numLane - 1))}>−</button>
                    <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{numLane}</span>
                    <button style={counterBtnStyle} onClick={() => setNumLane(Math.min(8, numLane + 1))}>+</button>
                </div>
            </div>

            <div className={styles.settingRow}>
                <span className={styles.settingLabel} style={{ color: mixedSpd ? '#ffb347' : undefined }}>
                    제한속도{mixedSpd ? ' (혼합)' : ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                        type="range" min={10} max={110} step={10}
                        value={maxSpd}
                        onChange={e => setMaxSpd(Number(e.target.value))}
                        className={styles.settingRange}
                    />
                    <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                </div>
            </div>

            <div style={{ padding: '2px 10px 6px' }}>
                <button
                    onClick={handleApply}
                    style={{
                        width: '100%', padding: '6px 14px',
                        background: 'rgba(122,162,255,0.15)',
                        border: '1px solid rgba(122,162,255,0.4)',
                        borderRadius: '5px', color: '#7aa2ff', fontSize: 12,
                        cursor: 'pointer', fontWeight: 600,
                    }}
                >
                    일괄 적용
                </button>
            </div>
        </div>
    );
};

export default NetworkSelectPanel;
