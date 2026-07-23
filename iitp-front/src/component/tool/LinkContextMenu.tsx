import React, { useEffect } from 'react';
import { useLinkContextMenuStore } from '@stores/useLinkContextMenuStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { useNetworkEditStore } from '@stores/useNetworkEditStore';
import { useMessageStore } from '@stores/useMessageStore';
import { splitLinkInNetwork, regenerateNodeConnections } from '@hooks/useNetworkDraw';
import {
    applyNetworkUpdate,
    deleteLinkFromNetwork,
    reverseLinkDirection,
    reconcileSignalConnectionIds,
    countStationsForLinks,
    deleteStationsForLinks,
} from '@hooks/useNetworkSelect';

const menuBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '9px 14px',
    background: 'none', border: 'none',
    color: '#ddd', fontSize: 13, cursor: 'pointer',
    textAlign: 'left', transition: 'background 0.12s',
    whiteSpace: 'nowrap',
};

/** 선택 모드 링크 우클릭 메뉴 — 분할·반전·삭제 (교차로 커넥션 정합성 자동 유지) */
const LinkContextMenu: React.FC = () => {
    const { visible, screenX, screenY, linkId, coord, hide } = useLinkContextMenuStore();

    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') useLinkContextMenuStore.getState().hide();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible]);

    if (!visible || linkId === null) return null;

    const network = useNetworkStore.getState().currentJsonData;
    const link = network?.links.find(l => String(l.id) === String(linkId));
    if (!network || !link) return null;

    const menuW = 230;
    const menuH = 160;
    const left = Math.min(screenX + 4, window.innerWidth  - menuW - 8);
    const top  = Math.min(screenY + 4, window.innerHeight - menuH - 8);

    const handleSplit = () => {
        if (!coord) { hide(); return; }
        const { updatedNetwork, newNodeId } = splitLinkInNetwork(network, link, coord, Date.now());
        applyNetworkUpdate(updatedNetwork);
        // 원본 링크는 사라짐 → MVT 마스킹 (타일 모드에서 옛 도로 잔존 방지)
        useNetworkEditStore.getState().addDeleted([String(linkId)]);
        useNetworkDrawStore.getState().setSelectedNode(newNodeId);
        // 우클릭 분할은 좌클릭 선택과 별개 경로라 맥락 툴바(NetworkEditToolbar)가 자동으로
        // 안 따라온다 — 방금 생긴 새 노드를 가리키도록 직접 갱신(없으면 옛 링크의 삭제/반전
        // 버튼이 지도 위에 그대로 남아있는 유령 툴바가 된다).
        useNetworkToolbarStore.getState().show({ x: screenX, y: screenY }, 'node', { nodeId: String(newNodeId) });
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `링크를 분할했습니다 — 새 노드 ${String(newNodeId)} (통과 커넥션 자동 생성)`,
        });
        hide();
    };

    const handleReverse = () => {
        // 반전 시 이 링크를 참조하던 커넥션은 방향이 무효 → 양끝 교차로 커넥션 재생성으로 정합 유지
        let net = reverseLinkDirection(network, linkId);
        net = regenerateNodeConnections(net, link.fromNode);
        net = regenerateNodeConnections(net, link.toNode);
        applyNetworkUpdate(net);
        const clearedCount = reconcileSignalConnectionIds(net, [link.fromNode, link.toNode]);
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `링크 방향을 반전하고 양끝 교차로 커넥션을 재생성했습니다${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}`,
        });
        hide();
    };

    const handleDelete = () => {
        const proceedDelete = () => {
            const net = useNetworkStore.getState().currentJsonData;
            if (!net) return;
            const beforeLinkIds = new Set(net.links.map(l => String(l.id)));
            const next = deleteLinkFromNetwork(net, linkId);
            applyNetworkUpdate(next);
            const clearedCount = reconcileSignalConnectionIds(next, [link.fromNode, link.toNode]);
            const removedLinks = [...beforeLinkIds].filter(id => !next.links.some(l => String(l.id) === id));
            const removedStationCount = deleteStationsForLinks(removedLinks);
            useNetworkEditStore.getState().addDeleted([String(linkId)]);
            useNetworkDrawStore.getState().clearSelection();
            // 우클릭 삭제 대상이 마침 맥락 툴바가 가리키던 그 링크라면(좌클릭으로 먼저 선택한
            // 뒤 우클릭한 경우) 툴바도 같이 닫는다 — 아니면 방금 삭제된 링크의 버튼이 지도
            // 위에 유령처럼 남는다. 다른 링크를 가리키고 있었다면 그대로 둔다.
            if (String(useNetworkToolbarStore.getState().linkId) === String(linkId)) {
                useNetworkToolbarStore.getState().hide();
            }
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `링크 ${String(linkId)} 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ''}${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ''}`,
            });
        };
        const stationCount = countStationsForLinks([linkId]);
        if (stationCount > 0) {
            useMessageStore.getState().setMessage({
                type: 'confirm',
                text: `링크 ${String(linkId)}을(를) 삭제합니다. 이 링크 위 정류장 ${stationCount}개도 함께 삭제됩니다. 계속할까요?`,
                onConfirm: proceedDelete,
            });
        } else {
            proceedDelete();
        }
        hide();
    };

    const item = (
        icon: string, label: string, sub: string, onClick: () => void, danger = false,
    ) => (
        <button
            style={menuBtnStyle}
            onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(255,80,80,0.12)' : 'rgba(122,162,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={onClick}
        >
            <span style={{ fontSize: 15, color: danger ? '#ff6b6b' : '#7aa2ff' }}>{icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: danger ? '#ff9b9b' : '#ddd' }}>{label}</span>
                <span style={{ fontSize: 10, color: '#555' }}>{sub}</span>
            </div>
        </button>
    );

    return (
        <>
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 3999 }}
                onClick={hide}
                onContextMenu={e => { e.preventDefault(); hide(); }}
            />
            <div style={{
                position: 'fixed', left, top, zIndex: 4000,
                background: 'rgba(14,16,28,0.97)',
                border: '1px solid rgba(255,255,255,0.11)',
                borderRadius: 8,
                boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
                overflow: 'hidden', minWidth: menuW, userSelect: 'none',
            }}>
                <div style={{
                    padding: '7px 14px 6px', fontSize: 11, color: '#555',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <div style={{ color: '#888' }}>링크 {String(linkId)}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 10 }}>
                        <span style={{ color: '#7aa2ff' }}>차선 {link.numLane}</span>
                        <span style={{ color: '#666' }}>{link.fromNode} → {link.toNode}</span>
                    </div>
                </div>
                {item('✂', '여기서 분할', '노드 삽입 + 통과 커넥션 자동 생성', handleSplit)}
                {item('⇄', '방향 반전', '양끝 교차로 커넥션 자동 재생성', handleReverse)}
                {item('🗑', '링크 삭제', '연결된 포트·커넥션도 함께 정리', handleDelete, true)}
            </div>
        </>
    );
};

export default LinkContextMenu;
