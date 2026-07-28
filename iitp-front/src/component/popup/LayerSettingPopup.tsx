import React, { useState } from 'react';
import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import { useAnalysisSettingStore } from '@stores/useAnalysisSettingStore';
import { useLayerStore } from '@stores/useLayerStore';
import ColorBar from "@component/util/ColorBar";
import { LOS_GRADE_LEGEND, vcToContinuousColorHex, coverageColorHex } from "@utils/losScale";
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
    const { vehicle, trip, od, speed, isochrone, setVehicle, setTrip, setOd, setSpeed, setIsochrone } = useAnalysisSettingStore();
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

            {/* ── 혼잡도 히트맵 (링크 V/C ratio) ── */}
            {layerType === 'congestion' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>혼잡도 (용량 대비 교통량, V/C)</span>
                    </div>
                    <ColorBar colormap={[0, 0.5, 1.0, 1.5].map(vcToContinuousColorHex)} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>원활(0)</span>
                        <span className={styles.settingValue}>포화(1.0)</span>
                        <span className={styles.settingValue}>정체(1.5+)</span>
                    </div>
                </>
            )}

            {/* ── 서비스수준(LOS) ── */}
            {layerType === 'los' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>서비스수준(LOS) — V/C 기반 근사 등급</span>
                    </div>
                    {LOS_GRADE_LEGEND.map(({ grade, color, label }) => (
                        <div key={grade} className={styles.settingRow}>
                            <span style={{
                                display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                                background: color, marginRight: 6,
                            }} />
                            <span className={styles.settingLabel}>{label}</span>
                        </div>
                    ))}
                    <div className={styles.sectionDivider} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>큰 점 = 신호교차로(접근 링크 중 최악 등급)</span>
                    </div>
                </>
            )}

            {/* ── 지역별 교통량(행정구역) ── */}
            {layerType === 'region' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>지역별 교통량 (혼잡도 색상 + 3D 컬럼 높이)</span>
                    </div>
                    <ColorBar colormap={[0, 0.5, 1.0, 1.5].map(vcToContinuousColorHex)} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>원활(0)</span>
                        <span className={styles.settingValue}>포화(1.0)</span>
                        <span className={styles.settingValue}>정체(1.5+)</span>
                    </div>
                    <div className={styles.sectionDivider} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>줌 레벨에 따라 시도 → 시군구 → 읍면동 단위로 자동 전환됩니다.</span>
                    </div>
                </>
            )}

            {/* ── 지역 OD 관계 그래프 ── */}
            {layerType === 'regionOdGraph' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>지역 OD 관계 그래프</span>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>노드(보라색 원) = 지역(줌에 따라 시도/시군구/읍면동), 크기 = 해당 지역이 출발·도착으로 관여한 차량 수. 엣지(곡선) 굵기 = 두 지역 간 통행량.</span>
                    </div>
                </>
            )}

            {/* ── 혼잡 전파 그래프 ── */}
            {layerType === 'congestionGraph' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>혼잡 전파 그래프</span>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>노드 = V/C 임계값(0.7) 이상인 정체 링크(색=LOS 등급). 엣지 = 네트워크 회전 연결로 직접 이어진 정체 링크끼리 연결 — 실제 충격파(shockwave) 해석이 아니라 인접 정체 구간을 보여주는 근사입니다.</span>
                    </div>
                </>
            )}

            {/* ── 등시선 접근성 지도 ── */}
            {layerType === 'isochrone' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>시설 서비스권 분석 (영향권)</span>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>버스정류장·철도역 전체에서 아래 시간 안에 도달 가능한 도로를 자동으로 계산해 겹쳐 보여줍니다 — 클릭 불필요.</span>
                    </div>
                    <SliderRow
                        label="서비스권 시간"
                        min={5} max={30} step={1}
                        value={isochrone.maxMinutes}
                        display={`${isochrone.maxMinutes}분`}
                        onChange={(v) => {
                            setIsochrone({ maxMinutes: v });
                            applyToLayers((l) => {
                                if (typeof l.setMaxMinutes === 'function') l.setMaxMinutes(v);
                            });
                        }}
                    />
                    <div className={styles.sectionDivider} />
                    <ColorBar colormap={["#9ca3af", ...[0.3, 0.6, 1.0].map((t) => coverageColorHex(t, 1))]} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>사각지대(회색)</span>
                        <span className={styles.settingValue}>여러 시설 중복 커버(진한 청록)</span>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>점: 주황=버스정류장, 남색=철도역</span>
                    </div>
                    <div className={styles.sectionDivider} />
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>자유흐름속도 + 혼잡도(V/C) 근사 감속 기반 추정입니다 — 실제 교통배정/HCM 모델이 아닙니다.</span>
                    </div>
                </>
            )}

            {/* ── 병목 링크 ── */}
            {layerType === 'bottleneck' && (
                <>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>병목 링크</span>
                    </div>
                    <div className={styles.settingRow}>
                        <span className={styles.settingValue}>현재 화면 내 V/C ratio 상위 링크를 굵은 빨간선으로 강조 표시합니다.</span>
                    </div>
                </>
            )}
        </div>
    );
};

export default LayerSettingPopup;
