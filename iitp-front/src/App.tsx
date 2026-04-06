import React, { useEffect, useState } from 'react';
import './App.css'
import { ScenarioVersions } from "@type/Scenario";
import Header from "./component/header/Header";
import LeftPanel from "./component/panel/LeftPanel";
import { useScenarioStore } from "@stores/useScenarioStore";
import PropertyModal from "@component/modal/PropertyModal";
import PropertyPanel from "@component/panel/PropertyPanel";
import { isDescendantOf, useMenuStore } from "@stores/useMenuStore";
import { MessagePopup } from "@component/message/MessagePopup";
import { useSchemaStore } from "@stores/useSchemaStore";
import SchemaSetting from "@component/schema/SchemaSetting";
import ScenarioSelector from "@component/scenario/ScenarioSelector";
import PropertyForm from "@component/popup/PropertyPopup";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import Maps from "@component/map/Maps";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import Taskbar from "@component/panel/Taskbar";
import DashboardLeft from "@component/panel/DashboardLeft";
import DashboardRight from "@component/panel/DashboardRight";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";

function VersionPopup({ scenarioId, onSelect }: { scenarioId: number; onSelect: (v: ScenarioVersions) => void }) {
    const [versions, setVersions] = useState<ScenarioVersions[]>([]);

    useEffect(() => {
        fetch(process.env.VITE_API_URL + `/scenario/${scenarioId}/versions`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        }).then((r) => r.json()).then(setVersions);
    }, [scenarioId]);

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

function App() {

    const [showDashboard, setShowDashboard] = useState(false);
    const [mapMode, setMapMode] = useState<'2D' | '3D'>('2D');

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((state) => state.selectedScenarioVersion);
    const setVersion = useScenarioStore((state) => state.setVersion);

    const fetchSchema = useSchemaStore((state) => state.fetchSchema)

    const { sessions, activeMenuCode, minimizeSession } = useWorkflowStore();

    const {
        menu,
        activeSubmenu,
        activeDropdownMenu,
        setActiveSubmenu,
    } = useMenuStore();

    const activeSession = sessions.find(s => s.menuCode === activeMenuCode && !s.isMinimized);

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
                        onSelect={setVersion}
                    />
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
                            mapMode={mapMode}
                            onMapModeChange={setMapMode}
                        />

                        {!showDashboard && <Taskbar/>}

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
