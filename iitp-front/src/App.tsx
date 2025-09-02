import React, { useEffect, useRef, useState } from 'react';
import './App.css'
import Maps from "./component/map/Maps";
import Header from "./component/header/Header";
import LeftPanel from "./component/panel/LeftPanel";
import Tools from "./component/tool/Tools";
import ToolsPanel from "./component/tool/ToolsPanel";
import { useScenarioStore } from "@stores/useScenarioStore";
import PropertyModal from "./component/modal/PropertyModal";
import PropertyPanel from "./component/panel/PropertyPanel";
import { useMenuStore } from "@stores/useMenuStore";
import { MessagePopup } from "@component/message/MessagePopup";
import { useSchemaStore } from "@stores/useSchemaStore";
import SchemaSetting from "@component/schema/SchemaSetting";
import ScenarioSelector from "@component/scenario/ScenarioSelector";

function App() {

    const version = useScenarioStore((state) => state.selectedScenarioVersion);
    const setVersion = useScenarioStore((state) => state.setVersion);

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);

    const fetchSchema = useSchemaStore((state) => state.fetchSchema)

    const activeSubmenu = useMenuStore((state) => state.activeSubmenu)
    const activeDropdownMenu = useMenuStore((state) => state.activeDropdownMenu)
    const setActiveSubmenu = useMenuStore((state) => state.setActiveSubmenu)

    useEffect(() => {
        fetchSchema()
    }, [fetchSchema]);

    // 시나리오 선택 화면
    if (!selectedScenario) {
        return <ScenarioSelector/>
    }

    return (
        <>
            <div>
                {/* 버전 선택 팝업 (version이 없을 때만 보여줌) */}
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
                <Header/>
                <MessagePopup/>
                <LeftPanel/>
                <Maps/>
                <Tools/>
                <ToolsPanel/>
                <PropertyModal/>
                {activeDropdownMenu && activeSubmenu && (
                    activeDropdownMenu.menuCode === 'SCHEMA_SETTING'
                        ? <SchemaSetting
                            activeSubmenu={activeSubmenu}
                            onClose={() => setActiveSubmenu(null)}
                        />
                        : <PropertyPanel
                            activeSubmenu={activeSubmenu}
                            onClose={() => setActiveSubmenu(null)}
                        />
                )}
            </div>
        </>
    )
}

export default App
