import React from 'react';
import { useNetworkToolbarStore } from '@stores/useNetworkToolbarStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useModeStore } from '@stores/useModeStore';
import { useMessageStore } from '@stores/useMessageStore';
import { useSelectionStore } from '@stores/useSelectionStore';
import { useBusStationStore, useBusStationHistoryStore } from '@stores/useBusStationStore';
import { useRailStationStore, useRailStationHistoryStore } from '@stores/useRailStationStore';
import { useSignalStore, useSignalHistoryStore } from '@stores/useSignalStore';
import { generateGUIDWithType, extractFeatureTypeFromGuid } from '@utils/guid';
import { Coordinates } from '@type/Network';

// 정류장/역/신호(기존 시설물)는 항상 도로 링크/레인 위, 또는 노드 근처에 위치한다 — 그래서
// 그 아이콘을 클릭하면 useNetworkSelect.ts의 근접 탐색(findNearestLane/findNearestLink/
// findNearestNode)이 "그 밑에 깔린 링크/노드"로도 동시에 잡혀, 정류장을 클릭한 것뿐인데
// 이 배치바가 함께 뜨는 충돌이 있었다(2026-07-31 실사용 지적) — 새 시설물을 놓으려던 게
// 아니라 기존 시설물을 고르려던 클릭인데 "배치" 버튼이 옆에 떠 있으면 실수로 눌러 같은
// 자리에 중복 시설물이 생길 위험이 있다. 클릭이 이미 기존 시설물(정류장/역/신호)을
// 선택했다면(selectedGuid) 이 배치바는 뜨지 않는다.
const EXISTING_FACILITY_TYPES = new Set(['busStations', 'railStations', 'exits', 'signals']);

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

function midpoint(coords: Coordinates[] | undefined): Coordinates | null {
    if (!coords || coords.length === 0) return null;
    return coords[Math.floor(coords.length / 2)] ?? coords[0]!;
}

/**
 * "시설물 배치" 진입점 — 예전엔 레이어 팝업의 시설물 목록에 상시 노출된 "📍 배치" 버튼(클릭 후
 * 지도 아무 데나 다시 클릭해야 실제 배치되는 2단계 방식)이었다. 링크/노드를 이미 선택한
 * 맥락에서 뜨는 버튼인데 정작 배치는 그 선택과 무관하게 "다시 클릭한 아무 차선"에 이루어져
 * 버튼과 결과가 어긋난다는 지적(2026-07-31)에 따라, 지금은 버튼을 누르는 즉시 그 선택된
 * 링크/노드에 바로 배치한다(2단계 클릭 없음).
 *
 * <p>NetworkEditToolbar(도로 편집 맥락바)를 직접 수정하지 않고, 그 컴포넌트가 읽는 것과 동일한
 * 외부 상태(useNetworkToolbarStore)를 별도로 구독하는 독립 컴포넌트다 — NetworkEditToolbar.tsx는
 * 이 시점에 다른 작업(동시 수정 중)이 진행 중이라 충돌을 피하기 위한 의도적 선택.
 *
 * <p>버스 정류장은 링크의 특정 차선(laneRef)에 종속된 데이터라 linkRef/laneRef/offset을
 * 실제로 계산해 넣는다(createEventHandlers.ts의 busStations 핸들러가 지도 클릭 시 하는 것과
 * 동일한 필드 — 차이는 그 클릭 지점 대신 이미 선택된 링크의 hitFrac/clickCoord를 그대로
 * 재사용한다는 점뿐). 철도역은 NEXTSIM_DATA_STRUCTURE.md 기준 linkRef가 필요 없는 순수 좌표
 * 데이터라 좌표만 채운다. 신호는 교차로(노드) 단위라 nodeId만 있으면 된다.
 */
const FacilityPlacementQuickBar: React.FC = () => {
    const isEditMode = useModeStore((s) => s.appMode === 'edit');
    const toolbar = useNetworkToolbarStore();
    const measuredWidth = useNetworkToolbarStore((s) => s.measuredWidth);
    const network = useNetworkStore((s) => s.currentJsonData);
    const selectedGuid = useSelectionStore((s) => s.selectedGuid);

    if (!isEditMode || !toolbar.visible || !toolbar.level || !network) return null;

    // 지금 클릭이 기존 정류장/역/신호를 선택한 것이면(근접 탐색이 그 밑 링크/노드도 같이
    // 잡았을 뿐) 배치바를 띄우지 않는다 — 위 EXISTING_FACILITY_TYPES 주석 참고.
    const clickedExistingFacility = selectedGuid.some((g) => {
        const ft = extractFeatureTypeFromGuid(g);
        return ft != null && EXISTING_FACILITY_TYPES.has(ft);
    });
    if (clickedExistingFacility) return null;

    const showStationButtons = LINK_LEVELS.has(toolbar.level) && toolbar.linkId != null;
    const showSignalButton = toolbar.level === 'node' && toolbar.nodeId != null;
    if (!showStationButtons && !showSignalButton) return null;

    const link = toolbar.linkId != null ? network.links.find((l) => String(l.id) === toolbar.linkId) : null;

    const placeBusStation = () => {
        if (!link) return;
        const laneIdx = toolbar.laneIdx ?? 0;
        const lane = link.lanes?.[laneIdx];
        if (!lane) {
            useMessageStore.getState().setMessage({ type: 'warn', text: '이 링크에 차선 정보가 없습니다.' });
            return;
        }
        const frac = toolbar.hitFrac ?? 0.5;
        const offset = Math.max(0, Math.min(link.length, frac * link.length));
        const coordinates = toolbar.clickCoord ?? midpoint(lane.coordinates) ?? midpoint(link.coordinates);
        if (!coordinates) return;
        const record = {
            featureType: 'busStations', __guid: generateGUIDWithType('busStations'), id: Date.now(),
            linkRef: link.id, laneRef: lane.id, offset, coordinates,
        };
        useBusStationStore.getState().updateCurrentJsonData(record, useBusStationHistoryStore);
        useMessageStore.getState().setMessage({ type: 'info', text: `버스정류장이 추가되었습니다. (링크 ${link.id})` });
        useNetworkToolbarStore.getState().hide();
    };

    const placeRailStation = () => {
        if (!link) return;
        const coordinates = toolbar.clickCoord ?? midpoint(link.coordinates);
        if (!coordinates) return;
        const record = {
            featureType: 'railStations', __guid: generateGUIDWithType('railStations'), id: Date.now(),
            coordinates,
        };
        useRailStationStore.getState().updateCurrentJsonData(record, useRailStationHistoryStore);
        useMessageStore.getState().setMessage({ type: 'info', text: '철도역이 추가되었습니다.' });
        useNetworkToolbarStore.getState().hide();
    };

    const placeSignal = () => {
        if (toolbar.nodeId == null) return;
        const nodeExists = network.nodes.some((n) => String(n.id) === toolbar.nodeId);
        if (!nodeExists) {
            useMessageStore.getState().setMessage({ type: 'warn', text: '선택된 노드를 더 이상 찾을 수 없습니다. 다시 선택해주세요.' });
            useNetworkToolbarStore.getState().hide();
            return;
        }
        const record = {
            featureType: 'signals', __guid: generateGUIDWithType('signals'), id: Date.now(),
            nodeId: toolbar.nodeId, turning: 'Straight', type: 'TrafficLight',
        };
        useSignalStore.getState().updateCurrentJsonData(record, useSignalHistoryStore);
        useMessageStore.getState().setMessage({ type: 'info', text: `신호가 추가되었습니다. (노드 ${toolbar.nodeId})` });
        useNetworkToolbarStore.getState().hide();
    };

    // NetworkEditToolbar(맥락바)의 실제 렌더 폭 — 레벨/열린 패널(⚙속성, 🚧차로 폐쇄 등)에
    // 따라 버튼 수·패널 유무가 달라 고정폭이 아니다. 예전엔 320(추정치)을 하드코딩해서,
    // 맥락바에 버튼이 늘어나(예: 🚧 차로 폐쇄 추가) 실제 폭이 그걸 넘으면 이 퀵바가 맥락바
    // 위에 겹쳐 떴다(실사용 지적, 정류장/역/신호 배치 버튼 전부 동일 증상). 아직 측정 전(0)
    // 이면 이전 추정치를 폴백으로 유지.
    const menuW = measuredWidth > 0 ? measuredWidth : 320;
    const left = Math.min(toolbar.x + menuW + 8, window.innerWidth - 220 - 8);
    const top = Math.min(toolbar.y + 8, window.innerHeight - 60);

    return (
        <div style={{ ...barStyle, left, top }}>
            {showStationButtons && (
                <>
                    <button style={btnStyle} onClick={placeBusStation} title="이 링크(차선)에 버스 정류장 배치">
                        🚌 정류장 배치
                    </button>
                    <button style={btnStyle} onClick={placeRailStation} title="이 링크 위치에 철도역 배치">
                        🚆 역 배치
                    </button>
                </>
            )}
            {showSignalButton && (
                <button style={btnStyle} onClick={placeSignal} title="이 교차로에 신호등 배치">
                    🚥 신호 배치
                </button>
            )}
        </div>
    );
};

export default FacilityPlacementQuickBar;
