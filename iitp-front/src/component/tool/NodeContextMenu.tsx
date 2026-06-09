import React, { useEffect } from 'react';
import { useNodeContextMenuStore } from '@stores/useNodeContextMenuStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { createIntersectionAtNode } from '@hooks/useNetworkDraw';
import { useMessageStore } from '@stores/useMessageStore';

const menuBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '9px 14px',
    background: 'none', border: 'none',
    color: '#ddd', fontSize: 13, cursor: 'pointer',
    textAlign: 'left', transition: 'background 0.12s',
    whiteSpace: 'nowrap',
};

const NodeContextMenu: React.FC = () => {
    const { visible, screenX, screenY, nodeId, hide } = useNodeContextMenuStore();

    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') useNodeContextMenuStore.getState().hide();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible]);

    if (!visible || nodeId === null) return null;

    const network = useNetworkStore.getState().currentJsonData;
    const node = network?.nodes.find(n => String(n.id) === String(nodeId));
    const inCount  = node?.ports?.filter((p: any) => p.type === 'in').length  ?? 0;
    const outCount = node?.ports?.filter((p: any) => p.type === 'out').length ?? 0;
    const canCreate = inCount >= 1 && outCount >= 1;
    const connCount = node?.connections?.length ?? 0;

    const menuW = 210;
    const menuH = 120;
    const left = Math.min(screenX + 4, window.innerWidth  - menuW - 8);
    const top  = Math.min(screenY + 4, window.innerHeight - menuH - 8);

    const handleCreateIntersection = () => {
        if (!canCreate) {
            useMessageStore.getState().setMessage({
                type: 'warn',
                text: `in(${inCount})/out(${outCount}) 포트가 모두 있어야 교차로를 생성할 수 있습니다.`,
            });
            hide();
            return;
        }
        createIntersectionAtNode(nodeId);
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `교차로 생성 완료 (노드 ${String(nodeId)}, connection ${connCount > 0 ? '재' : ''}생성)`,
        });
        hide();
    };

    const handleSelectNode = () => {
        useNetworkDrawStore.getState().setSelectActive(true);
        useNetworkDrawStore.getState().setSelectedNode(nodeId);
        hide();
    };

    return (
        <>
            {/* 배경 오버레이 */}
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 3999 }}
                onClick={hide}
                onContextMenu={e => { e.preventDefault(); hide(); }}
            />

            {/* 메뉴 */}
            <div style={{
                position: 'fixed', left, top, zIndex: 4000,
                background: 'rgba(14,16,28,0.97)',
                border: '1px solid rgba(255,255,255,0.11)',
                borderRadius: 8,
                boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
                overflow: 'hidden', minWidth: menuW, userSelect: 'none',
            }}>
                {/* 헤더 */}
                <div style={{
                    padding: '7px 14px 6px', fontSize: 11, color: '#555',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <div style={{ color: '#888' }}>노드 {String(nodeId)}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 10 }}>
                        <span style={{ color: inCount  > 0 ? '#7aa2ff' : '#444' }}>↘ in {inCount}</span>
                        <span style={{ color: outCount > 0 ? '#7aa2ff' : '#444' }}>↗ out {outCount}</span>
                        {connCount > 0 && <span style={{ color: '#4caf50' }}>⬡ {connCount}개</span>}
                    </div>
                </div>

                {/* 교차로 생성/재생성 */}
                <button
                    style={menuBtnStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(122,162,255,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    onClick={handleCreateIntersection}
                >
                    <span style={{ fontSize: 15, color: canCreate ? '#7aa2ff' : '#555' }}>⬡</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ color: canCreate ? '#ddd' : '#555' }}>
                            {connCount > 0 ? '교차로 재생성' : '교차로 생성'}
                        </span>
                        <span style={{ fontSize: 10, color: canCreate ? '#4caf50' : '#555' }}>
                            {canCreate ? 'S/L/R 자동 생성' : `in:${inCount} out:${outCount} — 포트 부족`}
                        </span>
                    </div>
                </button>

                {/* 노드 선택 (편집 패널 열기) */}
                <button
                    style={menuBtnStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    onClick={handleSelectNode}
                >
                    <span style={{ fontSize: 15 }}>↖</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>노드 선택</span>
                        <span style={{ fontSize: 10, color: '#555' }}>선택 패널에서 이동/삭제</span>
                    </div>
                </button>
            </div>
        </>
    );
};

export default NodeContextMenu;
