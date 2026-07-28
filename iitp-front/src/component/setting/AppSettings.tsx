import React, { useEffect } from 'react';
import { useAppSettingsStore } from '@stores/useAppSettingsStore';
import { useLayerSchemaStore } from '@stores/useLayerSchemaStore';
import styles from '@css/ToolsPanel.module.css';

/** LayerSettingPopup의 SliderRow와 동일 패턴(레이블 + range + 값 표시) — 설정 팝업 전반에서
 *  재사용되는 시각 언어라 그대로 맞춤. */
const SliderRow = ({ label, min, max, step, value, onChange, display }: {
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

/**
 * 앱 전역 설정(⚙ 설정 팝업) — 시나리오/버전과 무관하게 이 브라우저에 저장되는 개인 취향 설정.
 * 이전엔 이 팝업이 QA용 "테스트 설정"(더미 차량 속도/대수 슬라이더, 실사용자에게 무의미)만
 * 있었는데, 실제로 쓸모 있는 설정으로 교체:
 *   - 배경지도 기본값: 지금까지는 서버 스키마의 basic 필드로만 정해져 사용자가 바꿀 수 없었음.
 *   - 자동생성 설정(더미 신호): 향후 다른 자동생성 기능(노면표시 등)의 파라미터도 같은 자리에
 *     묶어 넣을 자리로 마련 — useAppSettingsStore.autoGeneration 참고.
 * (편집 중 자동저장 주기 설정은 한 번 검토했다가 제외했다 — 사용자가 명시적으로 저장하지 않은
 *  변경을 물어보지도 않고 강제로 저장해버리는 건 잘못된 동작이라 판단, useNetworkDraw.ts의
 *  주기적 체크포인트 저장 자체를 제거함.)
 */
const AppSettings: React.FC = () => {
    const defaultBaseMap = useAppSettingsStore((s) => s.defaultBaseMap);
    const setDefaultBaseMap = useAppSettingsStore((s) => s.setDefaultBaseMap);
    const autoGeneration = useAppSettingsStore((s) => s.autoGeneration);
    const setAutoGeneration = useAppSettingsStore((s) => s.setAutoGeneration);
    const resetAutoGeneration = useAppSettingsStore((s) => s.resetAutoGeneration);

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();
    useEffect(() => { if (!loading) fetchLayerSchema(); }, []);
    const baseMapFields = groups.find((g) => g.key === 'baseMap')?.layers ?? [];

    return (
        <div>
            <div className={styles.sectionLabel} style={{ cursor: 'default' }}>배경지도 기본값</div>
            <div style={{ padding: '0 4px 4px' }}>
                <label className={styles.layerItem}>
                    <input
                        type="radio"
                        name="defaultBaseMap"
                        checked={defaultBaseMap === null}
                        onChange={() => setDefaultBaseMap(null)}
                    />
                    (서버 기본값 사용)
                </label>
                {baseMapFields.map((field) => (
                    <label key={field.key} className={styles.layerItem}>
                        <input
                            type="radio"
                            name="defaultBaseMap"
                            checked={defaultBaseMap === field.key}
                            onChange={() => setDefaultBaseMap(field.key)}
                        />
                        {field.label}
                    </label>
                ))}
            </div>

            <div className={styles.sectionDivider} />

            <div className={styles.sectionLabel} style={{ cursor: 'default' }}>자동생성 설정 — 더미 신호</div>
            <div style={{ padding: '0 4px 4px' }}>
                <SliderRow
                    label="현시(phase) 길이"
                    min={10} max={90} step={5}
                    value={autoGeneration.signalPhaseDurationSec}
                    onChange={(v) => setAutoGeneration({ signalPhaseDurationSec: v })}
                    display={`${autoGeneration.signalPhaseDurationSec}초`}
                />
                <SliderRow
                    label="마주보는 방향 판정 허용오차"
                    min={10} max={60} step={5}
                    value={autoGeneration.signalOppositeBearingToleranceDeg}
                    onChange={(v) => setAutoGeneration({ signalOppositeBearingToleranceDeg: v })}
                    display={`±${autoGeneration.signalOppositeBearingToleranceDeg}°`}
                />
                <div style={{ fontSize: 10, color: '#666', padding: '2px 0 6px', lineHeight: 1.4 }}>
                    허용오차를 넓히면 실제로는 마주보지 않는(교차하는) 접근로까지 "안전"으로 판단할
                    수 있습니다 — 수동 편집 상충 경고에도 같은 값이 쓰입니다.
                </div>
                <div className={styles.formActions}>
                    <button className={styles.formBtnGhost} onClick={resetAutoGeneration}>
                        기본값으로 초기화
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AppSettings;
