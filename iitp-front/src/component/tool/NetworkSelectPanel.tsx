import React, { useEffect, useState } from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { deleteLinkFromNetwork, deleteNodeFromNetwork, updateLinkInNetwork, applyNetworkUpdate } from '@hooks/useNetworkSelect';
import styles from '@css/ToolsPanel.module.css';

// 네트워크 데이터 변경 구독 (패널 재렌더용)
const useNetworkData = () => useNetworkStore(s => s.currentJsonData);

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
    width: '100%',
    padding: '7px 14px',
    background: 'rgba(220,50,50,0.15)',
    border: '1px solid rgba(220,50,50,0.35)',
    borderRadius: '5px',
    color: '#ff6b6b',
    fontSize: 12,
    cursor: 'pointer',
    marginTop: 6,
};
const applyBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 14px',
    background: 'rgba(122,162,255,0.15)',
    border: '1px solid rgba(122,162,255,0.35)',
    borderRadius: '5px',
    color: '#7aa2ff',
    fontSize: 12,
    cursor: 'pointer',
    marginTop: 4,
};

const NetworkSelectPanel: React.FC = () => {
    const selectedLinkId = useNetworkDrawStore(s => s.selectedLinkId);
    const selectedNodeId = useNetworkDrawStore(s => s.selectedNodeId);
    const network = useNetworkData(); // 네트워크 변경 시 자동 재렌더

    // ── 링크 편집 로컬 상태 ──────────────────────────────────────
    const [numLane, setNumLane] = useState(2);
    const [width,   setWidth]   = useState(7.0);
    const [maxSpd,  setMaxSpd]  = useState(50);

    useEffect(() => {
        if (selectedLinkId === null) return;
        const link = network?.links.find(l => String(l.id) === String(selectedLinkId));
        if (!link) return;
        setNumLane(link.numLane);
        setWidth(link.width);
        setMaxSpd(link.maxSpd);
    }, [selectedLinkId, network]);

    // ── 선택 해제 ─────────────────────────────────────────────────
    if (selectedLinkId === null && selectedNodeId === null) return null;

    // ── 링크 패널 ─────────────────────────────────────────────────
    if (selectedLinkId !== null) {
        const link = network?.links.find(l => String(l.id) === String(selectedLinkId));
        if (!link || !network) return null;

        const handleApply = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(updateLinkInNetwork(cur, selectedLinkId, { numLane, width, maxSpd }));
        };

        const handleDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(deleteLinkFromNetwork(cur, selectedLinkId));
            useNetworkDrawStore.getState().clearSelection();
        };

        return (
            <div style={{ marginTop: 8 }}>
                <div className={styles.sectionDivider} />
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#7aa2ff', fontWeight: 600 }}>
                    선택된 링크 · {String(selectedLinkId)}
                </div>

                {/* 형상 편집 안내 */}
                <div style={{
                    margin: '2px 10px 6px',
                    padding: '6px 8px',
                    background: 'rgba(100,180,255,0.07)',
                    border: '1px solid rgba(100,180,255,0.2)',
                    borderRadius: 5,
                    fontSize: 10,
                    color: '#64b4ff',
                    lineHeight: 1.7,
                }}>
                    꼭짓점 드래그 → 형상 변경<br />
                    <span style={{ color: '#555' }}>파란 점선 위에서 드래그</span>
                </div>

                {/* 차선 수 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>차선 수</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button style={counterBtnStyle} onClick={() => setNumLane(n => Math.max(1, n - 1))}>−</button>
                        <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{numLane}</span>
                        <button style={counterBtnStyle} onClick={() => setNumLane(n => Math.min(8, n + 1))}>+</button>
                    </div>
                </div>

                {/* 도로 폭 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>도로 폭 (m)</span>
                    <input
                        type="number" min={2} max={40} step={0.5}
                        value={width}
                        onChange={e => setWidth(Number(e.target.value))}
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
                            onChange={e => setMaxSpd(Number(e.target.value))}
                            className={styles.settingRange}
                        />
                        <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                    </div>
                </div>

                {/* 읽기 전용 정보 */}
                <div style={{ padding: '4px 10px', fontSize: 10, color: '#555', lineHeight: 1.8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>길이</span><span style={{ color: '#888' }}>{Math.round(link.length)} m</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>방향</span><span style={{ color: '#888' }}>{link.fromNode} → {link.toNode}</span>
                    </div>
                </div>

                <div style={{ padding: '0 10px' }}>
                    <button style={applyBtnStyle} onClick={handleApply}>적용</button>
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

        const handleDelete = () => {
            const cur = useNetworkStore.getState().currentJsonData;
            if (!cur) return;
            applyNetworkUpdate(deleteNodeFromNetwork(cur, selectedNodeId));
            useNetworkDrawStore.getState().clearSelection();
        };

        return (
            <div style={{ marginTop: 8 }}>
                <div className={styles.sectionDivider} />
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#ffb347', fontWeight: 600 }}>
                    선택된 노드 · {String(selectedNodeId)}
                </div>

                {/* 노드 이동 안내 */}
                <div style={{
                    margin: '2px 10px 6px',
                    padding: '6px 8px',
                    background: 'rgba(100,180,255,0.07)',
                    border: '1px solid rgba(100,180,255,0.2)',
                    borderRadius: 5,
                    fontSize: 10,
                    color: '#64b4ff',
                    lineHeight: 1.7,
                }}>
                    파란 원 드래그 → 노드 이동<br />
                    <span style={{ color: '#555' }}>연결된 링크 끝점 자동 업데이트</span>
                </div>

                <div style={{ padding: '4px 10px', fontSize: 10, color: '#555', lineHeight: 1.8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>in 포트</span><span style={{ color: '#7aa2ff' }}>{inCount}개</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>out 포트</span><span style={{ color: '#7aa2ff' }}>{outCount}개</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>connection</span><span style={{ color: '#aaa' }}>{node.numConnection}개</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>좌표</span>
                        <span style={{ color: '#666' }}>
                            {node.coordinates.lng.toFixed(5)}, {node.coordinates.lat.toFixed(5)}
                        </span>
                    </div>
                </div>

                {linkedLinkIds.length > 0 && (
                    <div style={{ padding: '2px 10px 4px', fontSize: 10, color: '#555' }}>
                        삭제 시 연결 링크 {linkedLinkIds.length}개도 함께 삭제됩니다
                    </div>
                )}

                <div style={{ padding: '0 10px' }}>
                    <button style={deleteBtnStyle} onClick={handleDelete}>노드 삭제 (Delete)</button>
                </div>
            </div>
        );
    }

    return null;
};

export default NetworkSelectPanel;
