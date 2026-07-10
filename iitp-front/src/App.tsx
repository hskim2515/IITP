import React, { useEffect, useState } from 'react';
import './App.css'
import { ScenarioVersions } from "@type/Scenario";
import Header from "./component/header/Header";
import LeftPanel from "./component/panel/LeftPanel";
import { useScenarioStore } from "@stores/useScenarioStore";
import PropertyModal from "@component/modal/PropertyModal";
import PropertyPanel from "@component/panel/PropertyPanel";
import { isDescendantOf, useMenuStore } from "@stores/useMenuStore";
import { usePropertyStore } from "@stores/usePropertyStore";
import { MessagePopup } from "@component/message/MessagePopup";
import PerformancePanel from "@component/util/PerformancePanel";
import { getActiveVersionId } from "@utils/versionId";
import { useSchemaStore } from "@stores/useSchemaStore";
import SchemaSetting from "@component/schema/SchemaSetting";
import ScenarioSelector from "@component/scenario/ScenarioSelector";
import PropertyForm from "@component/popup/PropertyPopup";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import Maps from "@component/map/Maps";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import OdMatrixModal from "@component/modal/OdMatrixModal";
import Taskbar from "@component/panel/Taskbar";
import DashboardLeft from "@component/panel/DashboardLeft";
import DashboardRight from "@component/panel/DashboardRight";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useOnboardingStore } from "@stores/useOnboardingStore";
import { useLogStore } from "@stores/useLogStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import FileImportModal from "@component/modal/FileImportModal";
import { useSignalStore } from "@stores/useSignalStore";
import { useNetworkStore } from "@stores/useNetworkStore";
import { assignPropertyToResponseData } from "@utils/guid";
import { generateDummySignals } from "@utils/signal";
import { generateDummyPavementMarkings } from "@utils/pavementMarking";
import { getNetworkForDummyGeneration } from "@utils/generationNetwork";
import { usePavementMarkingStore } from "@stores/usePavementMarkingStore";
import { autoSaveChangedLayers } from "@utils/autoSave";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";

function VersionPopup({ scenarioId, onSelect }: { scenarioId: number; onSelect: (v: ScenarioVersions) => void }) {
    const [versions, setVersions] = useState<ScenarioVersions[] | null>(null);

    useEffect(() => {
        fetch(import.meta.env.VITE_API_URL + `/scenario/${scenarioId}/versions`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        }).then((r) => r.json()).then((data: ScenarioVersions[]) => {
            // 버전이 1개이면 자동 선택 (팝업 표시 없이)
            if (data.length === 1) {
                onSelect(data[0]);
            } else {
                setVersions(data);
            }
        });
    }, [scenarioId]);

    // fetch 완료 전 또는 자동 선택 시 팝업 숨김
    if (!versions) return null;

    return (
        <div className="version-popup">
            <div className="version-popup-content">
                <h2>시나리오 버전을 선택하세요</h2>
                <select
                    defaultValue=""
                    onChange={(e) => {
                        const selected = versions.find((v) => v.key === e.target.value);
                        if (selected) onSelect(selected);
                    }}
                >
                    <option value="" disabled>버전을 선택하세요</option>
                    {versions.map((v) => (
                        <option key={v.key} value={v.key}>{v.label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}

function OnboardingGuide({ onOpenImport }: { onOpenImport: () => void }) {
    const step = useOnboardingStore((s) => s.step);
    const setStep = useOnboardingStore((s) => s.setStep);
    const missingSignal = useOnboardingStore((s) => s.missingSignal);
    const missingVehicle = useOnboardingStore((s) => s.missingVehicle);
    const scenarioKey = getActiveVersionId() ?? '';
    const [generatingVehicle, setGeneratingVehicle] = useState(false);
    const [signalDone, setSignalDone] = useState(false);
    const [vehicleDone, setVehicleDone] = useState(false);

    if (step === 'idle') return null;

    const handleDismiss = () => setStep('idle');

    const handleGeneratePavementMarking = async () => {
        const network = await getNetworkForDummyGeneration();
        if (!network?.nodes?.length) {
            useLogStore.getState().addLog('warn', '네트워크 데이터가 없어 노면 표시 더미를 생성할 수 없습니다.');
            return;
        }
        const pavementMarkings = generateDummyPavementMarkings(network);
        if (pavementMarkings.length === 0) {
            useLogStore.getState().addLog('warn', 'intersection 노드가 없어 노면 표시 더미를 생성할 수 없습니다.');
            return;
        }
        const pavementMarkingData = { pavementMarkings };
        assignPropertyToResponseData(pavementMarkingData);
        usePavementMarkingStore.getState().setCurrentJsonData(pavementMarkingData);
        usePavementMarkingStore.getState().setChange(true);
        const versionKey = getActiveVersionId();
        if (versionKey) await autoSaveChangedLayers(versionKey);
        useLogStore.getState().addLog('info', `노면 표시 더미 생성 완료 (${pavementMarkings.length}개)`);
    };

    const handleGenerateDummy = async () => {
        setGeneratingVehicle(true);
        await handleGenerateSignal();
        await handleGeneratePavementMarking();
        handleGenerateVehicle();
    };

    const handleGenerateVehicle = () => {
        const signalData = useSignalStore.getState().currentJsonData as any;
        const hasSignal = Array.isArray(signalData?.signals) && signalData.signals.length > 0;
        setGeneratingVehicle(true);
        useLogStore.getState().addLog('info', hasSignal
            ? '더미 차량 시뮬레이션 데이터 생성 시작...'
            : '더미 차량 시뮬레이션 데이터 생성 시작 (신호 데이터 없음 — 신호 패턴 자동 추정)...'
        );

        const setVehicleTask = (label: string | null) =>
            useBackgroundTaskStore.getState().setTask('vehicle-route', label);

        const poll = (retryCount: number) => {
            fetch(
                `${import.meta.env.VITE_API_URL}/vehicle/vehicle-route/${scenarioKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numVehicle: 0, regenerate: retryCount === 0, generateDummy: true }) }
            )
            .then((res) => {
                if (res.status === 202) {
                    return res.json().then((body: any) => {
                        const stage = body?.stage ?? '처리 중...';
                        const elapsed = body?.elapsed ?? 0;
                        useLogStore.getState().addLog('info', `[차량 경로 생성 중] ${stage} (${elapsed}초 경과)`);
                        setVehicleTask(`차량 경로 생성 중 — ${stage} (${elapsed}초)`);
                        if (retryCount < 120) {
                            const delay = retryCount < 10 ? 3000 : 5000;
                            setTimeout(() => poll(retryCount + 1), delay);
                        } else {
                            useLogStore.getState().addLog('warn', '더미 차량 데이터 생성 대기 시간 초과');
                            setVehicleTask(null);
                            setGeneratingVehicle(false);
                        }
                    });
                } else if (res.ok) {
                    useLogStore.getState().addLog('info', '더미 차량 데이터 생성 완료 — 시뮬레이션 재생을 시작합니다...');
                    setVehicleTask(null);
                    setVehicleDone(true);
                    setGeneratingVehicle(false);
                    useVehicleStore.getState().triggerRefetch();
                    // need-dummy: 즉시 닫기 / need-simulation: 필요한 항목 모두 완료 시 닫기
                    if (step === 'need-dummy') {
                        setStep('idle');
                    } else if (step === 'need-simulation') {
                        const allDone = (!missingSignal || signalDone) && true; // vehicleDone just set
                        if (allDone) setStep('idle');
                    }
                } else {
                    res.json().catch(() => ({})).then((body: any) => {
                        const msg = body?.error ?? `서버 오류 (${res.status})`;
                        useLogStore.getState().addLog('error', `더미 차량 데이터 생성 실패: ${msg}`);
                        setVehicleTask(null);
                        setGeneratingVehicle(false);
                    });
                }
            })
            .catch(() => {
                useLogStore.getState().addLog('error', '더미 차량 데이터 생성 중 오류 발생');
                setVehicleTask(null);
                setGeneratingVehicle(false);
            });
        };

        poll(0);
    };

    const handleGenerateSignal = async () => {
        const network = await getNetworkForDummyGeneration();
        if (!network?.nodes?.length) {
            useLogStore.getState().addLog('warn', '네트워크 데이터가 없어 신호 더미를 생성할 수 없습니다.');
            return;
        }
        const signals = generateDummySignals(network);
        if (signals.length === 0) {
            useLogStore.getState().addLog('warn', 'intersection 노드가 없어 신호 더미를 생성할 수 없습니다.');
            return;
        }
        const signalData = { signals };
        assignPropertyToResponseData(signalData);
        useSignalStore.getState().setCurrentJsonData(signalData);
        useSignalStore.getState().setChange(true);

        // 자동 저장
        const versionKey = getActiveVersionId();
        if (versionKey) {
            await autoSaveChangedLayers(versionKey);
            useLogStore.getState().addLog('info', `신호 더미 생성 완료 (${signals.length}개)`);
        } else {
            useLogStore.getState().addLog('info', `신호 더미 생성 완료 (${signals.length}개) — 버전 미선택, DataIOPanel에서 저장 필요`);
        }
        setSignalDone(true);
    };

    const isWizard = step === 'need-network' || step === 'need-dummy';

    return (
        <div style={obOverlayStyle}>
            <div style={obPanelStyle}>
                {/* 네트워크 임포트 마법사 단계 표시 */}
                {isWizard && (
                    <div style={obStepRowStyle}>
                        <StepDot active={step === 'need-network'} done={step === 'need-dummy'} label="1" />
                        <div style={obStepLineStyle} />
                        <StepDot active={step === 'need-dummy'} done={false} label="2" />
                    </div>
                )}

                {step === 'need-network' && (
                    <>
                        <div style={obTitleStyle}>네트워크 데이터 없음</div>
                        <p style={obDescStyle}>
                            이 버전에는 아직 도로 네트워크 데이터가 없습니다.<br />
                            OSM, KTDB 또는 XML 파일로 네트워크를 가져오세요.
                        </p>
                        <div style={obFooterStyle}>
                            <button style={obDismissBtn} onClick={handleDismiss}>나중에</button>
                            <button style={obPrimaryBtn} onClick={() => { handleDismiss(); onOpenImport(); }}>가져오기</button>
                        </div>
                    </>
                )}

                {step === 'need-dummy' && (
                    <>
                        <div style={obTitleStyle}>시뮬레이션 더미 데이터 생성</div>
                        <p style={obDescStyle}>
                            네트워크 반영이 완료됐습니다.<br />
                            신호 더미 생성 후 차량 시뮬레이션 데이터를 순서대로 만들어<br />
                            시뮬레이션 재생을 미리 확인할 수 있습니다.
                        </p>
                        <div style={obFooterStyle}>
                            <button style={obDismissBtn} onClick={handleDismiss} disabled={generatingVehicle}>건너뛰기</button>
                            <button
                                style={generatingVehicle ? { ...obPrimaryBtn, opacity: 0.6 } : obPrimaryBtn}
                                onClick={handleGenerateDummy}
                                disabled={generatingVehicle}
                            >
                                {generatingVehicle ? '생성 중...' : '더미 데이터 생성'}
                            </button>
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
                            더미 데이터를 생성하거나 <span style={obHighlight}>가져오기</span>로 추가하세요.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                            {missingSignal && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
                                    <span style={{ fontSize: 12, color: '#ccc' }}>🚦 신호 데이터</span>
                                    <button
                                        style={signalDone ? { ...obPrimaryBtn, fontSize: 11, background: 'rgba(78,203,141,0.15)', borderColor: 'rgba(78,203,141,0.4)', color: '#4ecb8d' } : { ...obPrimaryBtn, fontSize: 11 }}
                                        onClick={handleGenerateSignal}
                                        disabled={signalDone}
                                    >
                                        {signalDone ? '생성 완료 ✓' : '더미 생성'}
                                    </button>
                                </div>
                            )}
                            {missingVehicle && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 12, color: '#ccc' }}>🚗 차량 시뮬레이션</span>
                                        <button
                                            style={vehicleDone
                                                ? { ...obPrimaryBtn, fontSize: 11, background: 'rgba(78,203,141,0.15)', borderColor: 'rgba(78,203,141,0.4)', color: '#4ecb8d' }
                                                : generatingVehicle
                                                ? { ...obPrimaryBtn, opacity: 0.6, fontSize: 11 }
                                                : { ...obPrimaryBtn, fontSize: 11 }}
                                            onClick={handleGenerateVehicle}
                                            disabled={vehicleDone || generatingVehicle}
                                        >
                                            {vehicleDone ? '생성 완료 ✓' : generatingVehicle ? '생성 중...' : '더미 생성'}
                                        </button>
                                    </div>
                                    {missingSignal && !signalDone && !vehicleDone && (
                                        <span style={{ fontSize: 10, color: '#666' }}>
                                            신호 데이터 없이 생성 시 신호 패턴이 자동 추정됩니다.
                                        </span>
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

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
    const bg = done ? '#4ecb8d' : active ? '#5588ee' : 'rgba(255,255,255,0.1)';
    const color = (done || active) ? '#fff' : '#555';
    return (
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>
            {done ? '✓' : label}
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
const obStepRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 0,
};
const obStepLineStyle: React.CSSProperties = {
    flex: 1, height: 1, background: 'rgba(255,255,255,0.1)', margin: '0 8px',
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
    const setVersion = useScenarioStore((state) => state.setVersion);

    const handleVersionSelect = (v: ScenarioVersions) => {
        setVersion(v);
    };

    const fetchSchema = useSchemaStore((state) => state.fetchSchema)

    const { sessions, activeMenuCode, minimizeSession } = useWorkflowStore();

    const {
        menu,
        activeSubmenu,
        activeDropdownMenu,
        setActiveSubmenu,
    } = useMenuStore();

    const activeSession = sessions.find(s => s.menuCode === activeMenuCode && !s.isMinimized);

    // 편집 모드 진입 시 속성 선택 초기화 (PropertyModal이 편집 패널 뒤에 표시되지 않도록)
    useEffect(() => {
        if (activeSubmenu) {
            usePropertyStore.getState().setSelectedProps(null);
        }
    }, [activeSubmenu]);

    useEffect(() => {
        fetchSchema()
    }, [fetchSchema]);

    return (
        !selectedScenario ? (
            <ScenarioSelector/>
        ) : (
            <div>
                {!selectedScenarioVersion && (
                    <VersionPopup
                        scenarioId={selectedScenario.id}
                        onSelect={handleVersionSelect}
                    />
                )}
                {selectedScenarioVersion && <OnboardingGuide onOpenImport={() => setShowFileImport(true)} />}
                {showFileImport && <FileImportModal onClose={() => setShowFileImport(false)} />}
                <Header onDashboard={() => setShowDashboard(prev => !prev)} isDashboardOpen={showDashboard} dashboardMode={showDashboard}/>
                <MessagePopup/>
                <PerformancePanel/>
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

                        {!showDashboard && activeSession && (
                            isDescendantOf(menu, 'SCHEMA_SETTING', activeSession.menuCode) ? (
                                <SchemaSetting/>
                            ) : activeSession.menuCode === 'VEHICLE_TYPE' ? (
                                <PropertyForm
                                    activePopupMenu={activeSession.menu}
                                    open={true}
                                    config={propertyFormSchema['VEHICLE_TYPE']}
                                    onClose={() => setActiveSubmenu(null)}
                                />
                            ) : activeSession.menuCode === 'VEHICLE_MODEL' ? (
                                <PropertyForm
                                    activePopupMenu={activeSession.menu}
                                    open={true}
                                    config={propertyFormSchema['VEHICLE_MODEL']}
                                    onClose={() => setActiveSubmenu(null)}
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
