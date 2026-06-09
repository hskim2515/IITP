import React, { useState } from 'react';
import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import { useAnalysisSettingStore } from '@stores/useAnalysisSettingStore';
import { useVisualLayerSettingStore } from '@stores/useVisualLayerSettingStore';
import { useLayerStore } from '@stores/useLayerStore';
import ColorBar from "@component/util/ColorBar";
import styles from "@css/ToolsPanel.module.css";

interface Props {
    layerType: string | undefined;
}

const VEHICLE_HIGHLIGHT_OPTIONS = [
    { value: 'ALL', label: '전체 차종' },
    { value: 'CAR', label: '승용차' },
    { value: 'TAXI', label: '택시' },
    { value: 'BUS', label: '버스' },
    { value: 'TRUCK', label: '화물차' },
    { value: 'MOTO', label: '이륜차' },
];

const ICON_BUBBLE_VEHICLE_OPTIONS = [
    { value: 'ALL', label: '전체 차량' },
    { value: 'CAR', label: '승용차' },
    { value: 'TAXI', label: '택시' },
    { value: 'BUS', label: '버스' },
    { value: 'TRUCK', label: '화물차' },
    { value: 'MOTO', label: '이륜차' },
];

const DWELL_TIME_METRIC_OPTIONS = [
    { value: 'dwell', label: '정체시간 강도' },
    { value: 'slowCount', label: '저속 차량 수' },
    { value: 'stopGo', label: '정지-재출발' },
];

const INTERSECTION_PULSE_METRIC_OPTIONS = [
    { value: 'incoming', label: '유입량' },
    { value: 'waiting', label: '대기량' },
    { value: 'outgoing', label: '방출량' },
];

const FLOW_BAR_METRIC_OPTIONS = [
    { value: 'volume', label: '교통량' },
    { value: 'avgSpeed', label: '평균속도' },
    { value: 'dwell', label: '체류강도' },
];

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
    const {
        vehicle,
        trip,
        od,
        speed,
        dwellTime,
        iconBubble,
        intersectionPulse,
        flowBar,
        setVehicle,
        setTrip,
        setOd,
        setSpeed,
        setDwellTime,
        setIconBubble,
        setIntersectionPulse,
        setFlowBar,
    } = useAnalysisSettingStore();
    const {
        guidewayColor,
        traceVehicleColor,
        setGuidewayColor,
        setTraceVehicleColor,
    } = useVisualLayerSettingStore();
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
            {(layerType === 'heatmap' || layerType === 'flowBar') && (
                <>
                    {layerType === 'flowBar' && (
                        <>
                            <div className={styles.settingRow}>
                                <span className={styles.settingLabel}>분석 기준</span>
                                <select
                                    className={styles.settingSelect}
                                    value={flowBar.metric}
                                    onChange={(e) => {
                                        const metric = e.target.value as 'volume' | 'avgSpeed' | 'dwell';
                                        setFlowBar({ metric });
                                        applyToLayers((l) => {
                                            if (typeof l.setFlowMetric === 'function') {
                                                l.setFlowMetric(metric);
                                            }
                                        });
                                    }}
                                >
                                    {FLOW_BAR_METRIC_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
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
                    {layerType === 'heatmap' && (
                        <>
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
                </>
            )}

            {/* ── 체류시간 분석 ── */}
            {layerType === 'dwellTime' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>분석 기준</span>
                        <select
                            className={styles.settingSelect}
                            value={dwellTime.metric}
                            onChange={(e) => {
                                setDwellTime({ metric: e.target.value as 'dwell' | 'slowCount' | 'stopGo' });
                            }}
                        >
                            {DWELL_TIME_METRIC_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </>
            )}

            {/* ── 링크 아이콘 ── */}
            {layerType === 'iconBubble' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>차량 종류</span>
                        <select
                            className={styles.settingSelect}
                            value={iconBubble.vehicleType}
                            onChange={(e) => {
                                const vehicleType = e.target.value as 'ALL' | 'CAR' | 'TAXI' | 'BUS' | 'TRUCK' | 'MOTO';
                                setIconBubble({ vehicleType });
                                applyToLayers((l) => {
                                    if (typeof l.setVehicleTypeFilter === 'function') {
                                        l.setVehicleTypeFilter(vehicleType);
                                    }
                                });
                            }}
                        >
                            {ICON_BUBBLE_VEHICLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </>
            )}

            {/* ── 교차로 펄스 ── */}
            {layerType === 'intersectionPulse' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>분석 기준</span>
                        <select
                            className={styles.settingSelect}
                            value={intersectionPulse.metric}
                            onChange={(e) => {
                                const metric = e.target.value as 'incoming' | 'waiting' | 'outgoing';
                                setIntersectionPulse({ metric });
                                applyToLayers((l) => {
                                    if (typeof l.setPulseMetric === 'function') {
                                        l.setPulseMetric(metric);
                                    }
                                });
                            }}
                        >
                            {INTERSECTION_PULSE_METRIC_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
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

            {/* ── 가이드 웨이 ── */}
            {layerType === 'guideway' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>색상</span>
                        <input
                            type="color"
                            value={guidewayColor}
                            onChange={(e) => {
                                const c = e.target.value;
                                setGuidewayColor(c);
                                applyToLayers((l) => {
                                    if (typeof l.setGuidewayColor === 'function') l.setGuidewayColor(c);
                                });
                            }}
                        />
                    </div>
                </>
            )}

            {/* ── 차량 강조 ── */}
            {layerType === 'traceVehicle' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>강조 차종</span>
                        <select
                            className={styles.settingSelect}
                            value={vehicle.highlightedType}
                            onChange={(e) => {
                                const highlightedType = e.target.value;
                                setVehicle({ highlightedType });
                                applyToLayers((l) => {
                                    if (typeof l.setHighlightType === 'function') l.setHighlightType(highlightedType);
                                });
                            }}
                        >
                            {VEHICLE_HIGHLIGHT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>색상</span>
                        <input
                            type="color"
                            value={traceVehicleColor}
                            onChange={(e) => {
                                const c = e.target.value;
                                setTraceVehicleColor(c);
                                applyToLayers((l) => {
                                    if (typeof l.setTraceVehicleColor === 'function') l.setTraceVehicleColor(c);
                                });
                            }}
                        />
                    </div>
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
