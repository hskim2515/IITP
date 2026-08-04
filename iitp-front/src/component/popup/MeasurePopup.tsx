import React, { useState } from "react";
import { useCesiumMeasure } from "@hooks/sync/measure/useCesiumMeasure";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useOlMeasure } from "@hooks/sync/measure/useOlMeasure";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRuler, faVectorSquare } from "@fortawesome/free-solid-svg-icons";
import styles from "@css/ToolsPanel.module.css";

interface MeasurePopupProps {
    isOpen: boolean;
}

const MeasurePopup: React.FC<MeasurePopupProps> = ({ isOpen }) => {
    const [selectedTool, setSelectedTool] = useState<string | null>(null);
    const cesiumViewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map);

    useCesiumMeasure(selectedTool, cesiumViewer);
    useOlMeasure(selectedTool, olMap);

    const handleToggle = (tool: string) => {
        setSelectedTool(prev => prev === tool ? null : tool);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ cursor: 'default', color: 'rgba(var(--overlay-rgb), 0.4)' }}>측정 도구</span>
            </div>
            <div className={styles.panelBody}>
                <button
                    className={selectedTool === "distance" ? styles.measureBtnActive : styles.measureBtn}
                    onClick={() => handleToggle('distance')}
                >
                    <FontAwesomeIcon icon={faRuler} className={styles.measureIcon} />
                    거리 측정
                </button>
                <button
                    className={selectedTool === "area" ? styles.measureBtnActive : styles.measureBtn}
                    onClick={() => handleToggle('area')}
                >
                    <FontAwesomeIcon icon={faVectorSquare} className={styles.measureIcon} />
                    면적 측정
                </button>
            </div>
        </>
    );
};

export default MeasurePopup;
