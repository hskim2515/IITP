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
import { useSchemaStore } from "@stores/useSchemaStore";
import SchemaSetting from "@component/schema/SchemaSetting";
import ScenarioSelector from "@component/scenario/ScenarioSelector";
import PropertyForm from "@component/popup/PropertyPopup";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import Maps from "@component/map/Maps";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import OsmImportModal from "@component/modal/OsmImportModal";
import SumoImportModal from "@component/modal/SumoImportModal";
import NetworkImportModal from "@component/modal/NetworkImportModal";
import OdMatrixModal from "@component/modal/OdMatrixModal";
import Taskbar from "@component/panel/Taskbar";
import DashboardLeft from "@component/panel/DashboardLeft";
import DashboardRight from "@component/panel/DashboardRight";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { ConsolePanel } from "@component/console/ConsolePanel";
import { useOnboardingStore } from "@stores/useOnboardingStore";
import { useLogStore } from "@stores/useLogStore";

function VersionPopup({ scenarioId, onSelect }: { scenarioId: number; onSelect: (v: ScenarioVersions) => void }) {
    const [versions, setVersions] = useState<ScenarioVersions[] | null>(null);

    useEffect(() => {
        fetch(process.env.VITE_API_URL + `/scenario/${scenarioId}/versions`, {
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

function OnboardingGuide() {
    const step = useOnboardingStore((s) => s.step);
    const setStep = useOnboardingStore((s) => s.setStep);
    const scenarioKey = useScenarioStore.getState().selectedScenario?.key ?? '';
    const [generating, setGenerating] = useState(false);

    if (step === 'idle') return null;

    const handleDismiss = () => setStep('idle');

    const handleGenerateDummy = async () => {
        setGenerating(true);
        useLogStore.getState().addLog('info', '더미 시뮬레이션 데이터 생성 시작...');
        try {
            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/vehicle/vehicle-route/${scenarioKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numVehicle: 100 }) }
            );
            if (res.status === 202 || res.ok) {
                useLogStore.getState().addLog('info', '더미 시뮬레이션 데이터 생성 완료 — 시뮬레이션 재생으로 확인하세요.');
                setStep('idle');
            } else {
                const body = await res.json().catch(() => ({}));
                const msg = body?.error ?? `서버 오류 (${res.status})`;
                useLogStore.getState().addLog('error', `더미 데이터 생성 실패: ${msg}`);
            }
        } catch (e) {
            useLogStore.getState().addLog('error', '더미 데이터 생성 중 오류 발생');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div style={obOverlayStyle}>
            <div style={obPanelStyle}>
                {/* 단계 표시 */}
                <div style={obStepRowStyle}>
                    <StepDot active={step === 'need-network'} done={step === 'need-dummy'} label="1" />
                    <div style={obStepLineStyle} />
                    <StepDot active={step === 'need-dummy'} done={false} label="2" />
                </div>

                {step === 'need-network' && (
                    <>
                        <div style={obTitleStyle}>네트워크 데이터 없음</div>
                        <p style={obDescStyle}>
                            이 버전에는 아직 도로 네트워크 데이터가 없습니다.<br />
                            상단 메뉴 <span style={obHighlight}>파일 › 가져오기 › 네트워크 XML</span> 에서<br />
                            network.xml 파일을 불러오세요.
                        </p>
                        <div style={obFooterStyle}>
                            <button style={obDismissBtn} onClick={handleDismiss}>나중에</button>
                        </div>
                    </>
                )}

                {step === 'need-dummy' && (
                    <>
                        <div style={obTitleStyle}>시뮬레이션 더미 데이터 생성</div>
                        <p style={obDescStyle}>
                            네트워크 반영이 완료됐습니다.<br />
                            생성된 네트워크를 기반으로 더미 차량 시뮬레이션 데이터를 만들어<br />
                            시뮬레이션 재생을 미리 확인할 수 있습니다.
                        </p>
                        <div style={obFooterStyle}>
                            <button style={obDismissBtn} onClick={handleDismiss} disabled={generating}>건너뛰기</button>
                            <button
                                style={generating ? { ...obPrimaryBtn, opacity: 0.6 } : obPrimaryBtn}
                                onClick={handleGenerateDummy}
                                disabled={generating}
                            >
                                {generating ? '생성 중...' : '더미 데이터 생성'}
                            </button>
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
                <OnboardingGuide />
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

                        {!showDashboard && activeSession && activeSession.menuCode === 'OSM_IMPORT' && (
                            <OsmImportModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode === 'SUMO_IMPORT' && (
                            <SumoImportModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode === 'NETWORK_IMPORT' && (
                            <NetworkImportModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode === 'OD_MATRIX' && (
                            <OdMatrixModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode !== 'OSM_IMPORT' && activeSession.menuCode !== 'SUMO_IMPORT' && activeSession.menuCode !== 'NETWORK_IMPORT' && (
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
                <ConsolePanel />
            </div>
        )
    )
}

export default App
