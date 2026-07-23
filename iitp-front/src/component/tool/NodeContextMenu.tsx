import React, { useEffect } from 'react';
import { useNodeContextMenuStore } from '@stores/useNodeContextMenuStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
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
    const isTagged = String(nodeId) in useNetworkDrawStore.getState().intersectionNodes;

    const menuW = 210;
    const menuH = 220;
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
        const clearedCount = createIntersectionAtNode(nodeId);
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `교차로 생성 완료 (노드 ${String(nodeId)}, connection ${connCount > 0 ? '재' : ''}생성)`
                + (clearedCount > 0 ? ` — 신호 ${clearedCount}개의 커넥션 참조 초기화` : ''),
        });
        hide();
    };

    const handleSelectNode = () => {
        useNetworkDrawStore.getState().setSelectActive(true);
        useNetworkDrawStore.getState().setSelectedNode(nodeId);
        // 좌클릭 없이 우클릭 메뉴로 바로 선택하는 경로라, 맥락 툴바(NetworkEditToolbar)가 이
        // 호출 없이는 안 뜬다 — show()를 직접 안 해주면 지도 위 하이라이트만 생기고 정작
        // 조작(삭제/병합/커넥션편집 등) 버튼은 하나도 안 보이는 상태가 된다.
        useNetworkToolbarStore.getState().show({ x: screenX, y: screenY }, 'node', { nodeId: String(nodeId) });
        hide();
    };

    // 지금은 포트가 한쪽뿐(in 또는 out만)이라 바로 교차로를 만들 수 없는 노드를 "지정"해두면,
    // 그리기 중 화면에 항상 마커로 표시되고 스냅 반경도 넓어져(findSnapNode), 나중에 다른
    // 지역을 그리다 여기로 돌아와도 놓치지 않고 정확히 이 노드에 스냅해 연결할 수 있다.
    // 거리 기반 자동 병합은 하지 않는다 — 항상 실제로 스냅된 "같은 id의 노드"에만 연결되므로
    // 서로 다른 두 교차로가 잘못 합쳐질 위험이 없다.
    const handleToggleIntersectionTag = () => {
        if (isTagged) {
            useNetworkDrawStore.getState().removeIntersectionNode(nodeId);
            useMessageStore.getState().setMessage({ type: 'info', text: `교차로 지정 해제 (노드 ${String(nodeId)})` });
        } else {
            if (!node) { hide(); return; }
            useNetworkDrawStore.getState().addIntersectionNode(nodeId, node.coordinates);
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `교차로로 지정했습니다 (노드 ${String(nodeId)}) — 그리기 모드에서 항상 마커로 표시되며, 나중에 이 지점에 스냅해 도로를 연결하면 자동 완성됩니다.`,
            });
        }
        hide();
    };

    // 이 노드에서 바로 도로 그리기를 시작 — 화면을 옮겨가며 이어 그릴 때 매번 지도에서
    // 끝점을 다시 찾아 클릭할 필요 없이, 컨텍스트 메뉴로 바로 이어갈 수 있게 한다.
    const handleStartDrawingHere = () => {
        useNetworkDrawStore.getState().activateAndReset(String(nodeId));
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

                {/* 이 노드에서 도로 그리기 시작 */}
                <button
                    style={menuBtnStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(122,162,255,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    onClick={handleStartDrawingHere}
                >
                    <span style={{ fontSize: 15, color: '#7aa2ff' }}>✏</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>여기서 도로 그리기 시작</span>
                        <span style={{ fontSize: 10, color: '#555' }}>이 노드를 시작점으로 바로 이어 그리기</span>
                    </div>
                </button>

                {/* 교차로 지정 (지연 병합) */}
                <button
                    style={menuBtnStyle}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,180,70,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    onClick={handleToggleIntersectionTag}
                >
                    <span style={{ fontSize: 15, color: '#ffb347' }}>{isTagged ? '★' : '☆'}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{isTagged ? '교차로 지정 해제' : '교차로로 지정'}</span>
                        <span style={{ fontSize: 10, color: '#555' }}>
                            {isTagged ? '지정됨 — 그리기 중 마커로 표시 · 넓은 스냅 반경' : '그리기 중 마커 표시 + 넓은 스냅 반경으로 나중에 찾기 쉽게'}
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
                        <span style={{ fontSize: 10, color: '#555' }}>맥락 툴바에서 이동/삭제</span>
                    </div>
                </button>
            </div>
        </>
    );
};

export default NodeContextMenu;
