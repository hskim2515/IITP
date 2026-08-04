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
    const theme = useAppSettingsStore((s) => s.theme);
    const setTheme = useAppSettingsStore((s) => s.setTheme);
    const autoGeneration = useAppSettingsStore((s) => s.autoGeneration);
    const setAutoGeneration = useAppSettingsStore((s) => s.setAutoGeneration);
    const resetAutoGeneration = useAppSettingsStore((s) => s.resetAutoGeneration);

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();
    useEffect(() => { if (!loading) fetchLayerSchema(); }, []);
    const baseMapFields = groups.find((g) => g.key === 'baseMap')?.layers ?? [];

    return (
        <div>
            {/* 헤더의 토글 버튼(빠른 원클릭용)과 동일한 theme 필드를 읽고 쓴다 — 항상 일치.
             *  여기 라디오는 설정 팝업을 켠 김에 명시적으로 고르고 싶은 사용자를 위한 보조 창구. */}
            <div className={styles.sectionLabel} style={{ cursor: 'default' }}>테마</div>
            <div style={{ padding: '0 4px 4px' }}>
                <label className={styles.layerItem}>
                    <input
                        type="radio"
                        name="theme"
                        checked={theme === 'dark'}
                        onChange={() => setTheme('dark')}
                    />
                    다크
                </label>
                <label className={styles.layerItem}>
                    <input
                        type="radio"
                        name="theme"
                        checked={theme === 'light'}
                        onChange={() => setTheme('light')}
                    />
                    라이트
                </label>
            </div>

            <div className={styles.sectionDivider} />

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

            <div className={styles.sectionLabel} style={{ cursor: 'default' }}>자동생성 설정</div>
            <div style={{ padding: '0 4px 4px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px 2px' }}>
                    더미 신호
                </div>
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
                <div style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.4)', padding: '2px 0 6px', lineHeight: 1.4 }}>
                    허용오차를 넓히면 실제로는 마주보지 않는(교차하는) 접근로까지 "안전"으로 판단할
                    수 있습니다 — 수동 편집 상충 경고에도 같은 값이 쓰입니다.
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '8px 6px 2px' }}>
                    OD 매트릭스 (KTDB 임포트 시 서버가 생성하는 샘플 수요)
                </div>
                <SliderRow
                    label="최소 flow"
                    min={1} max={50} step={1}
                    value={autoGeneration.odMinFlow}
                    onChange={(v) => setAutoGeneration({ odMinFlow: Math.min(v, autoGeneration.odMaxFlow - 1) })}
                    display={`${autoGeneration.odMinFlow} 대/h`}
                />
                <SliderRow
                    label="최대 flow"
                    min={10} max={200} step={5}
                    value={autoGeneration.odMaxFlow}
                    onChange={(v) => setAutoGeneration({ odMaxFlow: Math.max(v, autoGeneration.odMinFlow + 1) })}
                    display={`${autoGeneration.odMaxFlow} 대/h`}
                />
                <SliderRow
                    label="거리 감쇠 기준 거리"
                    min={50} max={1000} step={50}
                    value={autoGeneration.odRefDistM}
                    onChange={(v) => setAutoGeneration({ odRefDistM: v })}
                    display={`${autoGeneration.odRefDistM}m`}
                />
                <div style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.4)', padding: '2px 0 6px', lineHeight: 1.4 }}>
                    source-sink 거리가 기준 거리 이내면 최대 flow에 가깝게, 멀수록 최소 flow로
                    수렴합니다. 실제 임포트 시점에만 적용되며, 다음 KTDB 가져오기부터 반영됩니다.
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '8px 6px 2px' }}>
                    노면표시 / 버스 / 철도
                </div>
                <label className={styles.layerItem}>
                    <input
                        type="checkbox"
                        checked={autoGeneration.pavementMarkingEnabled}
                        onChange={(e) => setAutoGeneration({ pavementMarkingEnabled: e.target.checked })}
                    />
                    노면표시 자동생성 (임포트/온보딩 완료 시)
                </label>
                <label className={styles.layerItem}>
                    <input
                        type="checkbox"
                        checked={autoGeneration.busFacilityEnabled}
                        onChange={(e) => setAutoGeneration({ busFacilityEnabled: e.target.checked })}
                    />
                    버스 정류장/노선 자동생성 (KTDB 임포트 시)
                </label>
                <label className={styles.layerItem}>
                    <input
                        type="checkbox"
                        checked={autoGeneration.railFacilityEnabled}
                        onChange={(e) => setAutoGeneration({ railFacilityEnabled: e.target.checked })}
                    />
                    철도역/노선 자동생성 (KTDB 임포트 시)
                </label>
                <SliderRow
                    label="버스 기본 배차간격"
                    min={5} max={60} step={5}
                    value={autoGeneration.busDefaultIntervalMin}
                    onChange={(v) => setAutoGeneration({ busDefaultIntervalMin: v })}
                    display={`${autoGeneration.busDefaultIntervalMin}분`}
                />
                <div style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.4)', padding: '2px 0 6px', lineHeight: 1.4 }}>
                    OSM에는 배차간격 정보가 없어 변환된 모든 버스 노선에 이 값을 일괄로 채웁니다.
                    철도는 실제 시간표가 없는 노선을 임의로 지어내지 않도록 배차간격을 항상 비워둡니다
                    (철도 노선 편집 화면에서 직접 입력).
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
