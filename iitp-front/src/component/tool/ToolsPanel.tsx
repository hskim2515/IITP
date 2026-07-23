import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRuler, faLayerGroup, faCog, faRoad, faFileArrowDown } from '@fortawesome/free-solid-svg-icons';
import LayerPopup from "../popup/LayerPopup";
import MeasurePopup from "../popup/MeasurePopup";
import SettingPopup from "../popup/SettingPopup";
import NetworkMaintenancePanel from "./NetworkMaintenancePanel";
import DataIOPanel from "./DataIOPanel";
import styles from "@css/ToolsPanel.module.css";
import { useMapStore } from "@stores/useMapStore";
import { useModeStore } from "@stores/useModeStore";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

// editOnly: 편집모드에서만 노출되는 도로편집 툴. 편집은 OL(2D) 기반이라 2D 에서만 동작.
const tools = [
    { icon: faLayerGroup,    label: '레이어',     popup: <LayerPopup isOpen={true} />, editOnly: false },
    { icon: faRuler,         label: '측정',       popup: <MeasurePopup isOpen={true} />, editOnly: false },
    { icon: faRoad,          label: '네트워크 도구', popup: <NetworkMaintenancePanel />, editOnly: true },
    { icon: faFileArrowDown, label: '데이터 입출력', popup: <DataIOPanel />, editOnly: false },
    { icon: faCog,           label: '설정',       popup: <SettingPopup isOpen={true} />, editOnly: false },
];

const ToolsPanel = () => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const coordPickActive = useMapStore((s) => s.coordPickCallback !== null);
    const appMode = useModeStore((s) => s.appMode);

    // 편집모드 진입 시 선택·편집 자동 활성화 — 패널을 열지 않고도 바로 링크/노드 편집 가능.
    // (진입당 1회만: 사용자가 수동으로 끈 뒤 effect 재실행(activeIndex 변경 등)으로 다시 강제하지 않음)
    const autoSelectDoneRef = useRef(false);
    // 편집모드 이탈 시: 진행 중인 도로편집 리셋 + 편집 툴 패널 닫기.
    useEffect(() => {
        if (appMode === 'edit') {
            if (!autoSelectDoneRef.current) {
                autoSelectDoneRef.current = true;
                const ds = useNetworkDrawStore.getState();
                if (!ds.isActive && !ds.isConnectionActive && ds.placementMode === 'none' && !ds.isSelectActive) {
                    try { ds.setSelectActive(true); } catch (_) { /* noop */ }
                }
            }
        } else {
            autoSelectDoneRef.current = false;
            try { useNetworkDrawStore.getState().reset(); } catch (_) {}
            if (activeIndex !== null && tools[activeIndex]?.editOnly) setActiveIndex(null);
        }
    }, [appMode, activeIndex]);

    const toggle = (i: number) => setActiveIndex(prev => prev === i ? null : i);

    return (
        <>
            {/* Right icon toolbar */}
            <div className={styles.toolbar}>
                {tools.map((tool, i) => {
                    // 편집 전용 툴(도로 그리기)은 편집모드에서만 노출.
                    if (tool.editOnly && appMode !== 'edit') return null;
                    return (
                        <React.Fragment key={i}>
                            {i > 0 && <div className={styles.toolDivider} />}
                            <button
                                className={activeIndex === i ? styles.toolBtnActive : styles.toolBtn}
                                onClick={() => toggle(i)}
                                title={tool.label}
                            >
                                <FontAwesomeIcon icon={tool.icon} />
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Active popup panel */}
            {activeIndex !== null && (
                <div
                    className={styles.panel}
                    style={coordPickActive ? { pointerEvents: 'none', opacity: 0.4 } : undefined}
                >
                    {activeIndex !== null && tools[activeIndex]?.popup}
                </div>
            )}
        </>
    );
};

export default ToolsPanel;
