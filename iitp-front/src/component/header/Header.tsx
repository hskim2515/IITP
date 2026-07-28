import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { reloadIntoScenario } from "@utils/scenarioBootstrap";
import { useMessageStore } from "@stores/useMessageStore";
import axiosInstance from "@api/axiosInstance";
import { ScenarioVersions } from "@type/Scenario";
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
    const selectedScenario = useScenarioStore((s) => s.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    // SaveVersionModal은 두 가지 목적으로 재사용된다: 'branch'(새 버전으로 분기, 기존 동작) /
    // 'saveExit'(편집모드 이탈 전 저장 — 확인 후 버전을 만들며 그 버전에 저장하고 보기모드로 전환).
    const [versionModalPurpose, setVersionModalPurpose] = useState<'branch' | 'saveExit'>('branch');
    const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

    // ── 버전 변경 드롭다운 — 같은 시나리오의 다른 버전으로 홈을 거치지 않고 즉시 전환 ──
    // ⚠️ 드롭다운 목록은 document.body에 포탈로 그린다 — 버튼의 부모인 .hoverReveal이 헤더
    // hover 시 폭만 넓어지는 애니메이션을 위해 overflow:hidden을 쓰는데, 그 자식으로 드롭다운을
    // 그리면 목록이 그 박스 높이에서 그대로 잘려 "스크롤해도 안 내려가는" 것처럼 보였다(실측
    // 보고 — overflowY:auto 자체는 정상, 조상의 overflow:hidden이 그 아래를 통째로 가린 것).
    const [versionSwitcherOpen, setVersionSwitcherOpen] = useState(false);
    const [versionButtonRect, setVersionButtonRect] = useState<{ top: number; left: number } | null>(null);
    const versionButtonRef = useRef<HTMLButtonElement>(null);
    const [versionList, setVersionList] = useState<ScenarioVersions[]>([]);
    const [versionListLoading, setVersionListLoading] = useState(false);
    const [resettingData, setResettingData] = useState(false);

    const openVersionSwitcher = () => {
        setVersionSwitcherOpen((v) => {
            const next = !v;
            if (next && versionButtonRef.current) {
                const r = versionButtonRef.current.getBoundingClientRect();
                setVersionButtonRect({ top: r.bottom + 4, left: r.left });
            }
            return next;
        });
        if (!selectedScenario || versionList.length > 0) return;
        setVersionListLoading(true);
        fetch(`${import.meta.env.VITE_API_URL}/scenario/${selectedScenario.id}/versions`)
            .then((r) => r.json())
            .then((data: ScenarioVersions[]) => setVersionList(data))
            .catch(() => useMessageStore.getState().setMessage({ type: 'error', text: '버전 목록 조회 실패' }))
            .finally(() => setVersionListLoading(false));
    };

    const handleSwitchVersion = async (version: ScenarioVersions) => {
        setVersionSwitcherOpen(false);
        if (!selectedScenario || version.key === selectedScenarioVersion?.key) return;
        const notice = netChanged
            ? `"${version.label}" 버전으로 전환합니다.\n저장되지 않은 네트워크 편집 내용은 사라집니다. 계속할까요?`
            : `"${version.label}" 버전으로 전환합니다. 계속할까요?`;
        if (!(await showConfirm(notice))) return;
        reloadIntoScenario(selectedScenario, version);
    };

    // "모든 데이터 초기화" — 버전(키)은 유지하고 그 버전에 딸린 네트워크/신호/OD/승객/차량시뮬 등
    // 모든 산출물만 서버에서 비운 뒤, 같은 시나리오/버전으로 다시 진입해 빈 상태로 시작한다.
    // 좌표/회전/축척 캘리브레이션도 함께 초기화된다 — 그 값은 지금 지워지는 network.xml에 대해
    // 계산된 결과라 데이터가 없어지면 의미가 없어지기 때문(백엔드 resetVersionData 참고).
    // 전역 store/레이어/타일 캐시가 세션에 누적되므로(goHome과 동일 이유) 리로드로 완전 초기화.
    const handleResetAllData = async () => {
        if (!selectedScenario || !selectedScenarioVersion) return;
        const notice = `"${selectedScenarioVersion.label}" 버전의 모든 데이터(도로/신호/OD/승객/차량 시뮬레이션 등)와 `
            + `좌표/회전/축척 캘리브레이션을 완전히 삭제합니다.\n`
            + `버전 자체는 유지되며 바로 다시 가져오기를 시작할 수 있습니다.\n`
            + `이 작업은 되돌릴 수 없습니다. 계속할까요?`;
        if (!(await showConfirm(notice))) return;
        setResettingData(true);
        try {
            await axiosInstance.post(`/scenario/version/${encodeURIComponent(selectedScenarioVersion.key)}/reset`);
            reloadIntoScenario(selectedScenario, selectedScenarioVersion);
        } catch (e) {
            useMessageStore.getState().setMessage({ type: 'error', text: `데이터 초기화 실패: ${e}` });
            setResettingData(false);
        }
    };

    // 홈(시나리오 선택)으로 복귀 — 전역 store/레이어/타일 캐시가 세션에 누적되므로
    // 전체 리로드로 완전 초기화 (시나리오 선택은 미영속이라 리로드 = 선택 화면)
    const goHome = async () => {
        const notice = netChanged
            ? '홈으로 이동할까요?\n저장되지 않은 네트워크 편집 내용은 사라집니다.'
            : '홈으로 이동할까요?';
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
                {/* "버전 변경"/"새 버전으로"/"데이터 초기화"는 가끔 쓰는 동작이라 평소엔 접어
                    헤더를 덜 복잡해 보이게 하고, headerRight에 마우스를 올렸을 때만 펼친다. */}
                <div className={styles['hoverReveal']} style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
                    {!dashboardMode && selectedScenario && selectedScenarioVersion && (
                        <div style={{ position: 'relative' }}>
                            <button
                                ref={versionButtonRef}
                                onClick={openVersionSwitcher}
                                title="같은 시나리오의 다른 버전으로 전환"
                                style={{
                                    padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
                                    border: '1px solid #888', background: versionSwitcherOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
                                    color: '#ccc', fontWeight: 600, fontSize: 13, flexShrink: 0,
                                }}
                            >
                                버전: {selectedScenarioVersion.label} ▾
                            </button>
                            {versionSwitcherOpen && versionButtonRect && createPortal(
                                <>
                                    <div style={{ position: 'fixed', inset: 0, zIndex: 2900 }} onClick={() => setVersionSwitcherOpen(false)} />
                                    <div style={{
                                        position: 'fixed', top: versionButtonRect.top, left: versionButtonRect.left, zIndex: 2901,
                                        background: 'rgba(20,22,36,0.98)', border: '1px solid rgba(255,255,255,0.14)',
                                        borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                                        minWidth: 180, maxHeight: 280, overflowY: 'auto', padding: 4,
                                    }}>
                                        {versionListLoading && (
                                            <div style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>불러오는 중...</div>
                                        )}
                                        {!versionListLoading && versionList.length === 0 && (
                                            <div style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>버전 없음</div>
                                        )}
                                        {!versionListLoading && versionList.map((v) => (
                                            <button
                                                key={v.key}
                                                onClick={() => handleSwitchVersion(v)}
                                                style={{
                                                    display: 'block', width: '100%', textAlign: 'left',
                                                    padding: '7px 10px', borderRadius: 5, fontSize: 12,
                                                    border: 'none', cursor: 'pointer',
                                                    background: v.key === selectedScenarioVersion.key ? 'rgba(85,136,238,0.18)' : 'transparent',
                                                    color: v.key === selectedScenarioVersion.key ? '#7aa2ff' : '#ccc',
                                                    fontWeight: v.key === selectedScenarioVersion.key ? 700 : 400,
                                                }}
                                            >
                                                {v.key === selectedScenarioVersion.key ? '✓ ' : ''}{v.label}
                                            </button>
                                        ))}
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>
                    )}
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
                    {!dashboardMode && selectedScenarioVersion && (
                        <button
                            onClick={handleResetAllData}
                            disabled={resettingData}
                            title="이 버전의 모든 데이터(도로/신호/OD/승객/차량 시뮬레이션)를 삭제하고 빈 상태로 시작 (버전은 유지)"
                            style={{
                                padding: '4px 12px', borderRadius: 4, cursor: resettingData ? 'default' : 'pointer',
                                border: '1px solid rgba(220,60,60,0.5)', background: 'rgba(220,60,60,0.1)',
                                color: '#f07070', fontWeight: 600, fontSize: 13, flexShrink: 0,
                                opacity: resettingData ? 0.6 : 1,
                            }}
                        >
                            {resettingData ? '초기화 중...' : '모든 데이터 초기화'}
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
