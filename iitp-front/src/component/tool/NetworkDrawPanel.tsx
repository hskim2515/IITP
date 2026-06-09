import React, { useState } from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useMessageStore } from '@stores/useMessageStore';
import { createIntersectionAtNode, autoGenerateAllIntersections, detectAndSplitIntersections } from '@hooks/useNetworkDraw';
import NetworkSelectPanel from './NetworkSelectPanel';
import styles from '@css/ToolsPanel.module.css';

const NetworkDrawPanel: React.FC = () => {
    const {
        isActive, isSelectActive,
        laneCount, linkWidth, maxSpd, isBidirectional,
        setActive, setSelectActive,
        setLaneCount, setLinkWidth, setMaxSpd, setBidirectional,
    } = useNetworkDrawStore();

    const [showShortcuts, setShowShortcuts] = useState(false);

    const toggle       = () => setActive(!isActive);
    const toggleSelect = () => setSelectActive(!isSelectActive);

    const handleAutoAllIntersections = () => {
        const count = autoGenerateAllIntersections();
        useMessageStore.getState().setMessage({
            type: 'info',
            text: `전체 교차로 재생성 완료 (${count}개 노드)`,
        });
    };

    const handleDetectSplit = () => {
        const count = detectAndSplitIntersections();
        useMessageStore.getState().setMessage({
            type: 'info',
            text: count > 0 ? `교차 감지 → ${count}개 교차로 자동 생성됨` : '교차 지점 없음',
        });
    };

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    도로 편집
                </span>
            </div>

            <div className={styles.panelBody}>

                {/* ── 모드 버튼 ──────────────────────────────── */}
                <button
                    className={isActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggle}
                    title={isActive ? '그리기 중지 (ESC)' : '도로 그리기 시작'}
                >
                    <span className={styles.measureIcon}>{isActive ? '■' : '✏'}</span>
                    {isActive ? '그리기 중지' : '도로 그리기'}
                </button>

                {isActive && (
                    <HintBox color="blue">
                        클릭 → 시작점<br />
                        이동 → 미리보기 · 클릭 → 구간 완성<br />
                        <span style={{ color: '#ffb347' }}>Shift → 각도 잠금</span><br />
                        우클릭/ESC → 취소
                    </HintBox>
                )}

                <button
                    className={isSelectActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggleSelect}
                    title={isSelectActive ? '선택 모드 종료 (ESC)' : '선택·편집'}
                >
                    <span className={styles.measureIcon}>{isSelectActive ? '■' : '↖'}</span>
                    {isSelectActive ? '선택 종료' : '선택·편집'}
                </button>

                {isSelectActive && (
                    <HintBox color="cyan">
                        클릭 → 선택 · Shift+클릭 → 다중<br />
                        <span style={{ color: '#ffb347' }}>Ctrl+드래그 → 꼭짓점/노드 이동</span><br />
                        Ctrl+드래그(빈 곳) → 범위 선택<br />
                        <span style={{ color: '#aaa' }}>Delete → 삭제 · ESC → 해제</span>
                    </HintBox>
                )}

                {/* 선택 요소 편집 패널 */}
                {isSelectActive && <NetworkSelectPanel />}

                <div className={styles.sectionDivider} />

                {/* ── 도로 설정 ──────────────────────────────── */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>도로 기본값</div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>양방향</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={isBidirectional}
                            onChange={e => setBidirectional(e.target.checked)}
                            style={{ accentColor: '#7aa2ff', width: 14, height: 14 }}
                        />
                        <span className={styles.settingValue}>{isBidirectional ? '상하행 자동' : '단방향'}</span>
                    </label>
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>차선 수</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => setLaneCount(Math.max(1, laneCount - 1))} style={counterBtnStyle}>−</button>
                        <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{laneCount}</span>
                        <button onClick={() => setLaneCount(Math.min(8, laneCount + 1))} style={counterBtnStyle}>+</button>
                    </div>
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>도로 폭</span>
                    <input
                        type="number" min={2} max={40} step={0.5}
                        value={linkWidth}
                        onChange={e => setLinkWidth(Number(e.target.value))}
                        style={inputStyle}
                    />
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>제한속도</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="range" min={10} max={110} step={10}
                            value={maxSpd}
                            onChange={e => setMaxSpd(Number(e.target.value))}
                            className={styles.settingRange}
                        />
                        <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                    </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* ── 교차로 일괄 처리 ───────────────────────── */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>교차로 자동 처리</div>

                <button style={utilBtnStyle} onClick={handleAutoAllIntersections}
                    title="in/out 포트가 모두 있는 노드의 connection을 자동 재생성">
                    ⬡ 전체 교차로 재생성
                </button>

                <button style={{ ...utilBtnStyle, marginTop: 4, color: '#ffb347', borderColor: 'rgba(255,180,70,0.3)', background: 'rgba(255,180,70,0.06)' }}
                    onClick={handleDetectSplit}
                    title="겹치는 도로 선분을 감지하여 교차로를 자동으로 분할·생성">
                    ✂ 교차 감지 → 교차로 분할
                </button>

                <div className={styles.sectionDivider} />

                {/* ── 단축키 ─────────────────────────────────── */}
                <button
                    onClick={() => setShowShortcuts(v => !v)}
                    style={shortcutToggleStyle}
                >
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

// ── 힌트 박스 ────────────────────────────────────────────────────
const HintBox: React.FC<{ color: 'blue' | 'cyan' | 'orange'; children: React.ReactNode }> = ({ color, children }) => {
    const colors = {
        blue:   { bg: 'rgba(65,105,225,0.08)',    border: 'rgba(65,105,225,0.25)',    text: '#7aa2ff' },
        cyan:   { bg: 'rgba(100,180,255,0.06)',   border: 'rgba(100,180,255,0.2)',    text: '#64b4ff' },
        orange: { bg: 'rgba(255,160,50,0.08)',    border: 'rgba(255,160,50,0.25)',    text: '#ffb347' },
    };
    const c = colors[color];
    return (
        <div style={{
            padding: '7px 10px', background: c.bg, borderRadius: 6,
            border: `1px solid ${c.border}`, marginBottom: 8,
            fontSize: 11, color: c.text, lineHeight: 1.7,
        }}>
            {children}
        </div>
    );
};

// ── 단축키 목록 ─────────────────────────────────────────────────
const SHORTCUTS: [string, string][] = [
    ['Ctrl+Z',         '실행 취소 (50단계)'],
    ['Ctrl+Shift+Z',   '다시 실행'],
    ['더블클릭',       '이어 그리기 체인 종료'],
    ['ESC',            '취소 / 선택 해제'],
    ['Delete',         '선택 요소 삭제'],
    ['Shift',          '각도 잠금 (그리기)'],
    ['Shift+클릭',     '다중 선택 토글'],
    ['Ctrl+드래그',    '꼭짓점/노드 이동 (OL·Cesium)'],
    ['Ctrl+박스드래그', '범위 선택'],
];

// ── 스타일 ──────────────────────────────────────────────────────
const counterBtnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#aaa', fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
};
const inputStyle: React.CSSProperties = {
    width: 60, background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4, color: '#ccc', fontSize: 12,
    padding: '2px 6px', textAlign: 'right',
};
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

export default NetworkDrawPanel;
