import React from 'react';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { useNetworkDrawStore, PlacementMode } from '@stores/useNetworkDrawStore';
import { useRouteDrawStore } from '@stores/useRouteDrawStore';
import { useModeStore } from '@stores/useModeStore';

const barStyle: React.CSSProperties = {
    position: 'fixed', zIndex: 4000,
    display: 'flex', alignItems: 'center', gap: 1,
    background: 'rgba(14,16,28,0.97)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    padding: 4,
    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
    userSelect: 'none',
    whiteSpace: 'nowrap',
};
const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 9px',
    background: 'transparent',
    border: 'none',
    borderRadius: 5,
    fontSize: 12,
    color: '#ffb347',
    cursor: 'pointer',
    lineHeight: 1,
};

const LINK_LEVELS = new Set(['link', 'lane', 'segment', 'cell']);

/**
 * "시설물 배치" 진입점 — 예전엔 레이어 팝업의 시설물 목록에 상시 노출된 "📍 배치" 버튼이었는데,
 * 노선 그리기(StationRouteContextBar)와의 일관성 및 사용자 요청("링크/노드 클릭 시 버튼이
 * 등장하며 시작")에 따라 지도에서 링크/노드를 클릭했을 때만 뜨는 맥락 버튼으로 옮겼다.
 *
 * <p>NetworkEditToolbar(도로 편집 맥락바)를 직접 수정하지 않고, 그 컴포넌트가 읽는 것과 동일한
 * 외부 상태(useNetworkToolbarStore/useNetworkDrawStore)를 별도로 구독하는 독립 컴포넌트다 —
 * NetworkEditToolbar.tsx는 이 시점에 다른 작업(동시 수정 중)이 진행 중이라 충돌을 피하기 위한
 * 의도적 선택. 위치도 NetworkEditToolbar의 정보 패널과 겹치지 않도록 그 오른쪽에 붙인다.
 *
 * <p>버스/철도 정류장은 링크(차선) 위에 배치되므로 link 계열 레벨(link/lane/segment/cell)에서,
 * 신호는 교차로(노드) 단위라 node 레벨에서만 노출한다. 다중 선택 중에는 배치 대상이 모호해져
 * 노출하지 않는다.
 */
const FacilityPlacementQuickBar: React.FC = () => {
    const isEditMode = useModeStore((s) => s.appMode === 'edit');
    const toolbar = useNetworkToolbarStore();
    const selectedLinkIds = useNetworkDrawStore((s) => s.selectedLinkIds);
    const selectedNodeIds = useNetworkDrawStore((s) => s.selectedNodeIds);

    if (!isEditMode || !toolbar.visible || !toolbar.level) return null;
    if (selectedLinkIds.length > 0 || selectedNodeIds.length > 0) return null;

    const showStationButtons = LINK_LEVELS.has(toolbar.level) && toolbar.linkId != null;
    const showSignalButton = toolbar.level === 'node' && toolbar.nodeId != null;
    if (!showStationButtons && !showSignalButton) return null;

    const start = (mode: PlacementMode) => {
        useRouteDrawStore.getState().reset(); // 배치와 노선 그리기는 상호 배타적
        useNetworkDrawStore.getState().setPlacementMode(mode);
        useNetworkToolbarStore.getState().hide();
    };

    const menuW = 320;
    const left = Math.min(toolbar.x + menuW + 8, window.innerWidth - 220 - 8);
    const top = Math.min(toolbar.y + 8, window.innerHeight - 60);

    return (
        <div style={{ ...barStyle, left, top }}>
            {showStationButtons && (
                <>
                    <button style={btnStyle} onClick={() => start('busStation')} title="이 링크(차선) 위에 버스 정류장 배치 시작">
                        🚌 정류장 배치
                    </button>
                    <button style={btnStyle} onClick={() => start('railStation')} title="이 링크(차선) 위에 철도역 배치 시작">
                        🚆 역 배치
                    </button>
                </>
            )}
            {showSignalButton && (
                <button style={btnStyle} onClick={() => start('signal')} title="이 교차로에 신호등 배치 시작">
                    🚥 신호 배치
                </button>
            )}
        </div>
    );
};

export default FacilityPlacementQuickBar;
