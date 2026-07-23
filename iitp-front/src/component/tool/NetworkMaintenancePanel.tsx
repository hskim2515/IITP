import React, { useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useNetworkStore } from '@stores/useNetworkStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useMessageStore } from '@stores/useMessageStore';
import { autoGenerateAllIntersections, detectAndSplitIntersections } from '@hooks/useNetworkDraw';
import { assignPropertyToResponseData } from '@utils/guid';
import { autoSaveChangedLayers } from '@utils/autoSave';
import { generateDummySignals } from '@utils/signal';
import { useBackgroundTaskStore } from '@stores/useBackgroundTaskStore';
import styles from '@css/ToolsPanel.module.css';

/**
 * 도로 편집의 "모드 전환"이 아닌 일회성 유틸리티 실행 도구함.
 *
 * <p>이전엔 NetworkDrawPanel(도로 그리기/선택/커넥션편집 모드 버튼이 있던 도킹 패널, 삭제됨)
 * 안에 모드 버튼들과 뒤섞여 있었지만, 이 3개 버튼과 단축키 안내는 "지금 무슨 모드인가"와
 * 무관하게 아무 때나 한 번 눌러 실행하는 액션이라 성격이 다르다 — 레이어/측정/데이터입출력과
 * 같은 성격의 "도구함" 팝업(ToolsPanel)에 두는 편이 맞다.
 */
const NetworkMaintenancePanel: React.FC = () => {
    // ⚠️ 아래 3개 핸들러(교차로 재생성/교차 감지/더미 신호 생성)는 전부 currentJsonData만
    //   대상으로 한다 — 상시 타일 모드에서 이는 "현재 화면에 로드된 도로"일 뿐, 부천시 같은
    //   대도시 전역이 아니다. 화면을 나눠 그린 뒤 마지막에 한 번만 누르면 화면 밖 지역은
    //   처리되지 않으므로, 결과 메시지에 항상 "화면에 로드된 범위만" 임을 명시한다.
    const [busyAction, setBusyAction] = useState<null | 'intersections' | 'split' | 'signals'>(null);
    const [showShortcuts, setShowShortcuts] = useState(false);
    // KTDB 가져오기 백그라운드 스캐폴딩(백엔드가 signal.xml/OD를 직접 재생성 중)과 겹치면
    // 프론트/백엔드가 같은 신호 데이터를 서로 다른 경로로 동시에 써서 덮어쓸 수 있다.
    const ktdbScaffolding = useBackgroundTaskStore((s) => !!s.tasks['ktdb-scaffold']);

    const handleAutoAllIntersections = () => {
        if (busyAction) return;
        setBusyAction('intersections');
        try {
            const { count, signalsCleared } = autoGenerateAllIntersections();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `화면에 로드된 교차로 재생성 완료 (${count}개 노드) — 화면 밖 지역은 해당 지역을 보면서 다시 실행하세요`
                    + (signalsCleared > 0 ? ` · 신호 ${signalsCleared}개의 커넥션 참조 초기화` : ''),
            });
        } finally {
            setBusyAction(null);
        }
    };

    const handleDetectSplit = () => {
        if (busyAction) return;
        setBusyAction('split');
        try {
            const { created, signalsCleared } = detectAndSplitIntersections();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: created > 0
                    ? `화면에 로드된 범위에서 교차 감지 → ${created}개 교차로 자동 생성됨${signalsCleared > 0 ? ` · 신호 ${signalsCleared}개의 커넥션 참조 초기화` : ''}`
                    : '화면에 로드된 범위에는 교차 지점 없음',
            });
        } finally {
            setBusyAction(null);
        }
    };

    const handleGenerateDummySignals = async () => {
        if (busyAction) return;
        if (ktdbScaffolding) {
            useMessageStore.getState().setMessage({
                type: 'warn',
                text: '서버가 백그라운드에서 신호/OD 데이터를 생성 중입니다 — 완료 후 다시 시도하세요.',
            });
            return;
        }
        setBusyAction('signals');
        try {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network?.nodes?.length) {
                useMessageStore.getState().setMessage({ type: 'warn', text: '네트워크 데이터가 없습니다.' });
                return;
            }

            const signals = generateDummySignals(network);
            const signalData = { signals };
            assignPropertyToResponseData(signalData);
            useSignalStore.getState().setCurrentJsonData(signalData);
            useSignalStore.getState().setChange(true);

            const versionKey = getActiveVersionId();
            if (versionKey) await autoSaveChangedLayers(versionKey);

            useMessageStore.getState().setMessage({
                type: 'info',
                text: `화면에 로드된 범위의 더미 신호 생성 완료 (${signals.length}개) — 화면 밖 지역은 해당 지역을 보면서 다시 실행하세요`,
            });
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    네트워크 도구
                </span>
            </div>

            <div className={styles.panelBody}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>교차로 자동 처리</div>
                <div style={{ fontSize: 9, color: '#777', marginBottom: 6, padding: '0 2px' }}>
                    ⓘ 아래 3개 버튼은 현재 화면에 로드된 도로만 처리합니다 (전체 도시 대상 아님)
                </div>

                <button style={{ ...utilBtnStyle, opacity: busyAction ? 0.6 : 1 }}
                    onClick={handleAutoAllIntersections} disabled={!!busyAction}
                    title="현재 화면에 로드된, in/out 포트가 모두 있는 노드의 connection을 자동 재생성 (화면 밖은 제외)">
                    {busyAction === 'intersections' ? '처리 중...' : '⬡ 화면 내 교차로 재생성'}
                </button>

                <button style={{ ...utilBtnStyle, marginTop: 4, color: '#ffb347', borderColor: 'rgba(255,180,70,0.3)', background: 'rgba(255,180,70,0.06)', opacity: busyAction ? 0.6 : 1 }}
                    onClick={handleDetectSplit} disabled={!!busyAction}
                    title="현재 화면에 로드된 범위에서 겹치는 도로 선분을 감지하여 교차로를 자동으로 분할·생성 (화면 밖은 제외)">
                    {busyAction === 'split' ? '처리 중...' : '✂ 화면 내 교차 감지 → 분할'}
                </button>

                <button style={{ ...utilBtnStyle, marginTop: 4, color: '#a0d8a0', borderColor: 'rgba(100,200,100,0.3)', background: 'rgba(100,200,100,0.06)', opacity: (busyAction || ktdbScaffolding) ? 0.6 : 1 }}
                    onClick={handleGenerateDummySignals} disabled={!!busyAction || ktdbScaffolding}
                    title={ktdbScaffolding
                        ? '서버가 백그라운드에서 신호/OD 데이터를 생성 중입니다'
                        : '현재 화면에 로드된 intersection 노드의 connection 기반으로 더미 신호 데이터 생성 (화면 밖은 제외)'}>
                    {busyAction === 'signals' ? '생성 중...' : ktdbScaffolding ? '서버 생성 중...' : '🚦 화면 내 더미 신호 생성'}
                </button>

                <div className={styles.sectionDivider} />

                <button onClick={() => setShowShortcuts((v) => !v)} style={shortcutToggleStyle}>
                    <span>⌨ 단축키</span>
                    <span style={{ fontSize: 10 }}>{showShortcuts ? '▲' : '▼'}</span>
                </button>

                {showShortcuts && (
                    <div style={{ marginTop: 4, padding: '6px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)', fontSize: 10, color: '#555' }}>
                        {SHORTCUTS.map(([key, desc]) => (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, lineHeight: 1.9 }}>
                                <span style={{ color: '#7aa2ff', background: 'rgba(122,162,255,0.08)', padding: '0 4px', borderRadius: 3, fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{key}</span>
                                <span style={{ color: '#666', textAlign: 'right' }}>{desc}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};

// ── 단축키 목록 ─────────────────────────────────────────────────
const SHORTCUTS: [string, string][] = [
    ['Ctrl+Z',         '실행 취소 (50단계)'],
    ['Ctrl+Shift+Z',   '다시 실행'],
    ['빈 지형 클릭',    '도로 그리기 시작'],
    ['더블클릭',       '이어 그리기 체인 종료'],
    ['ESC',            '취소 / 선택 모드로 복귀'],
    ['Delete',         '선택 요소 삭제'],
    ['Shift',          '각도 잠금 (그리기)'],
    ['Shift+클릭',     '다중 선택 토글'],
    ['핸들 드래그',    '꼭짓점/노드 이동 (선택 후)'],
    ['Ctrl+박스드래그', '범위 선택'],
];

// ── 스타일 ──────────────────────────────────────────────────────
const utilBtnStyle: React.CSSProperties = {
    width: '100%', padding: '7px 12px',
    background: 'rgba(122,162,255,0.07)',
    border: '1px solid rgba(122,162,255,0.22)',
    borderRadius: 5, color: '#7aa2ff', fontSize: 11,
    cursor: 'pointer', textAlign: 'left',
};
const shortcutToggleStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 5, color: '#666', fontSize: 11,
    cursor: 'pointer', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
};

export default NetworkMaintenancePanel;
