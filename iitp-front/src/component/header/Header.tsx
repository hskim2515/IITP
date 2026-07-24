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
import { hasUnsavedLayerChanges, saveAllChangedLayers } from "@utils/networkSave";
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
    // SaveVersionModal은 두 가지 목적으로 재사용된다: 'branch'(새 버전으로 분기, 기존 동작) /
    // 'saveExit'(편집모드 이탈 전 저장 — 확인 후 버전을 만들며 그 버전에 저장하고 보기모드로 전환).
    const [versionModalPurpose, setVersionModalPurpose] = useState<'branch' | 'saveExit'>('branch');
    const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

    // 홈(시나리오 선택)으로 복귀 — 전역 store/레이어/타일 캐시가 세션에 누적되므로
    // 전체 리로드로 완전 초기화 (시나리오 선택은 미영속이라 리로드 = 선택 화면)
    const goHome = async () => {
        const notice = netChanged
            ? '홈으로 이동하면 현재 시나리오 편집 화면을 벗어나 시나리오 선택 화면으로 이동합니다.\n저장되지 않은 네트워크 편집 내용은 사라집니다. 계속할까요?'
            : '홈으로 이동하면 현재 시나리오 편집 화면을 벗어나 시나리오 선택 화면으로 이동합니다.\n계속할까요?';
        if (!(await showConfirm(notice))) return;
        window.location.href = '/';
    };

    // 편집 → 보기 전환 시, 저장 안 된 편집이 있으면 그냥 나가지 않고 먼저 물어본다
    // (예전엔 조용히 나가져서 "저장을 깜빡했다"는 문제로 이어졌음).
    const handleToggleMode = () => {
        if (appMode === 'edit' && hasUnsavedLayerChanges()) {
            setExitConfirmOpen(true);
            return;
        }
        toggleAppMode();
    };

    const handleSaveAndExit = () => {
        setExitConfirmOpen(false);
        setVersionModalPurpose('saveExit');
        setVersionModalOpen(true);
    };

    const handleExitWithoutSaving = () => {
        setExitConfirmOpen(false);
        toggleAppMode();
    };

    return (
        <>
        <SaveVersionModal
            open={versionModalOpen}
            onConfirm={async (versionKey) => {
                if (versionModalPurpose === 'saveExit') {
                    await saveAllChangedLayers(versionKey);
                    toggleAppMode();
                }
                setVersionModalOpen(false);
            }}
            onCancel={() => setVersionModalOpen(false)}
        />
        {exitConfirmOpen && (
            <div style={exitOverlayStyle} onClick={() => setExitConfirmOpen(false)}>
                <div style={exitPanelStyle} onClick={(e) => e.stopPropagation()}>
                    <p style={exitTextStyle}>저장하지 않은 편집 내용이 있습니다.{'\n'}편집 모드를 나가기 전에 저장하시겠습니까?</p>
                    <div style={exitFooterStyle}>
                        <button style={exitCancelBtnStyle} onClick={() => setExitConfirmOpen(false)}>취소</button>
                        <button style={exitDiscardBtnStyle} onClick={handleExitWithoutSaving}>저장 안 하고 나가기</button>
                        <button style={exitSaveBtnStyle} onClick={handleSaveAndExit}>저장하고 나가기</button>
                    </div>
                </div>
            </div>
        )}
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
                {/* 모드 전환은 자주 쓰는 핵심 동작이라 항상 노출(hover 뒤에 숨기면 또
                    "어디 있는지 못 찾겠다"는 문제로 되돌아간다) — headerRight 자체의
                    z-index로 타임트랙보다 항상 위에서 클릭되므로 더 이상 안 가려진다. */}
                {!dashboardMode && (
                    <button
                        onClick={handleToggleMode}
                        title={appMode === 'edit' ? '편집 모드 (클릭 시 보기 모드)' : '보기 모드 (클릭 시 편집 모드)'}
                        style={{
                            padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
                            border: '1px solid ' + (appMode === 'edit' ? '#ff8c1a' : '#888'),
                            background: appMode === 'edit' ? '#ff8c1a' : 'transparent',
                            color: appMode === 'edit' ? '#fff' : '#ccc', fontWeight: 600, fontSize: 13,
                        }}
                    >
                        {appMode === 'edit' ? '● 편집' : '보기'}
                    </button>
                )}
                {/* 알림성 배지(NextSim 준비 상태/미저장 편집 경고)는 사용자가 보지 않아도
                    눈치채야 하는 정보라 hover 뒤에 숨기지 않고 항상 노출한다. */}
                {!dashboardMode && <NextSimReadinessBadge/>}
                {!dashboardMode && netChanged && (
                    <span
                        title="저장되지 않은 네트워크 편집이 있습니다. 데이터 입출력 → 저장"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 4,
                            background: 'rgba(255,140,26,0.15)', border: '1px solid #ff8c1a',
                            color: '#ff8c1a', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
                        }}
                    >
                        ● 미저장 편집
                    </span>
                )}
                {/* "새 버전으로"는 가끔 쓰는 동작이라 평소엔 접어 헤더를 덜 복잡해 보이게 하고,
                    headerRight에 마우스를 올렸을 때만 펼친다. */}
                <div className={styles['hoverReveal']}>
                    {!dashboardMode && selectedScenarioVersion && (
                        <button
                            onClick={() => { setVersionModalPurpose('branch'); setVersionModalOpen(true); }}
                            title="지금 버전 전체(네트워크/신호/OD/승객/시나리오)를 복제해 새 버전으로 분기"
                            style={{
                                padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid #888', background: 'transparent',
                                color: '#ccc', fontWeight: 600, fontSize: 13, flexShrink: 0,
                            }}
                        >
                            새 버전으로
                        </button>
                    )}
                </div>
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

const exitOverlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
};
const exitPanelStyle: React.CSSProperties = {
    background: 'rgba(20,22,36,0.98)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    padding: '24px 28px',
    minWidth: 320, maxWidth: 440,
    display: 'flex', flexDirection: 'column', gap: 16,
};
const exitTextStyle: React.CSSProperties = {
    fontSize: 13, color: '#ddd', margin: 0,
    lineHeight: 1.7, whiteSpace: 'pre-wrap',
};
const exitFooterStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
};
const exitCancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#888', cursor: 'pointer',
};
const exitDiscardBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(220,60,60,0.35)', background: 'rgba(220,60,60,0.12)',
    color: '#f07070', cursor: 'pointer',
};
const exitSaveBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5, fontWeight: 600,
    border: '1px solid rgba(85,136,238,0.5)', background: 'rgba(85,136,238,0.2)',
    color: '#7aa2ff', cursor: 'pointer',
};

export default Header;
