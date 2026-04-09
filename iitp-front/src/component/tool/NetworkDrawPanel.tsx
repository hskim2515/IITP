import React from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import NetworkSelectPanel from './NetworkSelectPanel';
import styles from '@css/ToolsPanel.module.css';

const NetworkDrawPanel: React.FC = () => {
    const {
        isActive, isConnectionActive, isSelectActive,
        laneCount, linkWidth, maxSpd, isBidirectional,
        setActive, setConnectionActive, setSelectActive,
        setLaneCount, setLinkWidth, setMaxSpd, setBidirectional,
    } = useNetworkDrawStore();

    const toggle = () => setActive(!isActive);
    const toggleConnection = () => setConnectionActive(!isConnectionActive);
    const toggleSelect = () => setSelectActive(!isSelectActive);

    return (
        <>
            {/* 패널 헤더 */}
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    도로 그리기
                </span>
            </div>

            {/* 패널 본문 */}
            <div className={styles.panelBody}>
                {/* 도로 그리기 토글 버튼 */}
                <button
                    className={isActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggle}
                    title={isActive ? '그리기 중지 (ESC)' : '도로 그리기 시작'}
                >
                    <span className={styles.measureIcon}>{isActive ? '■' : '✏'}</span>
                    {isActive ? '그리기 중지' : '도로 그리기 시작'}
                </button>

                {isActive && (
                    <div style={{
                        padding: '8px 10px',
                        background: 'rgba(65, 105, 225, 0.08)',
                        borderRadius: '6px',
                        border: '1px solid rgba(65, 105, 225, 0.25)',
                        marginBottom: '8px',
                        fontSize: '11px',
                        color: '#7aa2ff',
                        lineHeight: '1.7',
                    }}>
                        ① 클릭 → 시작점 설정<br />
                        ② 이동 → 도로 미리보기<br />
                        ③ 클릭 → 구간 완성<br />
                        <span style={{ color: '#aaa' }}>우클릭(노드) → 교차로 메뉴</span><br />
                        우클릭(빈 곳) → 취소 · ESC → 종료
                    </div>
                )}

                {/* Connection 그리기 토글 */}
                <button
                    className={isConnectionActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggleConnection}
                    title={isConnectionActive ? 'Connection 그리기 중지' : 'Connection 그리기 시작'}
                >
                    <span className={styles.measureIcon}>{isConnectionActive ? '■' : '↔'}</span>
                    {isConnectionActive ? 'Connection 중지' : 'Connection 그리기'}
                </button>

                {isConnectionActive && (
                    <div style={{
                        padding: '8px 10px',
                        background: 'rgba(255,160,50,0.08)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,160,50,0.25)',
                        marginBottom: '8px',
                        fontSize: '11px',
                        color: '#ffb347',
                        lineHeight: '1.7',
                    }}>
                        ① 교차로 노드 클릭 진입<br />
                        🔴 from 차선 → 🔵 to 차선 클릭<br />
                        <span style={{ color: '#aaa' }}>[A] 자동완성 · [Del] 전체삭제</span><br />
                        화살표 클릭 → connection 삭제<br />
                        ESC → 단계별 뒤로
                    </div>
                )}

                {/* 선택/편집 모드 토글 */}
                <button
                    className={isSelectActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggleSelect}
                    title={isSelectActive ? '선택 모드 종료 (ESC)' : '도로/노드 선택·편집'}
                >
                    <span className={styles.measureIcon}>{isSelectActive ? '■' : '↖'}</span>
                    {isSelectActive ? '선택 모드 종료' : '선택·편집'}
                </button>

                {isSelectActive && (
                    <div style={{
                        padding: '8px 10px',
                        background: 'rgba(100,180,255,0.06)',
                        borderRadius: '6px',
                        border: '1px solid rgba(100,180,255,0.2)',
                        marginBottom: '8px',
                        fontSize: '11px',
                        color: '#64b4ff',
                        lineHeight: '1.7',
                    }}>
                        클릭 → 링크/노드 선택<br />
                        꼭짓점 드래그 → 형상 편집<br />
                        노드 드래그 → 위치 이동<br />
                        <span style={{ color: '#aaa' }}>Delete → 삭제 · ESC → 해제</span>
                    </div>
                )}

                {/* 선택된 요소 편집 패널 */}
                {isSelectActive && <NetworkSelectPanel />}

                {/* 양방향 토글 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>양방향 도로</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={isBidirectional}
                            onChange={(e) => setBidirectional(e.target.checked)}
                            style={{ accentColor: '#7aa2ff', width: '14px', height: '14px' }}
                        />
                        <span className={styles.settingValue}>{isBidirectional ? '상하행 자동 생성' : '단방향'}</span>
                    </label>
                </div>

                <div className={styles.sectionDivider} />

                {/* 차선 수 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>차선 수</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button onClick={() => setLaneCount(Math.max(1, laneCount - 1))} style={counterBtnStyle}>−</button>
                        <span className={styles.settingValue} style={{ minWidth: '20px', textAlign: 'center' }}>
                            {laneCount}
                        </span>
                        <button onClick={() => setLaneCount(Math.min(8, laneCount + 1))} style={counterBtnStyle}>+</button>
                    </div>
                </div>

                {/* 도로 폭 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>도로 폭 (m)</span>
                    <input
                        type="number"
                        min={2}
                        max={40}
                        step={0.5}
                        value={linkWidth}
                        onChange={(e) => setLinkWidth(Number(e.target.value))}
                        style={inputStyle}
                    />
                </div>

                {/* 제한속도 */}
                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>제한속도</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                            type="range"
                            min={10}
                            max={110}
                            step={10}
                            value={maxSpd}
                            onChange={(e) => setMaxSpd(Number(e.target.value))}
                            className={styles.settingRange}
                        />
                        <span className={styles.settingValue} style={{ minWidth: '42px' }}>{maxSpd} km/h</span>
                    </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* 설정 요약 */}
                <div style={{
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#666',
                    lineHeight: 1.7,
                }}>
                    {[
                        ['차선 수', `${laneCount}차선`],
                        ['차선 폭', `${(linkWidth / laneCount).toFixed(1)} m`],
                        ['스냅 거리', '25 m'],
                    ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{label}</span>
                            <span style={{ color: '#aaa' }}>{value}</span>
                        </div>
                    ))}
                </div>

                <div className={styles.sectionDivider} />

                {/* 교차로 안내 */}
                <div style={{
                    padding: '8px 10px',
                    background: 'rgba(122,162,255,0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(122,162,255,0.12)',
                    fontSize: '11px',
                    color: '#666',
                    lineHeight: 1.7,
                }}>
                    <div style={{ color: '#7aa2ff', marginBottom: 4, fontWeight: 600 }}>교차로 생성</div>
                    노드 위에서 <strong style={{ color: '#aaa' }}>우클릭</strong> →<br />
                    교차로 메뉴에서 선택
                </div>
            </div>
        </>
    );
};

const counterBtnStyle: React.CSSProperties = {
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#aaa',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: 1,
};

const inputStyle: React.CSSProperties = {
    width: '60px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    color: '#ccc',
    fontSize: '12px',
    padding: '2px 6px',
    textAlign: 'right',
};

export default NetworkDrawPanel;
