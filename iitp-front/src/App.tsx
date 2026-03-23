import React, { useEffect, useState } from 'react';
import './App.css'
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
import Dashboard from "@component/panel/Dashboard";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";

function App() {

    const [showDashboard, setShowDashboard] = useState(false);

    const version = useScenarioStore((state) => state.selectedScenarioVersion);
    const setVersion = useScenarioStore((state) => state.setVersion);

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);

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
                {!version && (
                    <div className="version-popup">
                        <div className="version-popup-content">
                            <h2>시나리오 버전을 선택하세요</h2>
                            <select
                                defaultValue=""
                                onChange={(e) => {
                                    const selected = e.target.value;
                                    if (selected) {
                                        setVersion(selected);
                                    }
                                }}
                            >
                                <option value="" disabled>버전을 선택하세요</option>
                                <option value="v1">version-1</option>
                                <option value="v2">version-2</option>
                            </select>
                        </div>
                    </div>
                )}
                <Header onDashboard={() => setShowDashboard(true)}/>
                {showDashboard && <Dashboard onClose={() => setShowDashboard(false)}/>}
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
                        height: "calc(100vh - 44px)"
                    }}
                >
                    {activeDropdownMenu && <LeftPanel/>}
                    <div
                        style={{
                            flex: "1 1 auto",
                            minWidth: "0",
                            overflow: "hidden",
                            position: "relative",
                        }}
                    >
                        <Maps/>
                        <Taskbar/>

                        {activeSession && (
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
                            ) : menuCodeToStoreMap[activeSubmenu.menuCode] ? (
                                <PropertyPanel
                                    activeSubmenu={activeSession.menu}  // ← 바로 사용
                                    onClose={() => minimizeSession(activeSession.menuCode)}
                                />
                            ) : null
                        )}

                    </div>
                </main>
            </div>
        )
    )
}

export default App
