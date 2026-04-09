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
import NetworkImportModal from "@component/modal/NetworkImportModal";
import OdMatrixModal from "@component/modal/OdMatrixModal";
import Taskbar from "@component/panel/Taskbar";
import DashboardLeft from "@component/panel/DashboardLeft";
import DashboardRight from "@component/panel/DashboardRight";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";

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

function InitGuideModal({ onClose }: { onClose: () => void }) {
    const openSession = useWorkflowStore((s: any) => s.openSession);

    const handleOsm = () => {
        openSession({ menuCode: 'OSM_IMPORT', nameKor: 'OSM 가져오기' });
        onClose();
    };

    const handleNetworkXml = () => {
        openSession({ menuCode: 'NETWORK_IMPORT', nameKor: '네트워크 XML 임포트' });
        onClose();
    };

    return (
        <div style={initGuideOverlayStyle}>
            <div style={initGuidePanelStyle}>
                <div style={initGuideHeaderStyle}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>네트워크 데이터 초기화</span>
                </div>
                <div style={{ padding: '16px 20px' }}>
                    <p style={{ fontSize: 12, color: '#888', margin: '0 0 16px 0', lineHeight: 1.6 }}>
                        이 버전에는 아직 네트워크 데이터가 없습니다.<br />
                        아래 방법 중 하나를 선택해 데이터를 가져오세요.
                    </p>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button style={initGuideCardStyle} onClick={handleOsm}>
                            <span style={{ fontSize: 22, marginBottom: 6 }}>🗺</span>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>OSM 가져오기</span>
                            <span style={{ fontSize: 11, color: '#777', marginTop: 4, lineHeight: 1.4 }}>
                                OpenStreetMap에서<br />도로 네트워크 변환
                            </span>
                        </button>
                        <button style={initGuideCardStyle} onClick={handleNetworkXml}>
                            <span style={{ fontSize: 22, marginBottom: 6 }}>📂</span>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>XML 임포트</span>
                            <span style={{ fontSize: 11, color: '#777', marginTop: 4, lineHeight: 1.4 }}>
                                기존 network.xml<br />파일 불러오기
                            </span>
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <button style={initGuideLaterBtnStyle} onClick={onClose}>나중에</button>
                </div>
            </div>
        </div>
    );
}

const initGuideOverlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1500,
};
const initGuidePanelStyle: React.CSSProperties = {
    background: 'rgba(14,16,28,0.98)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
    width: 420, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column',
};
const initGuideHeaderStyle: React.CSSProperties = {
    padding: '14px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
};
const initGuideCardStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '16px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#ddd',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
};
const initGuideLaterBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#888', cursor: 'pointer',
};

function App() {

    const [showDashboard, setShowDashboard] = useState(false);
    const [showInitGuide, setShowInitGuide] = useState(false);

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
                {showInitGuide && (
                    <InitGuideModal onClose={() => setShowInitGuide(false)} />
                )}
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

                        {!showDashboard && activeSession && activeSession.menuCode === 'NETWORK_IMPORT' && (
                            <NetworkImportModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode === 'OD_MATRIX' && (
                            <OdMatrixModal/>
                        )}

                        {!showDashboard && activeSession && activeSession.menuCode !== 'OSM_IMPORT' && activeSession.menuCode !== 'NETWORK_IMPORT' && (
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
