import React, { useEffect } from 'react';
import { useNodeContextMenuStore } from '@stores/useNodeContextMenuStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { createIntersectionAtNode } from '@hooks/useNetworkDraw';
import { useMessageStore } from '@stores/useMessageStore';

const menuBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 14px',
    background: 'none',
    border: 'none',
    color: '#ddd',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.12s',
    whiteSpace: 'nowrap',
};

const NodeContextMenu: React.FC = () => {
    const { visible, screenX, screenY, nodeId, hide } = useNodeContextMenuStore();
    const isMarked = useNetworkDrawStore((s) =>
        nodeId !== null && s.intersectionNodeIds.includes(String(nodeId))
    );

    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible, hide]);

    if (!visible || nodeId === null) return null;

    const network = useNetworkStore.getState().currentJsonData;
    const node = network?.nodes.find(n => String(n.id) === String(nodeId));
    const inCount  = node?.ports?.filter((p: any) => p.type === 'in').length  ?? 0;
    const outCount = node?.ports?.filter((p: any) => p.type === 'out').length ?? 0;
    const hasIn  = inCount >= 1;
    const hasOut = outCount >= 1;
    const canInstant = hasIn && hasOut; // 즉시 connection 생성 가능

    const handleCreateIntersection = () => {
        useNetworkDrawStore.getState().addIntersectionNode(nodeId);

        if (canInstant) {
            // ── in+out 모두 있음: 즉시 connection 생성 ──
            createIntersectionAtNode(nodeId);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `교차로 connection 생성 완료 (노드 ${String(nodeId)}). 추가 도로 연결 시 자동 갱신됩니다.`,
            });
            // draw 모드 활성화 (추가 도로 연결 가능)
            useNetworkDrawStore.getState().activateAndReset();
        } else if (hasIn && !hasOut) {
            // ── inPort만 있음: 나가는 도로가 필요 → B를 시작점으로 자동 설정 ──
            useNetworkDrawStore.getState().activateAndReset(String(nodeId));
            // 메시지는 draw effect에서 설정됨
        } else {
            // ── outPort만 있거나 포트 없음: 들어오는 도로 그리기 ──
            useNetworkDrawStore.getState().activateAndReset();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `교차로 지정됨. 이 노드로 들어오는 도로의 시작점을 클릭하세요.`,
            });
        }
        hide();
    };

    const menuW = 220;
    const menuH = 150;
    const left = Math.min(screenX + 4, window.innerWidth - menuW - 8);
    const top  = Math.min(screenY + 4, window.innerHeight - menuH - 8);

    // 버튼 텍스트 / 부제목
    const btnLabel = canInstant
        ? (isMarked ? '교차로 재생성' : '교차로 생성')
        : (isMarked ? '교차로 재지정' : '교차로 생성');

    const btnSub = canInstant
        ? '클릭 즉시 connection 생성'
        : hasIn
            ? '나가는 도로를 그릴 수 있습니다'
            : '들어오는 도로를 그릴 수 있습니다';

    return (
        <>
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 3999 }}
                onClick={hide}
                onContextMenu={(e) => { e.preventDefault(); hide(); }}
            />
            <div
                style={{
                    position: 'fixed',
                    left,
                    top,
                    zIndex: 4000,
                    background: 'rgba(14,16,28,0.97)',
                    border: '1px solid rgba(255,255,255,0.11)',
                    borderRadius: 8,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
                    overflow: 'hidden',
                    minWidth: menuW,
                    userSelect: 'none',
                }}
            >
                {/* 헤더 */}
                <div style={{
                    padding: '7px 14px 6px',
                    fontSize: 11,
                    color: '#555',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <div style={{ color: '#888' }}>노드 {String(nodeId)}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 10 }}>
                        <span style={{ color: hasIn ? '#7aa2ff' : '#444' }}>↘ in {inCount}</span>
                        <span style={{ color: hasOut ? '#7aa2ff' : '#444' }}>↗ out {outCount}</span>
                        {isMarked && (
                            <span style={{ color: '#ffb347' }}>⬡ 교차로 지정됨</span>
                        )}
                    </div>
                </div>

                {/* 교차로 생성 버튼 */}
                <button
                    style={menuBtnStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(122,162,255,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    onClick={handleCreateIntersection}
                >
                    <span style={{ fontSize: 15 }}>⬡</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{btnLabel}</span>
                        <span style={{ fontSize: 10, color: canInstant ? '#4caf50' : '#666' }}>
                            {btnSub}
                        </span>
                    </div>
                </button>

                {/* 회전교차로 (준비중) */}
                <button
                    style={{ ...menuBtnStyle, color: '#444', cursor: 'default' }}
                    onClick={hide}
                >
                    <span style={{ fontSize: 15 }}>◎</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>회전교차로 생성</span>
                        <span style={{ fontSize: 10, color: '#444' }}>준비중</span>
                    </div>
                </button>
            </div>
        </>
    );
};

export default NodeContextMenu;
