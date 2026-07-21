import React, { useState } from 'react';
import SimulationControls from "./SimulationControls";
import HeaderMenu from "@component/header/HeaderMenu";
import NextSimReadinessBadge from "@component/header/NextSimReadinessBadge";
import TimelineTrack from "../util/TimelineTrack";
// import VehicleModelSelector from "@component/setting/VehicleModelSelector";
import { useModeStore } from "@stores/useModeStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useScenarioStore } from "@stores/useScenarioStore";
import { showConfirm } from "@utils/dialog";
import SaveVersionModal from "@component/modal/SaveVersionModal";
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
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const [versionModalOpen, setVersionModalOpen] = useState(false);

    // 홈(시나리오 선택)으로 복귀 — 전역 store/레이어/타일 캐시가 세션에 누적되므로
    // 전체 리로드로 완전 초기화 (시나리오 선택은 미영속이라 리로드 = 선택 화면)
    const goHome = async () => {
        const notice = netChanged
            ? '홈으로 이동하면 현재 시나리오 편집 화면을 벗어나 시나리오 선택 화면으로 이동합니다.\n저장되지 않은 네트워크 편집 내용은 사라집니다. 계속할까요?'
            : '홈으로 이동하면 현재 시나리오 편집 화면을 벗어나 시나리오 선택 화면으로 이동합니다.\n계속할까요?';
        if (!(await showConfirm(notice))) return;
        window.location.href = '/';
    };

    return (
        <>
        <SaveVersionModal
            open={versionModalOpen}
            onConfirm={async () => setVersionModalOpen(false)}
            onCancel={() => setVersionModalOpen(false)}
        />
        <header className={styles['header']}>
            <nav className={styles['nav']}>
                <div className={styles['container']} onClick={goHome} title="홈 (시나리오 선택)">
                    <span className={styles['title']} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                            <polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                        홈
                    </span>
                </div>
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
            </nav>
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
                {!dashboardMode && <NextSimReadinessBadge/>}
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
                {!dashboardMode && selectedScenarioVersion && (
                    <button
                        onClick={() => setVersionModalOpen(true)}
                        title="지금 버전 전체(네트워크/신호/OD/승객/시나리오)를 복제해 새 버전으로 분기"
                        style={{
                            padding: '4px 12px', marginRight: 8, borderRadius: 4, cursor: 'pointer',
                            border: '1px solid #888', background: 'transparent',
                            color: '#ccc', fontWeight: 600, fontSize: 13,
                        }}
                    >
                        새 버전으로
                    </button>
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
        </>
    );
};

export default Header;
