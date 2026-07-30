import React, { useEffect, useRef, useState } from 'react';
import './App.css'
import Header from "./component/header/Header";
import LeftPanel from "./component/panel/LeftPanel";
import { useScenarioStore } from "@stores/useScenarioStore";
import PropertyModal from "@component/modal/PropertyModal";
import PropertyPanel from "@component/panel/PropertyPanel";
import { isDescendantOf, useMenuStore } from "@stores/useMenuStore";
import { usePropertyStore } from "@stores/usePropertyStore";
import { MessagePopup } from "@component/message/MessagePopup";
import { getActiveVersionId } from "@utils/versionId";
import { useSchemaStore } from "@stores/useSchemaStore";
import SchemaSetting from "@component/schema/SchemaSetting";
import ScenarioSelector from "@component/scenario/ScenarioSelector";
import PropertyForm from "@component/popup/PropertyPopup";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import Maps from "@component/map/Maps";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import OdMatrixModal from "@component/modal/OdMatrixModal";
import PassengerModal from "@component/modal/PassengerModal";
import Taskbar from "@component/panel/Taskbar";
import DashboardLeft from "@component/panel/DashboardLeft";
import DashboardRight from "@component/panel/DashboardRight";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useOnboardingStore } from "@stores/useOnboardingStore";
import { useLogStore } from "@stores/useLogStore";
import FileImportModal from "@component/modal/FileImportModal";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { runAutoDummyGeneration } from "@utils/dummyGeneration";
import { useNextSimRunStore, checkNextSimAvailable, startNextSimRun, cancelNextSimRun, resumeNextSimPollingIfRunning, formatElapsed } from "@utils/nextsim";
import { consumePendingScenario } from "@utils/scenarioBootstrap";
import { useModeStore } from "@stores/useModeStore";

function OnboardingGuide({ onOpenImport }: { onOpenImport: () => void }) {
    const step = useOnboardingStore((s) => s.step);
    const setStep = useOnboardingStore((s) => s.setStep);
    const missingSignal = useOnboardingStore((s) => s.missingSignal);
    const missingVehicle = useOnboardingStore((s) => s.missingVehicle);
    const scenarioKey = getActiveVersionId() ?? '';
    // KTDB 가져오기 백그라운드 스캐폴딩(백엔드가 signal.xml/OD를 직접 재생성 중)과 겹치면
    // 안 됨 — 이 온보딩 배너는 가져오기 직후 바로 뜨는 화면이라 특히 이 레이스에 취약하다.
    const ktdbScaffolding = useBackgroundTaskStore((s) => !!s.tasks['ktdb-scaffold']);
    const dummyGenerating = useBackgroundTaskStore((s) => !!s.tasks['dummy-gen']);
    const [signalDone, setSignalDone] = useState(false);
    // NextSim 실행 상태 — 전역 스토어(utils/nextsim): 모달이 닫혔다 열려도/재접속해도 유지
    const nextsimAvailable = useNextSimRunStore((s) => s.available);
    const nextsimRunningId = useNextSimRunStore((s) => s.runningVersionId);
    const nextsimRunning = nextsimRunningId === scenarioKey;
    const nextsimChecking = useNextSimRunStore((s) => s.checking);
    const nextsimStage = useNextSimRunStore((s) => s.stage);
    const nextsimElapsed = useNextSimRunStore((s) => s.elapsedSeconds);
    const nextsimBeat = useNextSimRunStore((s) => s.sinceOutputSeconds);
    const nextsimError = useNextSimRunStore((s) => s.lastError);

    // 러너 설정 여부 1회 확인 (미설정 서버에선 버튼 숨김)
    useEffect(() => {
        if (step === 'need-simulation') void checkNextSimAvailable();
    }, [step]);

    // 신호 데이터가 없다고 뜨면(missingSignal) 버튼을 눌러달라고 요구하지 않고 필요한 시점에
    // 자동으로 생성한다 — KTDB 배경 스캐폴딩이 아직 돌고 있으면(ktdbScaffolding) 그쪽이 곧
    // 진짜 신호를 만들어줄 것이므로 여기서 끼어들지 않고 기다린다.
    useEffect(() => {
        if (step !== 'need-simulation' || !missingSignal || signalDone || ktdbScaffolding || dummyGenerating) return;
        let cancelled = false;
        void runAutoDummyGeneration().then(() => {
            if (cancelled) return;
            setSignalDone(true);
            if (step === 'need-simulation' && !missingVehicle) setStep('idle');
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, missingSignal, ktdbScaffolding, dummyGenerating]);

    // NextSim이 이 배너가 떠 있는 동안 성공적으로 완료되면(러닝→비러닝 하강 엣지, 에러 없음)
    // 차량 요구사항이 충족된 것 — 신호 요구사항도 충족됐다면 배너를 자동으로 닫는다.
    // (차량 더미 생성 버튼이 있던 시절엔 그 생성 완료 콜백이 이 역할을 했음 — NextSim 경로로 대체)
    const prevNextsimRunningRef = useRef(false);
    useEffect(() => {
        const justFinished = prevNextsimRunningRef.current && !nextsimRunning;
        prevNextsimRunningRef.current = nextsimRunning;
        if (justFinished && !nextsimError && step === 'need-simulation' && (!missingSignal || signalDone)) {
            setStep('idle');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextsimRunning]);

    if (step === 'idle') return null;

    const handleDismiss = () => setStep('idle');

    /** NextSim 시뮬레이터 실행 — 완료되면 vehicle_sim.db 갱신 → 기존 차량 파이프라인이 소비.
     *  폴링/취소/재개는 utils/nextsim 전역 스토어가 담당 (모달 생명주기와 무관). */
    const handleRunNextSim = () => { void startNextSimRun(scenarioKey); };
    const handleCancelNextSim = () => { void cancelNextSimRun(scenarioKey); };

    return (
        <div style={obOverlayStyle}>
            <div style={obPanelStyle}>
                {step === 'need-network' && (
                    <>
                        <div style={obTitleStyle}>네트워크 데이터 없음</div>
                        <p style={obDescStyle}>
                            이 버전에는 아직 도로 네트워크 데이터가 없습니다.<br />
                            OSM, KTDB 또는 XML 파일로 네트워크를 가져오세요.<br />
                            신호/노면표시 더미는 네트워크가 준비되면 자동으로 생성됩니다.
                        </p>
                        <div style={obFooterStyle}>
                            <button style={obDismissBtn} onClick={handleDismiss}>나중에</button>
                            <button style={obPrimaryBtn} onClick={() => { handleDismiss(); onOpenImport(); }}>가져오기</button>
                        </div>
                    </>
                )}

                {step === 'need-simulation' && (
                    <>
                        <div style={obTitleStyle}>시뮬레이션 데이터 없음</div>
                        <p style={obDescStyle}>
                            {missingSignal && missingVehicle
                                ? <>차량 시뮬레이션과 신호 데이터가 없습니다.</>
                                : missingSignal
                                ? <>신호 데이터가 없습니다.</>
                                : <>차량 시뮬레이션 데이터가 없습니다.</>
                            }<br />
                            {missingSignal && <>신호 데이터는 자동으로 생성됩니다.<br /></>}
                            차량 시뮬레이션은 아래에서 준비하거나 <span style={obHighlight}>가져오기</span>로 추가하세요.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                            {missingSignal && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
                                    <span style={{ fontSize: 12, color: '#ccc' }}>🚦 신호 데이터</span>
                                    <span style={{ fontSize: 11, color: signalDone ? '#4ecb8d' : '#888' }}>
                                        {signalDone ? '생성 완료 ✓' : (ktdbScaffolding || dummyGenerating) ? '자동 생성 중...' : '대기 중...'}
                                    </span>
                                </div>
                            )}
                            {missingVehicle && nextsimAvailable === true && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 12, color: '#ccc' }}>🚗 차량 시뮬레이션</span>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                        {!nextsimRunning && (
                                            <button
                                                style={{ ...obPrimaryBtn, fontSize: 11 }}
                                                onClick={handleRunNextSim}
                                                disabled={nextsimChecking}
                                                title={nextsimChecking ? '실행 상태 확인 중...' : 'NextSim 시뮬레이터로 실제 교통 시뮬레이션을 실행합니다 (OD 매트릭스 필요)'}
                                            >
                                                NextSim 실행
                                            </button>
                                        )}
                                        {nextsimRunning && (
                                            <>
                                                <button style={{ ...obPrimaryBtn, opacity: 0.6, fontSize: 11 }} disabled>
                                                    시뮬 실행 중...
                                                </button>
                                                <button
                                                    style={{ ...obDismissBtn, fontSize: 11 }}
                                                    onClick={handleCancelNextSim}
                                                    title="진행 중인 시뮬레이션을 중단합니다"
                                                >
                                                    취소
                                                </button>
                                            </>
                                        )}
                                        </div>
                                    </div>
                                    {nextsimRunning && (
                                        <span style={{ fontSize: 10, color: '#7da7d9' }}>
                                            {nextsimStage || '준비 중...'} — {formatElapsed(nextsimElapsed)} 경과
                                            {nextsimBeat > 10 ? ` · 마지막 출력 ${nextsimBeat}초 전 (연산 중)` : ''}
                                        </span>
                                    )}
                                    {!nextsimRunning && nextsimError && (
                                        <div style={{
                                            fontSize: 10, color: '#e07777', whiteSpace: 'pre-wrap',
                                            maxHeight: 96, overflowY: 'auto', lineHeight: 1.5,
                                            background: 'rgba(224,119,119,0.08)', borderRadius: 4, padding: '4px 6px',
                                        }}>
                                            NextSim {nextsimError}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={{ ...obFooterStyle, marginTop: 8 }}>
                            <button style={obDismissBtn} onClick={handleDismiss}>나중에</button>
                            <button style={obPrimaryBtn} onClick={() => { handleDismiss(); onOpenImport(); }}>가져오기</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const obOverlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1500,
};
const obPanelStyle: React.CSSProperties = {
    background: 'rgba(14,16,28,0.98)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
    width: 420, maxWidth: '90vw',
    padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16,
};
const obTitleStyle: React.CSSProperties = {
    fontSize: 14, fontWeight: 600, color: '#e0e0e0',
};
const obDescStyle: React.CSSProperties = {
    fontSize: 12, color: '#888', margin: 0, lineHeight: 1.8,
};
const obHighlight: React.CSSProperties = {
    color: '#7aa2ff', fontWeight: 600,
};
const obFooterStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4,
};
const obDismissBtn: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#888', cursor: 'pointer',
};
const obPrimaryBtn: React.CSSProperties = {
    padding: '6px 18px', fontSize: 12, borderRadius: 5, fontWeight: 600,
    border: '1px solid rgba(85,136,238,0.5)', background: 'rgba(85,136,238,0.2)',
    color: '#7aa2ff', cursor: 'pointer',
};

function App() {

    const [showDashboard, setShowDashboard] = useState(false);
    const [showFileImport, setShowFileImport] = useState(false);

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((state) => state.selectedScenarioVersion);

    // 헤더의 "버전 변경"/"데이터 초기화"는 전역 store·레이어·타일 캐시 누적 때문에 안전하게
    // 되돌리려면 전체 리로드가 필요하다(goHome과 동일 이유) — 리로드 직전에 sessionStorage에
    // 잠깐 적어둔 목표 시나리오/버전을 여기서 소비해 홈 화면을 거치지 않고 바로 복원한다.
    useEffect(() => {
        if (selectedScenario) return;
        const pending = consumePendingScenario();
        if (pending) {
            useScenarioStore.getState().setScenario(pending.scenario);
            useScenarioStore.getState().setVersion(pending.version);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchSchema = useSchemaStore((state) => state.fetchSchema)

    const { sessions, activeMenuCode, minimizeSession, closeSession } = useWorkflowStore();

    const {
        menu,
        activeSubmenu,
        activeDropdownMenu,
        setActiveSubmenu,
        setActiveDropdownMenu,
    } = useMenuStore();

    const activeSession = sessions.find(s => s.menuCode === activeMenuCode && !s.isMinimized);

    // 편집 모드 진입 시 속성 선택 초기화 (PropertyModal이 편집 패널 뒤에 표시되지 않도록)
    useEffect(() => {
        if (activeSubmenu) {
            usePropertyStore.getState().setSelectedProps(null);
        }
    }, [activeSubmenu]);

    const appMode = useModeStore((s) => s.appMode);

    // 편집 모드 진입 시 헤더의 파일/기타 메뉴(HeaderMenu)는 통째로 숨겨지는데, 그 메뉴로
    // 열어뒀던 LeftPanel(activeDropdownMenu)이나 시설물 편집 그리드(activeSession/PropertyPanel
    // 등)는 별도 전역 상태(useMenuStore/useWorkflowStore)라 헤더가 숨겨져도 화면에 그대로
    // 남아 있었다(사용자 실측 지적: "안닫히고 그대로"). 헤더를 최소화하는 취지에 맞춰 이 화면도
    // 함께 정리한다 — 세션은 파괴하지 않고 최소화만 해 편집 중이던 내용은 보존한다.
    useEffect(() => {
        if (appMode === 'edit' && !showDashboard) {
            setActiveDropdownMenu(null);
            setActiveSubmenu(null);
            if (activeMenuCode) minimizeSession(activeMenuCode);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appMode, showDashboard]);

    useEffect(() => {
        fetchSchema()
    }, [fetchSchema]);

    // 재접속/리로드 복원: 서버에서 진행 중인 NextSim 실행이 있으면 폴링 재개
    // (시뮬은 서버 사이드라 탭을 닫아도 계속 돎 — 진행 표시와 완료 시 차량 로드를 이어붙임)
    useEffect(() => {
        const vid = selectedScenarioVersion?.key;
        if (vid) void resumeNextSimPollingIfRunning(String(vid));
    }, [selectedScenarioVersion?.key]);

    return (
        !selectedScenario ? (
            <ScenarioSelector/>
        ) : (
            <div>
                {selectedScenarioVersion && <OnboardingGuide onOpenImport={() => setShowFileImport(true)} />}
                {showFileImport && <FileImportModal onClose={() => setShowFileImport(false)} />}
                <Header onDashboard={() => setShowDashboard(prev => !prev)} isDashboardOpen={showDashboard} dashboardMode={showDashboard}/>
                <MessagePopup/>
                <PropertyModal/>
                <main
                    style={{
                        position: "fixed",
                        top: "44px",
                        left: "0",
                        right: "0",
                        bottom: "0",
                        display: "flex",
                        overflow: "hidden",
                    }}
                >
                    {!showDashboard && activeDropdownMenu && <LeftPanel/>}
                    {showDashboard && <DashboardLeft onClose={() => setShowDashboard(false)}/>}
                    <div
                        style={{
                            flex: "1 1 auto",
                            minWidth: "0",
                            overflow: "hidden",
                            position: "relative",
                        }}
                    >
                        <Maps
                            singleMapMode={showDashboard}
                        />

                        {!showDashboard && <Taskbar/>}

                        {/* KTDB/OSM/NETWORK 임포트는 FileImportModal(헤더 파일>가져오기)로 통합 —
                            구 메뉴 모달(KtdbImportModal 등)은 헤더가 FILE 메뉴 트리를 렌더하지 않아 도달 불가로 제거 */}
                        {!showDashboard && activeSession && activeSession.menuCode === 'OD_MATRIX' && (
                            <OdMatrixModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode === 'PASSENGER' && (
                            <PassengerModal/>
                        )}

                        {!showDashboard && activeSession && (
                            isDescendantOf(menu, 'SCHEMA_SETTING', activeSession.menuCode) ? (
                                <SchemaSetting/>
                            ) : activeSession.menuCode === 'VEHICLE_TYPE' ? (
                                <PropertyForm
                                    activePopupMenu={activeSession.menu}
                                    open={true}
                                    config={propertyFormSchema['VEHICLE_TYPE']}
                                    onClose={() => { closeSession('VEHICLE_TYPE'); setActiveSubmenu(null); }}
                                />
                            ) : activeSession.menuCode === 'VEHICLE_MODEL' ? (
                                <PropertyForm
                                    activePopupMenu={activeSession.menu}
                                    open={true}
                                    config={propertyFormSchema['VEHICLE_MODEL']}
                                    onClose={() => { closeSession('VEHICLE_MODEL'); setActiveSubmenu(null); }}
                                />
                            ) : menuCodeToStoreMap[activeSession.menuCode] ? (
                                <PropertyPanel
                                    activeSubmenu={activeSession.menu}
                                    onClose={() => minimizeSession(activeSession.menuCode)}
                                />
                            ) : null
                        )}

                    </div>
                    {showDashboard && <DashboardRight onClose={() => setShowDashboard(false)}/>}

                </main>
            </div>
        )
    )
}

export default App
