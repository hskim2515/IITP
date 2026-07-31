import React, { useState } from 'react';
import { useRouteDrawStore, BusLineSet } from '@stores/useRouteDrawStore';
import { useMenuStore, findMenuByCode } from '@stores/useMenuStore';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useMessageStore } from '@stores/useMessageStore';
import { layerNameToStoreMap } from '@hooks/useLayerInit';
import { generateGuidWithParentGuid } from '@utils/guid';
import { createEventHandlers } from '@handler/createEventHandlers';
import { getActiveVersionId } from '@utils/versionId';
import axiosInstance from '@api/axiosInstance';

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

const RouteDrawToolbar: React.FC = () => {
    const mode = useRouteDrawStore((s) => s.mode);
    const draft = useRouteDrawStore((s) => s.draft);
    const busLineSet = useRouteDrawStore((s) => s.busLineSet);
    const [submitting, setSubmitting] = useState(false);

    if (mode === 'none') return null;

    const canFinish = draft.length >= 2 && !submitting;

    const handleFinishRail = () => {
        addRouteRecord('railRoute', 'routes', {
            name: '', railStationSeq: draft.map((d) => d.id).join(' '),
            fee: '0', departureTime: '', timeOffsetSeq: '',
        });
        openLineSession('RAIL_PT_LINE');
        useRouteDrawStore.getState().reset();
    };

    const handleFinishBus = async () => {
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) return;
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
