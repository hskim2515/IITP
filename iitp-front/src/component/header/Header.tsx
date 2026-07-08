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
    return (
        <header className={styles['header']}>
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
