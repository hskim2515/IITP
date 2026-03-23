import React, { useState } from 'react';
import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import ColorBar from "@component/util/ColorBar";
import styles from "@css/ToolsPanel.module.css";

interface Props {
    layerType: string | undefined;
}

const colorMaps: Record<string, string[]> = {
    default:    ["#0000FF", "#00FF00", "#FFFF00", "#FF0000"],
    viridis:    ["#440154", "#3B528B", "#21908C", "#5DC863"],
    inferno:    ["#000004", "#420A68", "#932667", "#FDE725"],
    hot:        ["#000000", "#FF0000", "#FFFF00", "#FFFFFF"],
    autumn:     ["#FF0000", "#FF8000", "#FFFF00", "#FFFFFF"],
    coolToWarm: ["#3B4CC0", "#6699FF", "#FFCC33", "#B40426"],
    rainbow:    ["#9400D3", "#0000FF", "#00FF00", "#FFFF00"],
    grayscale:  ["#000000", "#555555", "#AAAAAA", "#FFFFFF"],
};

const LayerSettingPopup = ({ layerType }: Props) => {
    const { colors, exaggeration, setColors, setExaggeration } = useHeatmapSettingStore();
    const [tempExaggeration, setTempExaggeration] = useState(exaggeration);

    if (!layerType) return null;

    const handleExaggerationCommit = () => setExaggeration(tempExaggeration);

    return (
        <div style={{ marginTop: 8 }}>
            {layerType === 'heatmap' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>Color</span>
                    </div>
                    <div className={styles.colorBarRow}>
                        {Object.entries(colorMaps).map(([name, c]) => (
                            <div key={name} className={styles.colorBarItem} onClick={() => setColors(c)}>
                                <ColorBar colormap={c} />
                            </div>
                        ))}
                    </div>
                    <div className={styles.sectionDivider} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>Exaggeration</span>
                        <input
                            className={styles.settingRange}
                            type="range"
                            min={0.1}
                            max={2}
                            step={0.1}
                            value={tempExaggeration}
                            onChange={(e) => setTempExaggeration(parseFloat(e.target.value))}
                            onMouseUp={handleExaggerationCommit}
                            onTouchEnd={handleExaggerationCommit}
                        />
                        <span className={styles.settingValue}>{tempExaggeration.toFixed(1)}</span>
                    </div>
                </>
            )}
        </div>
    );
};

export default LayerSettingPopup;
