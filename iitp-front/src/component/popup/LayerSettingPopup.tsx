import React, { useState } from 'react';
import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import { useAnalysisSettingStore } from '@stores/useAnalysisSettingStore';
import { useLayerStore } from '@stores/useLayerStore';
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

/** 슬라이더 행 */
const SliderRow = ({
    label, min, max, step, value, onChange, display
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; display?: string;
}) => (
    <div className={styles.settingRow}>
        <span className={styles.settingLabel}>{label}</span>
        <input
            className={styles.settingRange}
            type="range"
            min={min} max={max} step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className={styles.settingValue}>{display ?? value}</span>
    </div>
);

const LayerSettingPopup = ({ layerType }: Props) => {
    const { colors, exaggeration, setColors, setExaggeration } = useHeatmapSettingStore();
    const { vehicle, trip, od, speed, setVehicle, setTrip, setOd, setSpeed } = useAnalysisSettingStore();
    const layerManager = useLayerStore((s) => s.layerManager);
    const [tempExaggeration, setTempExaggeration] = useState(exaggeration);

    if (!layerType) return null;

    /** layerManager의 analyze 그룹에서 setter 호출 */
    const applyToLayers = (fn: (layer: any) => void) => {
        layerManager?.getLayerGroup('analyze').forEach((layer: any) => {
            try { fn(layer); } catch (_) {}
        });
    };

    const handleExaggerationCommit = () => setExaggeration(tempExaggeration);

    return (
        <div>

            {/* ── 히트맵 ── */}
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
                    <SliderRow
                        label="Exaggeration"
                        min={0.1} max={2} step={0.1}
                        value={tempExaggeration}
                        display={tempExaggeration.toFixed(1)}
                        onChange={(v) => {
                            setTempExaggeration(v);
                            setExaggeration(v);
                        }}
                    />
                </>
            )}

            {/* ── 차량 ── */}
            {layerType === 'vehicle' && (
                <>
                    <SliderRow
                        label="점 크기"
                        min={2} max={12} step={1}
                        value={vehicle.pointRadius}
                        display={`${vehicle.pointRadius}px`}
                        onChange={(v) => {
                            setVehicle({ pointRadius: v });
                            applyToLayers((l) => {
                                if (typeof l.setPointStyle === 'function') {
                                    l.setPointStyle(v, vehicle.pointOpacity);
                                }
                            });
                        }}
                    />
                    <SliderRow
                        label="투명도"
                        min={0.1} max={1} step={0.05}
                        value={vehicle.pointOpacity}
                        display={vehicle.pointOpacity.toFixed(2)}
                        onChange={(v) => {
                            setVehicle({ pointOpacity: v });
                            applyToLayers((l) => {
                                if (typeof l.setPointStyle === 'function') {
                                    l.setPointStyle(vehicle.pointRadius, v);
                                }
                            });
                        }}
                    />
                </>
            )}

            {/* ── 트립 플로우 ── */}
            {layerType === 'trip' && (
                <>
                    <SliderRow
                        label="꼬리 길이"
                        min={5} max={200} step={5}
                        value={trip.trailLength}
                        display={`${trip.trailLength}`}
                        onChange={(v) => {
                            setTrip({ trailLength: v });
                            applyToLayers((l) => {
                                if (typeof l.setTrailLength === 'function') {
                                    l.setTrailLength(v);
                                }
                            });
                        }}
                    />
                </>
            )}

            {/* ── OD 분석 ── */}
            {layerType === 'od' && (
                <>
                    <SliderRow
                        label="투명도"
                        min={0.1} max={1} step={0.05}
                        value={od.opacity}
                        display={od.opacity.toFixed(2)}
                        onChange={(v) => {
                            setOd({ opacity: v });
                            applyToLayers((l) => {
                                if (typeof l.setOpacity === 'function') l.setOpacity(v);
                                else if (typeof l.setVisible === 'function' && typeof l.getOpacity === 'function') {
                                    l.setOpacity(v);
                                }
                            });
                        }}
                    />
                </>
            )}

            {/* ── 속도 히트맵 ── */}
            {layerType === 'speed' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>Color</span>
                    </div>
                    <div className={styles.colorBarRow}>
                        {Object.entries(colorMaps).map(([name, c]) => (
                            <div key={name} className={styles.colorBarItem}
                                onClick={() => {
                                    applyToLayers((l) => {
                                        if (typeof l.setColors === 'function') l.setColors(c);
                                    });
                                }}>
                                <ColorBar colormap={c} />
                            </div>
                        ))}
                    </div>
                    <div className={styles.sectionDivider} />
                    <SliderRow
                        label="투명도"
                        min={0.1} max={1} step={0.05}
                        value={speed.opacity}
                        display={speed.opacity.toFixed(2)}
                        onChange={(v) => {
                            setSpeed({ opacity: v });
                            applyToLayers((l) => {
                                if (typeof l.setOpacity === 'function') l.setOpacity(v);
                            });
                        }}
                    />
                </>
            )}
        </div>
    );
};

export default LayerSettingPopup;
