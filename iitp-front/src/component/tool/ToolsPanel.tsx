import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRuler, faLayerGroup, faCog } from '@fortawesome/free-solid-svg-icons';
import LayerPopup from "../popup/LayerPopup";
import MeasurePopup from "../popup/MeasurePopup";
import SettingPopup from "../popup/SettingPopup";
import styles from "@css/ToolsPanel.module.css";

const tools = [
    { icon: faLayerGroup, label: '레이어', popup: <LayerPopup isOpen={true} /> },
    { icon: faRuler,      label: '측정',   popup: <MeasurePopup isOpen={true} /> },
    { icon: faCog,        label: '설정',   popup: <SettingPopup isOpen={true} /> },
];

const ToolsPanel = () => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const toggle = (i: number) => setActiveIndex(prev => prev === i ? null : i);

    return (
        <>
            {/* Right icon toolbar */}
            <div className={styles.toolbar}>
                {tools.map((tool, i) => (
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
                ))}
            </div>

            {/* Active popup panel */}
            {activeIndex !== null && (
                <div className={styles.panel}>
                    {tools[activeIndex].popup}
                </div>
            )}
        </>
    );
};

export default ToolsPanel;
