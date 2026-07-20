import React from 'react';
import SimulationControls from "./SimulationControls";
import HeaderMenu from "@component/header/HeaderMenu";
import TimelineTrack from "../util/TimelineTrack";
// import VehicleModelSelector from "@component/setting/VehicleModelSelector";
import { useModeStore } from "@stores/useModeStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import styles from '@css/Header.module.css'

interface Props {
    onDashboard: () => void;
    isDashboardOpen?: boolean;
    dashboardMode?: boolean;
}

const Header = ({ onDashboard, isDashboardOpen, dashboardMode }: Props) => {
    const appMode = useModeStore((s) => s.appMode);
    const toggleAppMode = useModeStore((s) => s.toggleAppMode);
    const netChanged = useNetworkStore((s: any) => s.isChanged);

    // 홈(시나리오 선택)으로 복귀 — 전역 store/레이어/타일 캐시가 세션에 누적되므로
    // 전체 리로드로 완전 초기화 (시나리오 선택은 미영속이라 리로드 = 선택 화면)
    const goHome = () => {
        if (netChanged && !window.confirm('저장되지 않은 네트워크 편집이 있습니다.\n홈으로 이동하면 편집 내용이 사라집니다. 계속할까요?')) {
            return;
        }
        window.location.href = '/';
    };

    return (
        <header className={styles['header']}>
            <button
                onClick={goHome}
                title="홈 (시나리오 선택)"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', marginRight: 10, borderRadius: 5, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
                    color: '#ccc', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', height: 26,
                }}
            >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                홈
            </button>
            {dashboardMode ? (
                <div className={styles['dashboardModeTag']}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    대시보드 모드
                </div>
            ) : (
                <HeaderMenu/>
            )}
            <TimelineTrack/>
            <div className={styles['headerRight']}>
                {/*<VehicleModelSelector />*/}
                {!dashboardMode && (
                    <button
                        onClick={toggleAppMode}
                        title={appMode === 'edit' ? '편집 모드 (클릭 시 보기 모드)' : '보기 모드 (클릭 시 편집 모드)'}
                        style={{
                            padding: '4px 12px', marginRight: 8, borderRadius: 4, cursor: 'pointer',
                            border: '1px solid ' + (appMode === 'edit' ? '#ff8c1a' : '#888'),
                            background: appMode === 'edit' ? '#ff8c1a' : 'transparent',
                            color: appMode === 'edit' ? '#fff' : '#ccc', fontWeight: 600, fontSize: 13,
                        }}
                    >
                        {appMode === 'edit' ? '● 편집' : '보기'}
                    </button>
                )}
                {!dashboardMode && netChanged && (
                    <span
                        title="저장되지 않은 네트워크 편집이 있습니다. 데이터 입출력 → 저장"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', marginRight: 8, borderRadius: 4,
                            background: 'rgba(255,140,26,0.15)', border: '1px solid #ff8c1a',
                            color: '#ff8c1a', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
                        }}
                    >
                        ● 미저장 편집
                    </span>
                )}
                <button
                    className={isDashboardOpen ? styles['dashboardBtnActive'] : styles['dashboardBtn']}
                    onClick={onDashboard}
                    title="대시보드"
                >
                    대시보드
                </button>
                <SimulationControls/>
            </div>
        </header>
    );
};

export default Header;
