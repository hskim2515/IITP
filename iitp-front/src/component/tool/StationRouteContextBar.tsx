import React from 'react';
import { useSelectionStore } from '@stores/useSelectionStore';
import { useModeStore } from '@stores/useModeStore';
import { useRouteDrawStore } from '@stores/useRouteDrawStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { extractFeatureTypeFromGuid } from '@utils/guid';
import { FEATURE_TYPE } from '@type/Station';

const barStyle: React.CSSProperties = {
    position: 'fixed', top: 54, left: '50%', transform: 'translateX(-50%)', zIndex: 3500,
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(14,16,28,0.97)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    padding: '6px 10px',
    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
    userSelect: 'none',
    whiteSpace: 'nowrap',
};
const primaryBtnStyle: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid rgba(122,162,255,0.4)', background: 'rgba(122,162,255,0.15)', color: '#7aa2ff',
    fontSize: 12, fontWeight: 600,
};

/**
 * 정류장/역을 (배치/노선그리기 등 다른 모드 없이) 그냥 선택했을 때 뜨는 맥락 바 —
 * "이 정류장부터 노선 그리기 시작". Facility.tsx(레이어 팝업의 시설물 목록)에는 더 이상
 * 이 진입점을 두지 않는다(사용자 요청) — 다른 시설물 배치와 달리 노선 그리기는 특정
 * 정류장을 클릭해야 비로소 의미가 생기는 동작이라, 목록의 상시 버튼보다 지도에서 실제
 * 대상을 선택한 시점에 맥락으로 뜨는 편이 자연스럽다.
 *
 * <p>NetworkEditToolbar(노드/링크 클릭 맥락바)와 달리 클릭 좌표를 추적하지 않고 상단 고정
 * 위치에 뜬다 — RouteDrawToolbar와 정확히 같은 자리를 쓰며, mode==='none'일 때만 이 바가,
 * mode!=='none'일 때만 RouteDrawToolbar가 보이므로 서로 겹치지 않는다.
 */
const StationRouteContextBar: React.FC = () => {
    const isEditMode = useModeStore((s) => s.appMode === 'edit');
    const mode = useRouteDrawStore((s) => s.mode);
    const selectedGuid = useSelectionStore((s) => s.selectedGuid);

    if (!isEditMode || mode !== 'none') return null;
    const guid = selectedGuid.length === 1 ? selectedGuid[0] : null;
    if (typeof guid !== 'string') return null;

    const featureType = extractFeatureTypeFromGuid(guid);
    let label: string | null = null;
    let start: (() => void) | null = null;

    // ⚠️ 여기서 정류장 데이터를 읽어 label/버튼 표시 여부만 결정한다 — 실제 start() 클로저
    // 안에서는 이 값을 재사용하지 않고 클릭 시점에 다시 조회한다(아래 참고). 이 컴포넌트는
    // selectedGuid가 바뀔 때만 리렌더되고 정류장 스토어를 리액티브 구독하지 않으므로, 버튼이
    // 뜬 채로 그 정류장을 드래그해 linkRef가 바뀌면(선택은 유지됨) 렌더 시점 값이 곧바로
    // 낡아진다 — start()가 그 낡은 linkRef를 그대로 써버리면 노선이 정류장의 실제 현재
    // 위치와 다른 도로 기준으로 계산된다(2026-07-31 실사용 지적으로 발견).
    if (featureType === FEATURE_TYPE.BUS_STATION) {
        const station = useBusStationStore.getState().currentJsonData?.busStations
            ?.find((s: any) => s.__guid === guid);
        if (station?.id != null) {
            label = `🚌 버스정류장 #${station.id}부터 노선 그리기 시작`;
            start = () => {
                // 클릭 시점에 다시 조회 — 렌더 이후 드래그 등으로 linkRef가 바뀌었을 수 있음.
                const fresh = useBusStationStore.getState().currentJsonData?.busStations
                    ?.find((s: any) => s.__guid === guid);
                if (fresh?.id == null) return; // 그 사이 삭제됨
                const store = useRouteDrawStore.getState();
                store.start('bus');
                store.addStop({ guid, id: fresh.id, linkRef: fresh.linkRef });
            };
        }
    } else if (featureType === FEATURE_TYPE.RAIL_STATION) {
        const station = useRailStationStore.getState().currentJsonData?.railStations
            ?.find((s: any) => s.__guid === guid);
        if (station?.id != null) {
            label = `🚆 철도역 #${station.id}부터 노선 그리기 시작`;
            start = () => {
                const fresh = useRailStationStore.getState().currentJsonData?.railStations
                    ?.find((s: any) => s.__guid === guid);
                if (fresh?.id == null) return; // 그 사이 삭제됨
                const store = useRouteDrawStore.getState();
                store.start('rail');
                store.addStop({ guid, id: fresh.id });
            };
        }
    }

    if (!label || !start) return null;

    return (
        <div style={barStyle}>
            <button style={primaryBtnStyle} onClick={start}>{label}</button>
        </div>
    );
};

export default StationRouteContextBar;
