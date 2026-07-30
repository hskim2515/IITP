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

/**
 * 버튼 아래에 고정 위치로 뜨는 드롭다운 패널 — 버전 전환/⋯ 메뉴가 공유하는 뼈대(백드롭
 * +포탈+위치계산)만 여기 두고, 내용은 children으로 받는다. 예전엔 각 드롭다운이 이 보일러
 * 플레이트를 통째로 복붙해 들고 있어서 코드도 늘어지고, 스타일이 하나씩 미묘하게 어긋나기
 * 쉬웠다. anchorRef 버튼의 화면 좌표를 기준으로 뜨므로 부모가 overflow:hidden이어도 잘리지
 * 않는다(document.body 포탈).
 */
function HeaderDropdown({
    anchorRef, open, onClose, align = 'left', children,
}: {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onClose: () => void;
    align?: 'left' | 'right';
    children: React.ReactNode;
}) {
    const [rect, setRect] = useState<{ top: number; left?: number; right?: number } | null>(null);

    useEffect(() => {
        if (!open || !anchorRef.current) { setRect(null); return; }
        const r = anchorRef.current.getBoundingClientRect();
        setRect(align === 'right'
            ? { top: r.bottom + 4, right: window.innerWidth - r.right }
            : { top: r.bottom + 4, left: r.left });
    }, [open, anchorRef, align]);

    if (!open || !rect) return null;
    return createPortal(
        <>
            <div style={ddBackdropStyle} onClick={onClose} />
            <div style={{ ...ddPanelStyle, top: rect.top, left: rect.left, right: rect.right }}>
                {children}
            </div>
        </>,
        document.body,
    );
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
    // ⚠️ 예전엔 이 버튼들이 헤더 hover 시에만 나열되는 영역(.hoverReveal) 안에 있었는데,
    // (1) 펼쳐지는 도중 정확히 그 위치로 마우스를 옮겨 눌러야 해서 클릭하기 어려웠고
    // (2) 버튼끼리 성격 구분도 없었다(사용자 지적). 그래서 hover-reveal을 완전히 없애고:
    // 버전(상태 정보 겸 전환 버튼)은 상시 노출, 나머지 부차 동작(새 버전으로/데이터 초기화)은
    // 클릭으로 여는 "⋯" 메뉴로 모아 명확히 구분한다.
    const [versionSwitcherOpen, setVersionSwitcherOpen] = useState(false);
    const versionButtonRef = useRef<HTMLButtonElement>(null);
    const [versionList, setVersionList] = useState<ScenarioVersions[]>([]);
    const [versionListLoading, setVersionListLoading] = useState(false);
    const [resettingData, setResettingData] = useState(false);

    // "⋯" 더보기 메뉴 — 새 버전으로 분기 / 모든 데이터 초기화 (가끔 쓰는 부차 동작)
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    const openVersionSwitcher = () => {
        setVersionSwitcherOpen((v) => !v);
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
            {/* 헤더 전체 폭 기준 절대 중앙 고정 — 사용자 요청으로 위치 고정을 최우선으로 한다
                (nav/headerRight 사이 여유 공간 기준 재중앙 정렬은 시도했으나, 버튼 그룹 폭에 따라
                중심점 자체가 움직여 "위치가 옮겨진다"는 문제로 되돌림). App.css/.timeline-container,
                아래 headerRight의 z-index 주석 참고. */}
            <TimelineTrack/>
            {/* 우측 컨트롤을 3개 그룹으로 나누고 사이에 얇은 구분선을 둔다 — 예전엔 7개
                컨트롤이 구분 없이 쭉 나열돼 있었다(사용자 지적: "구분이 없어 보기 안좋음").
                [편집 상태: 모드전환/준비상태/미저장배지] | [버전 관리: 버전전환/⋯메뉴] |
                [화면 전환: 대시보드/시뮬레이션 컨트롤]. */}
            <div className={styles['headerRight']}>
                {!dashboardMode && (
                    <div style={groupStyle}>
                        {/* 모드 전환은 자주 쓰는 핵심 동작이라 항상 노출(hover 뒤에 숨기면 또
                            "어디 있는지 못 찾겠다"는 문제로 되돌아간다). */}
                        <button
                            onClick={handleToggleMode}
                            title={appMode === 'edit' ? '편집 모드 (클릭 시 보기 모드)' : '보기 모드 (클릭 시 편집 모드)'}
                            style={appMode === 'edit' ? pillBtnActiveStyle : pillBtnStyle}
                        >
                            {appMode === 'edit' ? '● 편집' : '보기'}
                        </button>
                        {/* 알림성 배지(NextSim 준비 상태/미저장 편집 경고)는 사용자가 보지 않아도
                            눈치채야 하는 정보라 숨기지 않고 항상 노출한다. */}
                        <NextSimReadinessBadge/>
                        {netChanged && (
                            <span title="저장되지 않은 네트워크 편집이 있습니다. 데이터 입출력 → 저장" style={unsavedBadgeStyle}>
                                ● 미저장 편집
                            </span>
                        )}
                    </div>
                )}

                {!dashboardMode && selectedScenarioVersion && <div style={dividerStyle} />}

                {!dashboardMode && selectedScenarioVersion && (
                    <div style={groupStyle}>
                        {/* 현재 버전은 항상 있는 게 유용한 상태 정보라 상시 노출 + 클릭으로 즉시 전환. */}
                        {selectedScenario && (
                            <div style={{ position: 'relative' }}>
                                <button
                                    ref={versionButtonRef}
                                    onClick={openVersionSwitcher}
                                    title="같은 시나리오의 다른 버전으로 전환"
                                    style={versionSwitcherOpen ? pillBtnActiveNeutralStyle : pillBtnStyle}
                                >
                                    버전: {selectedScenarioVersion.label} ▾
                                </button>
                                <HeaderDropdown anchorRef={versionButtonRef} open={versionSwitcherOpen} onClose={() => setVersionSwitcherOpen(false)}>
                                    <div style={{ minWidth: 180, maxHeight: 280, overflowY: 'auto' }}>
                                        {versionListLoading && <div style={ddHintStyle}>불러오는 중...</div>}
                                        {!versionListLoading && versionList.length === 0 && <div style={ddHintStyle}>버전 없음</div>}
                                        {!versionListLoading && versionList.map((v) => (
                                            <button
                                                key={v.key}
                                                onClick={() => handleSwitchVersion(v)}
                                                style={{
                                                    ...ddItemStyle,
                                                    background: v.key === selectedScenarioVersion.key ? 'rgba(85,136,238,0.18)' : 'transparent',
                                                    color: v.key === selectedScenarioVersion.key ? '#7aa2ff' : '#ccc',
                                                    fontWeight: v.key === selectedScenarioVersion.key ? 700 : 400,
                                                }}
                                            >
                                                {v.key === selectedScenarioVersion.key ? '✓ ' : ''}{v.label}
                                            </button>
                                        ))}
                                    </div>
                                </HeaderDropdown>
                            </div>
                        )}
                        {/* "새 버전으로"/"데이터 초기화"는 가끔 쓰는 부차 동작이라 "⋯" 메뉴로 묶는다 —
                            위험한 동작(초기화)은 구분선 아래 빨간색으로 시각적으로 분리된다. */}
                        <div style={{ position: 'relative' }}>
                            <button
                                ref={moreButtonRef}
                                onClick={() => setMoreMenuOpen((v) => !v)}
                                title="버전 관리 (새 버전으로 분기 / 데이터 초기화)"
                                style={moreMenuOpen ? { ...pillBtnActiveNeutralStyle, padding: '4px 9px' } : { ...pillBtnStyle, padding: '4px 9px' }}
                            >
                                ⋯
                            </button>
                            <HeaderDropdown anchorRef={moreButtonRef} open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} align="right">
                                <div style={{ minWidth: 200 }}>
                                    <button
                                        onClick={() => { setMoreMenuOpen(false); setVersionModalPurpose('branch'); setVersionModalOpen(true); }}
                                        title="지금 버전 전체(네트워크/신호/OD/승객/시나리오)를 복제해 새 버전으로 분기"
                                        style={ddItemStyle}
                                    >
                                        새 버전으로 분기
                                    </button>
                                    <div style={ddDividerStyle} />
                                    <button
                                        onClick={() => { setMoreMenuOpen(false); void handleResetAllData(); }}
                                        disabled={resettingData}
                                        title="이 버전의 모든 데이터(도로/신호/OD/승객/차량 시뮬레이션)를 삭제하고 빈 상태로 시작 (버전은 유지)"
                                        style={{
                                            ...ddItemStyle, color: '#f07070', fontWeight: 600,
                                            cursor: resettingData ? 'default' : 'pointer', opacity: resettingData ? 0.6 : 1,
                                        }}
                                    >
                                        {resettingData ? '초기화 중...' : '모든 데이터 초기화'}
                                    </button>
                                </div>
                            </HeaderDropdown>
                        </div>
                    </div>
                )}

                <div style={dividerStyle} />

                <div style={groupStyle}>
                    <button
                        className={isDashboardOpen ? styles['dashboardBtnActive'] : styles['dashboardBtn']}
                        onClick={onDashboard}
                        title="대시보드"
                    >
                        대시보드
                    </button>
                    <SimulationControls/>
                </div>
            </div>
        </header>
        </>
    );
};

// ── 우측 헤더 그룹 공용 스타일 ──────────────────────────────────
const groupStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
};
const dividerStyle: React.CSSProperties = {
    width: 1, alignSelf: 'stretch', margin: '0 2px',
    background: 'rgba(255,255,255,0.1)',
};
const pillBtnStyle: React.CSSProperties = {
    padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid #888', background: 'transparent',
    color: '#ccc', fontWeight: 600, fontSize: 13, flexShrink: 0,
};
const pillBtnActiveStyle: React.CSSProperties = {
    ...pillBtnStyle,
    border: '1px solid #ff8c1a', background: '#ff8c1a', color: '#fff',
};
const pillBtnActiveNeutralStyle: React.CSSProperties = {
    ...pillBtnStyle,
    background: 'rgba(255,255,255,0.08)',
};
const unsavedBadgeStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 4,
    background: 'rgba(255,140,26,0.15)', border: '1px solid #ff8c1a',
    color: '#ff8c1a', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
};

// ── HeaderDropdown 공용 스타일 ──────────────────────────────────
const ddBackdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2900,
};
const ddPanelStyle: React.CSSProperties = {
    position: 'fixed', zIndex: 2901,
    background: 'rgba(20,22,36,0.98)', border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: 4,
};
const ddItemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '8px 10px', borderRadius: 5, fontSize: 12,
    border: 'none', cursor: 'pointer', background: 'transparent', color: '#ccc',
};
const ddHintStyle: React.CSSProperties = {
    padding: '8px 10px', fontSize: 12, color: '#888',
};
const ddDividerStyle: React.CSSProperties = {
    height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 2px',
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
