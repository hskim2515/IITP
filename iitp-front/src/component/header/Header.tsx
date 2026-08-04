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
import { useAppSettingsStore } from "@stores/useAppSettingsStore";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSun, faMoon } from '@fortawesome/free-solid-svg-icons';
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
    const theme = useAppSettingsStore((s) => s.theme);
    const toggleTheme = useAppSettingsStore((s) => s.toggleTheme);
    const netChanged = useNetworkStore((s: any) => s.isChanged);
    const selectedScenario = useScenarioStore((s) => s.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    // SaveVersionModal은 두 가지 목적으로 재사용된다: 'branch'(새 버전으로 분기, 기존 동작) /
    // 'saveExit'(편집모드 이탈 전 저장 — 확인 후 버전을 만들며 그 버전에 저장하고 보기모드로 전환).
    const [versionModalPurpose, setVersionModalPurpose] = useState<'branch' | 'saveExit'>('branch');
    const [savingAll, setSavingAll] = useState(false);
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

    // 편집 모드에서는 헤더의 다른 컨트롤을 전부 가리고 "보기 모드로 전환"/"저장" 버튼만
    // 남긴다(사용자 요청) — 편집 중엔 지도 위 도구(NetworkDrawSettingsBar 등)가 이미 화면
    // 상단을 쓰고 있어, 헤더의 다른 컨트롤(버전 전환/⋯메뉴/시뮬레이션 컨트롤 등)이 실질적으로
    // 편집과 무관한 데다 혼란만 준다는 판단. dashboardMode(대시보드 화면)와는 별개 개념이라
    // 그 조합까지 가리지는 않는다(대시보드는 이미 자체적으로 대부분의 헤더 컨트롤을 숨김).
    const editMinimal = appMode === 'edit' && !dashboardMode;

    // editMinimal 진입 시 헤더는 JSX에서 조건부로 안 그려질 뿐, 버전전환/⋯ 드롭다운을 열어
    // 두던 state(versionSwitcherOpen/moreMenuOpen)는 Header 자체가 언마운트되지 않아 그대로
    // true로 남는다 — 그 상태로 나중에 보기 모드로 돌아가면 두 드롭다운이 사용자가 다시 열지도
    // 않았는데 열려 있는 채로 나타난다. editMinimal이 될 때 명시적으로 닫아 비활성화한다.
    useEffect(() => {
        if (editMinimal) {
            setVersionSwitcherOpen(false);
            setMoreMenuOpen(false);
        }
    }, [editMinimal]);

    // 저장 — SaveVersionModal(항상 새 버전 분기)과 달리 지금 편집 중인 버전에 그대로
    // 저장한다(PropertyPanel.doSave의 "제자리 저장"과 동일한 원칙: OD매트릭스/승객처럼 새
    // 버전을 만들지 않음). saveAllChangedLayers가 실패 시 레이어별 에러 토스트를 이미
    // 띄우므로 여기서 추가로 알릴 필요는 없다.
    const handleSaveNow = async () => {
        if (!selectedScenarioVersion) return;
        if (!hasUnsavedLayerChanges()) {
            useMessageStore.getState().setMessage({ type: 'info', text: '저장할 변경사항이 없습니다.' });
            return;
        }
        setSavingAll(true);
        try {
            await saveAllChangedLayers(selectedScenarioVersion.key);
        } catch (_) {
            // 실패 토스트는 saveAllChangedLayers 내부(레이어별)에서 이미 표시됨
        } finally {
            setSavingAll(false);
        }
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
                {/* 편집 모드 진입 시에는 지도 위 편집 도구가 이미 화면을 쓰고 있어, 홈/파일메뉴/
                    대시보드 같은 탐색용 컨트롤이 혼란만 준다는 요청 — 모드전환/저장 버튼만 남기고
                    나머지 헤더 컨트롤은 전부 숨긴다(editMinimal). */}
                {!editMinimal && (
                    <>
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
                        {/* 홈/파일메뉴 옆으로 이동 — 화면 전환(대시보드↔맵) 동작이라 우측 시뮬레이션
                            컨트롤 그룹보다 좌측 nav(탐색용 컨트롤들) 쪽이 더 어울린다는 요청. */}
                        <button
                            className={isDashboardOpen ? styles['dashboardBtnActive'] : styles['dashboardBtn']}
                            onClick={onDashboard}
                            title="대시보드"
                        >
                            대시보드
                        </button>
                    </>
                )}
            </nav>
            {/* .header가 3열 그리드(1fr auto 1fr)라 이 자리는 항상 헤더 진짜 중앙에 고정되고,
                동시에 좌우 버튼 컬럼과 트랙 자체가 겹치지 않는다 — App.css/.timeline-container 참고.
                편집모드 최소화(editMinimal)에서는 타임트랙도 숨긴다(요청: 모드전환/저장 버튼만 남김). */}
            {!editMinimal && <TimelineTrack/>}
            {/* 우측 컨트롤을 그룹으로 나누고 사이에 얇은 구분선을 둔다 — 예전엔 여러 컨트롤이
                구분 없이 쭉 나열돼 있었다(사용자 지적: "구분이 없어 보기 안좋음").
                [편집 상태: 모드전환/준비상태/미저장배지] | [버전 관리: 버전전환/⋯메뉴] |
                [시뮬레이션 컨트롤]. 대시보드 버튼은 화면 탐색 동작이라 좌측 nav(홈/파일메뉴
                옆)로 옮겨졌다. */}
            <div className={styles['headerRight']}>
                {!dashboardMode && (
                    <div style={groupStyle}>
                        {/* 모드 전환은 자주 쓰는 핵심 동작이라 항상 노출(hover 뒤에 숨기면 또
                            "어디 있는지 못 찾겠다"는 문제로 되돌아간다). editMinimal에서도 이 버튼은
                            남겨둔다 — 보기 모드로 되돌아갈 유일한 경로이기 때문. */}
                        <button
                            onClick={handleToggleMode}
                            title={appMode === 'edit' ? '편집 모드 (클릭 시 보기 모드)' : '보기 모드 (클릭 시 편집 모드)'}
                            style={appMode === 'edit' ? pillBtnActiveStyle : pillBtnStyle}
                        >
                            {appMode === 'edit' ? '● 편집' : '보기'}
                        </button>
                        {editMinimal && (
                            <button
                                onClick={handleSaveNow}
                                disabled={savingAll}
                                title="지금 버전에 바로 저장 (새 버전을 만들지 않음)"
                                style={{ ...pillBtnActiveStyle, opacity: savingAll ? 0.6 : 1, cursor: savingAll ? 'default' : 'pointer' }}
                            >
                                {savingAll ? '저장 중...' : '저장'}
                            </button>
                        )}
                        {/* 알림성 배지(NextSim 준비 상태/미저장 편집 경고)는 사용자가 보지 않아도
                            눈치채야 하는 정보라 숨기지 않고 항상 노출한다(단, editMinimal에서는
                            헤더를 최소화하는 취지에 맞춰 함께 숨김). */}
                        {!editMinimal && <NextSimReadinessBadge/>}
                        {!editMinimal && netChanged && (
                            <span title="저장되지 않은 네트워크 편집이 있습니다. 데이터 입출력 → 저장" style={unsavedBadgeStyle}>
                                ● 미저장 편집
                            </span>
                        )}
                    </div>
                )}

                {!dashboardMode && !editMinimal && selectedScenarioVersion && <div style={dividerStyle} />}

                {!dashboardMode && !editMinimal && selectedScenarioVersion && (
                    <div style={groupStyle}>
                        {/* 현재 버전은 항상 있는 게 유용한 상태 정보라 상시 노출 + 클릭으로 즉시 전환. */}
                        {selectedScenario && (
                            <div style={{ position: 'relative' }}>
                                <button
                                    ref={versionButtonRef}
                                    onClick={openVersionSwitcher}
                                    title={`버전: ${selectedScenarioVersion.label} (클릭 시 다른 버전으로 전환)`}
                                    style={versionSwitcherOpen ? versionBtnActiveStyle : versionBtnStyle}
                                >
                                    <span style={versionLabelStyle}>{selectedScenarioVersion.label}</span> ▾
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
                                                    background: v.key === selectedScenarioVersion.key ? 'rgba(var(--accent-rgb), 0.18)' : 'transparent',
                                                    color: v.key === selectedScenarioVersion.key ? 'var(--accent-text)' : 'var(--text-secondary)',
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
                                            ...ddItemStyle, color: 'var(--color-danger)', fontWeight: 600,
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

                {!editMinimal && <div style={dividerStyle} />}

                {!editMinimal && (
                    <div style={groupStyle}>
                        <SimulationControls/>
                    </div>
                )}

                {/* 다크/라이트 테마 토글 — 화면 외관 취향이라 editMinimal(편집 최소화 모드)에서도
                 *  다른 버튼들과 달리 계속 노출한다(요청: 지도가 손 많이 감, 전체 범위 포함).
                 *  AppSettings.tsx의 라디오와 동일한 theme 필드를 공유한다. */}
                <div style={dividerStyle} />
                <div style={groupStyle}>
                    <button
                        title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
                        onClick={toggleTheme}
                        style={themeToggleBtnStyle}
                    >
                        <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} />
                    </button>
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
    background: 'rgba(var(--overlay-rgb), 0.1)',
};
const pillBtnStyle: React.CSSProperties = {
    padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--text-muted)', background: 'transparent',
    color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, flexShrink: 0,
};
const pillBtnActiveStyle: React.CSSProperties = {
    ...pillBtnStyle,
    border: '1px solid var(--color-warning)', background: 'var(--color-warning)', color: '#fff',
};
const pillBtnActiveNeutralStyle: React.CSSProperties = {
    ...pillBtnStyle,
    background: 'rgba(var(--overlay-rgb), 0.08)',
};
const themeToggleBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--text-muted)', background: 'transparent',
    color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0,
};
// 버전 버튼 전용 — "버전:" 접두어를 없애 글자수를 줄이고(title 속성에 전체 의미는 그대로
// 남김), label이 긴 시나리오에서도 버튼이 무한정 늘어나지 않도록 최대 폭 + 말줄임을 둔다.
const versionBtnStyle: React.CSSProperties = {
    ...pillBtnStyle,
    display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: 160,
};
const versionBtnActiveStyle: React.CSSProperties = {
    ...pillBtnActiveNeutralStyle,
    display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: 160,
};
const versionLabelStyle: React.CSSProperties = {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const unsavedBadgeStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 4,
    background: 'rgba(var(--color-warning-rgb), 0.15)', border: '1px solid var(--color-warning)',
    color: 'var(--color-warning)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
};

// ── HeaderDropdown 공용 스타일 ──────────────────────────────────
const ddBackdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2900,
};
const ddPanelStyle: React.CSSProperties = {
    position: 'fixed', zIndex: 2901,
    background: 'rgba(var(--surface-popover-rgb), 0.98)', border: '1px solid rgba(var(--overlay-rgb), 0.14)',
    borderRadius: 8, boxShadow: '0 12px 32px rgba(var(--surface-overlay-rgb), 0.6)', padding: 4,
};
const ddItemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '8px 10px', borderRadius: 5, fontSize: 12,
    border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
};
const ddHintStyle: React.CSSProperties = {
    padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)',
};
const ddDividerStyle: React.CSSProperties = {
    height: 1, background: 'rgba(var(--overlay-rgb), 0.1)', margin: '4px 2px',
};

const exitOverlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(var(--surface-overlay-rgb), 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
};
const exitPanelStyle: React.CSSProperties = {
    background: 'rgba(var(--surface-popover-rgb), 0.98)',
    border: '1px solid rgba(var(--overlay-rgb), 0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(var(--surface-overlay-rgb), 0.7)',
    padding: '24px 28px',
    minWidth: 320, maxWidth: 440,
    display: 'flex', flexDirection: 'column', gap: 16,
};
const exitTextStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--text-secondary)', margin: 0,
    lineHeight: 1.7, whiteSpace: 'pre-wrap',
};
const exitFooterStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
};
const exitCancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb), 0.12)', background: 'rgba(var(--overlay-rgb), 0.05)',
    color: 'var(--text-muted)', cursor: 'pointer',
};
const exitDiscardBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--color-danger-rgb), 0.35)', background: 'rgba(var(--color-danger-rgb), 0.12)',
    color: 'var(--color-danger)', cursor: 'pointer',
};
const exitSaveBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5, fontWeight: 600,
    border: '1px solid rgba(var(--accent-rgb), 0.5)', background: 'rgba(var(--accent-rgb), 0.2)',
    color: 'var(--accent-text)', cursor: 'pointer',
};

export default Header;
