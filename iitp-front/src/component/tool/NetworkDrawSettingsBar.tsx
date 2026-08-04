import React, { useState } from 'react';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useMessageStore } from '@stores/useMessageStore';
import { autoGenerateAllIntersections, detectAndSplitIntersections } from '@hooks/useNetworkDraw';
import styles from '@css/ToolsPanel.module.css';

/**
 * 도로 그리기 중 화면 상단에 뜨는 작은 설정바 — 차선수/폭/속도/양방향 + 교차로 정리 + 그리기 종료.
 *
 * <p>이전엔 이 값들이 도킹된 NetworkDrawPanel(도로 그리기/선택/커넥션편집 모드 버튼이 있던
 * 패널, 삭제됨)의 "도로 기본값" 섹션에 상시 노출돼 있었다. 이제 모드 전환이 클릭 대상으로
 * 자동 결정되므로(빈 지형 클릭 = 그리기), 이 값들도 실제로 그리는 중일 때만 필요한 시점에
 * 잠깐 뜨는 편이 더 일관적이다. 그리기 시작점은 항상 지도의 어딘가라 클릭 지점을 따라가게
 * 만들면 위치 계산이 매번 바뀌어 번거로우므로, 고정 위치(화면 상단 중앙)로 둔다.
 *
 * <p>교차로 재생성/교차 감지→분할 버튼은 원래 상시 노출되는 별도 도구함(NetworkMaintenancePanel)에
 * 있었는데, "지금 그리는 중"과 무관하게 아무 때나 누를 수 있어 편집 흐름과 동떨어져 있었다
 * (사용자 피드백) — 실제로 쓸모 있는 시점은 도로를 그리는 도중/직후뿐이라 여기로 옮겼다.
 */
const counterBtnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4,
    border: '1px solid rgba(var(--overlay-rgb), 0.12)',
    background: 'rgba(var(--overlay-rgb), 0.06)',
    color: 'var(--text-tertiary)', fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
};
const inputStyle: React.CSSProperties = {
    width: 56, background: 'rgba(var(--overlay-rgb), 0.06)',
    border: '1px solid rgba(var(--overlay-rgb), 0.12)',
    borderRadius: 4, color: 'var(--text-secondary)', fontSize: 12,
    padding: '2px 6px', textAlign: 'right',
};
const utilBtnStyle: React.CSSProperties = {
    padding: '4px 9px',
    background: 'rgba(var(--accent-text-rgb), 0.12)',
    border: '1px solid rgba(var(--accent-text-rgb), 0.3)',
    borderRadius: 5, color: 'var(--accent-text)', fontSize: 12,
    cursor: 'pointer', whiteSpace: 'nowrap',
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
    const [busyAction, setBusyAction] = useState<null | 'intersections' | 'split'>(null);

    if (!isActive) return null;

    const handleStop = () => useNetworkDrawStore.getState().exitToSelect();

    // ⚠️ 둘 다 currentJsonData(=현재 화면에 로드된 도로, 타일 모드에서는 전국이 아님)만
    // 대상으로 한다 — 화면을 나눠 그렸다면 화면 밖 지역은 이 버튼으로 처리되지 않는다.
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

    return (
        <div style={{
            position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3500,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(var(--surface-1-rgb), 0.97)',
            border: '1px solid rgba(var(--overlay-rgb), 0.14)',
            borderRadius: 8, padding: '6px 10px',
            boxShadow: '0 8px 28px rgba(var(--surface-overlay-rgb), 0.6)',
            fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none',
        }}>
            <span style={{ color: 'var(--accent-text)', fontWeight: 600, marginRight: 4 }}>✏ 도로 그리기</span>

            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginRight: 6 }}>
                <input type="checkbox" checked={isBidirectional} onChange={(e) => setBidirectional(e.target.checked)}
                       style={{ accentColor: 'var(--accent-text)', width: 13, height: 13 }} />
                <span className={styles.settingValue}>{isBidirectional ? '양방향' : '단방향'}</span>
            </label>

            <span style={{ color: 'var(--text-disabled)' }}>|</span>

            <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>차선</span>
            <button onClick={() => setLaneCount(Math.max(1, laneCount - 1))} style={counterBtnStyle}>−</button>
            <span style={{ minWidth: 16, textAlign: 'center' }}>{laneCount}</span>
            <button onClick={() => setLaneCount(Math.min(8, laneCount + 1))} style={counterBtnStyle}>+</button>

            <span style={{ color: 'var(--text-disabled)' }}>|</span>

            <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>폭</span>
            <input type="number" min={2} max={40} step={0.5} value={linkWidth}
                   onChange={(e) => setLinkWidth(Number(e.target.value))} style={inputStyle} />
            <span style={{ color: 'rgba(var(--overlay-rgb), 0.4)' }}>m</span>

            <span style={{ color: 'var(--text-disabled)' }}>|</span>

            <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>속도</span>
            <input type="range" min={10} max={110} step={10} value={maxSpd}
                   onChange={(e) => setMaxSpd(Number(e.target.value))} style={{ width: 60 }} />
            <span style={{ minWidth: 46, color: 'var(--text-muted)' }}>{maxSpd} km/h</span>

            <span style={{ color: 'var(--text-disabled)' }}>|</span>

            <button
                onClick={handleAutoAllIntersections}
                disabled={!!busyAction}
                title="현재 화면에 로드된, in/out 포트가 모두 있는 노드의 connection을 자동 재생성 (화면 밖은 제외)"
                style={{ ...utilBtnStyle, opacity: busyAction ? 0.6 : 1 }}
            >
                {busyAction === 'intersections' ? '처리 중...' : '⬡ 교차로 재생성'}
            </button>
            <button
                onClick={handleDetectSplit}
                disabled={!!busyAction}
                title="현재 화면에 로드된 범위에서 겹치는 도로 선분을 감지하여 교차로를 자동으로 분할·생성 (화면 밖은 제외)"
                style={{ ...utilBtnStyle, opacity: busyAction ? 0.6 : 1 }}
            >
                {busyAction === 'split' ? '처리 중...' : '✂ 교차 감지 → 분할'}
            </button>

            <span style={{ color: 'var(--text-disabled)' }}>|</span>

            <button
                onClick={handleStop}
                title="그리기 종료 (ESC)"
                style={{
                    padding: '4px 9px', background: 'rgba(var(--color-danger-rgb), 0.15)',
                    border: '1px solid rgba(var(--color-danger-rgb), 0.35)', borderRadius: 5,
                    color: 'var(--color-danger)', fontSize: 12, cursor: 'pointer',
                }}
            >
                ■ 종료
            </button>
        </div>
    );
};

export default NetworkDrawSettingsBar;
