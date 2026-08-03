import React, { useRef, useState } from 'react';
import { useRouteDrawStore, BusLineSet, RouteDrawStop } from '@stores/useRouteDrawStore';
import { useMenuStore, findMenuByCode } from '@stores/useMenuStore';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useMessageStore } from '@stores/useMessageStore';
import { layerNameToStoreMap } from '@hooks/useLayerInit';
import { generateGuidWithParentGuid } from '@utils/guid';
import { createEventHandlers } from '@handler/createEventHandlers';
import { getActiveVersionId } from '@utils/versionId';
import axiosInstance from '@api/axiosInstance';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';

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
const btnStyle: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)',
    color: '#ccc', fontSize: 12, fontWeight: 600,
};
const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    border: '1px solid rgba(122,162,255,0.4)', background: 'rgba(122,162,255,0.15)', color: '#7aa2ff',
};
const dangerBtnStyle: React.CSSProperties = {
    ...btnStyle,
    border: '1px solid rgba(220,50,50,0.35)', background: 'rgba(220,50,50,0.12)', color: '#ff6b6b',
};
const selectStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#ccc', fontSize: 12, padding: '4px 6px', borderRadius: 4,
};

const BUS_LINE_SET_LABELS: Record<BusLineSet, string> = {
    busRoute: '기본',
    busRouteWeekday: '평일',
    busRouteWeekend: '주말',
};
const BUS_LINE_SET_MENU_CODE: Record<BusLineSet, string> = {
    busRoute: 'BUS_PT_LINE',
    busRouteWeekday: 'BUS_PT_LINE_WEEKDAY',
    busRouteWeekend: 'BUS_PT_LINE_WEEKEND',
};

/** 완료 후 그 노선의 그리드 세션을 열어 이어서 id/interval/fee 등을 채우게 한다
 *  (HeaderMenu.tsx TopMenu.handleItemClick의 leaf 항목 처리와 동일 패턴). */
function openLineSession(menuCode: string) {
    const menu = useMenuStore.getState().menu;
    if (!menu) return;
    const item = findMenuByCode(menu, menuCode);
    if (!item) return;
    useMenuStore.getState().setActiveSubmenu(item);
    (useWorkflowStore.getState() as any).openSession(item);
}

/** DrilldownGrid.handleAdd와 동일한 "테이블에 새 행 추가" 경로를 그대로 재사용한다. */
function addRouteRecord(layerName: string, featureType: 'lines' | 'routes', fields: Record<string, any>) {
    const store = layerNameToStoreMap[layerName];
    if (!store) return;
    const rows = (store.getState().currentJsonData as any)?.[featureType] ?? [];
    const record: Record<string, any> = { id: Date.now(), ...fields, layerName, featureType };
    generateGuidWithParentGuid(null, record, rows);
    createEventHandlers(record); // lines/routes 핸들러 → addTabularRecord: store 삽입 + isChanged 설정 + 포커스 이동
}

/**
 * draft는 클릭 시점의 스냅샷(guid/id/linkRef)이라, 노선을 그리는 도중 그 정류장/역이
 * 삭제되면(Delete 키 등) "완료" 시점엔 이미 존재하지 않는 정류장 id가 그대로 stationSeq/
 * railStationSeq에 박혀 저장될 수 있다 — 버스 경로는 백엔드가 station 존재가 아니라 linkRef
 * (도로)만 확인하므로 이 경우도 조용히 성공해버려 더 위험하다. "완료" 직전에 각 draft 항목의
 * __guid가 지금도 해당 스토어에 살아있는지 재검증해, 하나라도 사라졌으면 완료를 막고 다시
 * 그리게 한다(부분 완료로 조용히 진행하지 않음 — 사용자가 의도한 정류장 순서가 달라질 수 있어).
 */
function validateDraftFreshness(draft: RouteDrawStop[], liveStations: any[] | undefined): boolean {
    const liveGuids = new Set((liveStations ?? []).map((s: any) => s.__guid));
    const staleCount = draft.filter((d) => !liveGuids.has(d.guid)).length;
    if (staleCount > 0) {
        useMessageStore.getState().setMessage({
            type: 'error',
            text: `그리는 도중 정류장/역 ${staleCount}개가 삭제되어 완료할 수 없습니다. 초기화 후 다시 그려주세요.`,
        });
        return false;
    }
    return true;
}

const RouteDrawToolbar: React.FC = () => {
    const mode = useRouteDrawStore((s) => s.mode);
    const draft = useRouteDrawStore((s) => s.draft);
    const busLineSet = useRouteDrawStore((s) => s.busLineSet);
    const [submitting, setSubmitting] = useState(false);
    // setSubmitting(true)는 리액트 상태 갱신이라 버튼의 disabled 속성이 다음 렌더 전까지
    // DOM에 반영 안 된다 — 그 사이(특히 handleFinishBus의 await 이전 구간) 빠른 연타/더블클릭이
    // 들어오면 두 번째 호출도 아직 활성화된 버튼을 통과해 노선이 중복 생성될 수 있다
    // (2026-07-31 실사용 지적으로 발견). ref는 동기적으로 즉시 반영되므로 그 창을 막는다.
    const finishingRef = useRef(false);

    if (mode === 'none') return null;

    const canFinish = draft.length >= 2 && !submitting;

    const handleFinishRail = () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        try {
            const liveStations = useRailStationStore.getState().currentJsonData?.railStations;
            if (!validateDraftFreshness(draft, liveStations)) return;
            addRouteRecord('railRoute', 'routes', {
                name: '', railStationSeq: draft.map((d) => d.id).join(' '),
                fee: '0', departureTime: '', timeOffsetSeq: '',
            });
            openLineSession('RAIL_PT_LINE');
            useRouteDrawStore.getState().reset();
        } finally {
            finishingRef.current = false;
        }
    };

    const handleFinishBus = async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) { finishingRef.current = false; return; }
        const liveStations = useBusStationStore.getState().currentJsonData?.busStations;
        if (!validateDraftFreshness(draft, liveStations)) { finishingRef.current = false; return; }
        setSubmitting(true);
        try {
            const res = await axiosInstance.post(`/public-transit/line/bus/${encodeURIComponent(scenarioKey)}/compute-path`, {
                stationLinkRefs: draft.map((d) => d.linkRef),
            });
            const { linkSeq, nodeSeq } = res.data;
            addRouteRecord(busLineSet, 'lines', {
                interval: 10, linkSeq, nodeSeq, stationSeq: draft.map((d) => d.id).join(' '),
            });
            openLineSession(BUS_LINE_SET_MENU_CODE[busLineSet]);
            useRouteDrawStore.getState().reset();
        } catch (e: any) {
            const msg = e?.response?.data?.message ?? '경로 계산에 실패했습니다.';
            useMessageStore.getState().setMessage({ type: 'error', text: msg });
        } finally {
            setSubmitting(false);
            finishingRef.current = false;
        }
    };

    return (
        <div style={barStyle}>
            <span style={{ fontSize: 12, fontWeight: 600, color: mode === 'bus' ? '#7aa2ff' : '#ffb347' }}>
                {mode === 'bus' ? '🚌 버스 노선 그리기' : '🚆 철도 노선 그리기'}
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>
                {draft.length === 0 ? '정류장을 순서대로 클릭하세요' : draft.map((d) => `#${d.id}`).join(' → ')}
            </span>
            {mode === 'bus' && (
                <select
                    value={busLineSet}
                    onChange={(e) => useRouteDrawStore.getState().setBusLineSet(e.target.value as BusLineSet)}
                    style={selectStyle}
                >
                    {(Object.keys(BUS_LINE_SET_LABELS) as BusLineSet[]).map((key) => (
                        <option key={key} value={key}>{BUS_LINE_SET_LABELS[key]}</option>
                    ))}
                </select>
            )}
            <button style={btnStyle} disabled={draft.length === 0} onClick={() => useRouteDrawStore.getState().removeLast()}>
                ◀ 마지막 취소
            </button>
            <button style={btnStyle} disabled={draft.length === 0} onClick={() => useRouteDrawStore.setState({ draft: [] })}>
                초기화
            </button>
            <button
                style={{ ...primaryBtnStyle, opacity: canFinish ? 1 : 0.5, cursor: canFinish ? 'pointer' : 'not-allowed' }}
                disabled={!canFinish}
                onClick={mode === 'bus' ? handleFinishBus : handleFinishRail}
            >
                {submitting ? '계산 중...' : `완료 (${draft.length}개)`}
            </button>
            <button style={dangerBtnStyle} onClick={() => useRouteDrawStore.getState().reset()} title="닫기 (ESC)">
                ✕
            </button>
        </div>
    );
};

export default RouteDrawToolbar;
