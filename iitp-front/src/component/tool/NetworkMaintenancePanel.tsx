import React, { useState } from 'react';
import styles from '@css/ToolsPanel.module.css';

/**
 * 도로 편집 단축키 안내 도구함.
 *
 * <p>이전엔 여기에 "화면 내 교차로 재생성"/"화면 내 교차 감지 → 분할"/"화면 내 더미 신호
 * 생성" 버튼이 있었는데, 전부 "지금 그리는 중"과 무관하게 아무 때나 누를 수 있어 실제로
 * 쓸모 있는 편집 흐름과 동떨어져 있었다(사용자 피드백). 교차로 재생성/교차 감지→분할은
 * 도로 그리기 중 실제로 필요한 시점에 뜨도록 NetworkDrawSettingsBar로 옮겼고, 더미 신호
 * 생성은 utils/dummyGeneration.runAutoDummyGeneration()이 필요한 시점에 자동으로 한다.
 */
const NetworkMaintenancePanel: React.FC = () => {
    const [showShortcuts, setShowShortcuts] = useState(true);

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    네트워크 도구
                </span>
            </div>

            <div className={styles.panelBody}>
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
const shortcutToggleStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 5, color: '#666', fontSize: 11,
    cursor: 'pointer', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
};

export default NetworkMaintenancePanel;
