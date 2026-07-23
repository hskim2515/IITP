import React from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import styles from '@css/ToolsPanel.module.css';

/**
 * 도로 그리기 중 화면 상단에 뜨는 작은 설정바 — 차선수/폭/속도/양방향 + 그리기 종료.
 *
 * <p>이전엔 이 값들이 도킹된 NetworkDrawPanel(도로 그리기/선택/커넥션편집 모드 버튼이 있던
 * 패널, 삭제됨)의 "도로 기본값" 섹션에 상시 노출돼 있었다. 이제 모드 전환이 클릭 대상으로
 * 자동 결정되므로(빈 지형 클릭 = 그리기), 이 값들도 실제로 그리는 중일 때만 필요한 시점에
 * 잠깐 뜨는 편이 더 일관적이다. 그리기 시작점은 항상 지도의 어딘가라 클릭 지점을 따라가게
 * 만들면 위치 계산이 매번 바뀌어 번거로우므로, 고정 위치(화면 상단 중앙)로 둔다.
 */
const counterBtnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#aaa', fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
};
const inputStyle: React.CSSProperties = {
    width: 56, background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4, color: '#ccc', fontSize: 12,
    padding: '2px 6px', textAlign: 'right',
};

const NetworkDrawSettingsBar: React.FC = () => {
    const isActive = useNetworkDrawStore((s) => s.isActive);
    const laneCount = useNetworkDrawStore((s) => s.laneCount);
    const linkWidth = useNetworkDrawStore((s) => s.linkWidth);
    const maxSpd = useNetworkDrawStore((s) => s.maxSpd);
    const isBidirectional = useNetworkDrawStore((s) => s.isBidirectional);
    const setLaneCount = useNetworkDrawStore((s) => s.setLaneCount);
    const setLinkWidth = useNetworkDrawStore((s) => s.setLinkWidth);
    const setMaxSpd = useNetworkDrawStore((s) => s.setMaxSpd);
    const setBidirectional = useNetworkDrawStore((s) => s.setBidirectional);

    if (!isActive) return null;

    const handleStop = () => useNetworkDrawStore.getState().exitToSelect();

    return (
        <div style={{
            position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3500,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(14,16,28,0.97)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8, padding: '6px 10px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
            fontSize: 12, color: '#ddd', userSelect: 'none',
        }}>
            <span style={{ color: '#7aa2ff', fontWeight: 600, marginRight: 4 }}>✏ 도로 그리기</span>

            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginRight: 6 }}>
                <input type="checkbox" checked={isBidirectional} onChange={(e) => setBidirectional(e.target.checked)}
                       style={{ accentColor: '#7aa2ff', width: 13, height: 13 }} />
                <span className={styles.settingValue}>{isBidirectional ? '양방향' : '단방향'}</span>
            </label>

            <span style={{ color: '#555' }}>|</span>

            <span style={{ color: '#888', margin: '0 2px' }}>차선</span>
            <button onClick={() => setLaneCount(Math.max(1, laneCount - 1))} style={counterBtnStyle}>−</button>
            <span style={{ minWidth: 16, textAlign: 'center' }}>{laneCount}</span>
            <button onClick={() => setLaneCount(Math.min(8, laneCount + 1))} style={counterBtnStyle}>+</button>

            <span style={{ color: '#555' }}>|</span>

            <span style={{ color: '#888', margin: '0 2px' }}>폭</span>
            <input type="number" min={2} max={40} step={0.5} value={linkWidth}
                   onChange={(e) => setLinkWidth(Number(e.target.value))} style={inputStyle} />
            <span style={{ color: '#666' }}>m</span>

            <span style={{ color: '#555' }}>|</span>

            <span style={{ color: '#888', margin: '0 2px' }}>속도</span>
            <input type="range" min={10} max={110} step={10} value={maxSpd}
                   onChange={(e) => setMaxSpd(Number(e.target.value))} style={{ width: 60 }} />
            <span style={{ minWidth: 46, color: '#888' }}>{maxSpd} km/h</span>

            <span style={{ color: '#555' }}>|</span>

            <button
                onClick={handleStop}
                title="그리기 종료 (ESC)"
                style={{
                    padding: '4px 9px', background: 'rgba(220,50,50,0.15)',
                    border: '1px solid rgba(220,50,50,0.35)', borderRadius: 5,
                    color: '#ff6b6b', fontSize: 12, cursor: 'pointer',
                }}
            >
                ■ 종료
            </button>
        </div>
    );
};

export default NetworkDrawSettingsBar;
