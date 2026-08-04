import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { useNextSimReadinessStore } from '@stores/useNextSimReadinessStore';
import { useSimulationScenarioStore } from '@stores/useSimulationScenarioStore';
import { useMessageStore } from '@stores/useMessageStore';
import { NEXTSIM_REQUIRED_KEYS, NEXTSIM_REQUIRED_LABELS } from '@utils/nextSimValidation';
import { NEXTSIM_PHASES } from '@utils/nextsimPhases';
import { getActiveVersionId } from '@utils/versionId';
import {
    useNextSimRunStore, checkNextSimAvailable, startNextSimRun, cancelNextSimRun, formatElapsed, formatEta,
} from '@utils/nextsim';

const KEYS = Array.from(NEXTSIM_REQUIRED_KEYS);

/** scenario.xml이 없을 때 NextSimRunner가 자동 생성하는 기본값과 반드시 일치시킨다
 *  (NextSimRunner.java stageInputs — copyOptional 실패 시 폴백) — 아직 한 번도
 *  저장한 적 없는 시나리오에서 이 배지가 보여주는 값이 실제 실행값과 다르면 혼란만 준다. */
const DEFAULT_SCEN_START_TIME = '06:00:00';
const DEFAULT_SCEN_DURATION = 60;
const DEFAULT_SCEN_BGT_DURATION = 0;

const NextSimReadinessBadge: React.FC = () => {
    const [open, setOpen] = useState(false);
    const validation = useNextSimReadinessStore((s) => s.validation);
    const runAll = useNextSimReadinessStore((s) => s.runAll);

    // NextSim 실행 — 준비 상태를 확인하는 이 배지가 실행 버튼의 자연스러운 위치
    // (개별 편집창마다 실행 버튼을 두면 중복·불일치 소지 — 여기 한 곳으로 통일).
    const versionId    = getActiveVersionId() ?? '';
    const nsAvailable  = useNextSimRunStore((s) => s.available);
    const nsRunning    = useNextSimRunStore((s) => s.runningVersionId) === versionId;
    const nsChecking   = useNextSimRunStore((s) => s.checking);
    const nsStage      = useNextSimRunStore((s) => s.stage);
    const nsStepKey    = useNextSimRunStore((s) => s.stepKey);
    const nsElapsed    = useNextSimRunStore((s) => s.elapsedSeconds);
    const nsBeat       = useNextSimRunStore((s) => s.sinceOutputSeconds);
    const nsProgress   = useNextSimRunStore((s) => s.progressPercent);
    const nsEta        = useNextSimRunStore((s) => s.etaSeconds);
    const nsError      = useNextSimRunStore((s) => s.lastError);
    // 크래시 복구 등으로 실제 소요가 이력을 넘어서면 99%/0초에서 멈춘다(폭주 방지, 백엔드 클램프) —
    // 이 상태를 "멈춘 것"으로 오인하지 않도록 문구를 바꿔준다.
    const nsOverrun    = nsProgress === 99 && nsEta === 0;
    useEffect(() => { void checkNextSimAvailable(); }, []);

    // ── 시뮬레이션 시간 설정(scenario.xml — 실행 직전 이 배지에서 바로 입력) ──────
    // 예전엔 편집 전용 메뉴(SIMULATION_SCENARIO)가 따로 있었으나, 그 데이터가 "독립 화면이
    // 아니라 시나리오 실행 흐름에서 관리되어야 할 성격"이라 판단돼 메뉴를 없앴다
    // (database/menu_restructure_migration.sql 2026-07-21 — 대체 UI는 "별도 작업"으로 미뤄짐).
    // 이 배지가 바로 그 실행 흐름의 자연스러운 위치라 여기서 입력받는다.
    const [scenStartTime, setScenStartTime] = useState(DEFAULT_SCEN_START_TIME);
    const [scenDuration, setScenDuration] = useState(DEFAULT_SCEN_DURATION);
    const [scenBgtDuration, setScenBgtDuration] = useState(DEFAULT_SCEN_BGT_DURATION);
    const [scenSaving, setScenSaving] = useState(false);
    // 이 UI에서 편집하지 않는 필드(odMatrixID/todID/id) — 서버에 이미 저장된 값을 그대로 보존.
    // OD 매트릭스/신호 TOD는 각자의 전용 메뉴에서 관리되므로 여기서 덮어쓰면 안 된다.
    const preservedRef = useRef({ id: 0, odMatrixID: 0, todID: 0 });

    useEffect(() => {
        if (!versionId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await axiosInstance.get(`/simulation-scenario/${versionId}`);
                const sc = (res.data as any)?.scenarios?.[0];
                if (!sc || cancelled) return;
                setScenStartTime(sc.startTime ?? DEFAULT_SCEN_START_TIME);
                setScenDuration(sc.duration ?? DEFAULT_SCEN_DURATION);
                setScenBgtDuration(sc.bgtDuration ?? DEFAULT_SCEN_BGT_DURATION);
                preservedRef.current = { id: sc.id ?? 0, odMatrixID: sc.odMatrixID ?? 0, todID: sc.todID ?? 0 };
                useSimulationScenarioStore.getState().setCurrentJsonData(res.data);
            } catch (_) {
                // 404 등 — 아직 scenario.xml을 저장한 적 없음. 위 기본값 상태 유지
                // (NextSimRunner도 실행 시 동일한 기본값으로 scenario.xml을 자동 생성한다).
            }
        })();
        return () => { cancelled = true; };
    }, [versionId]);

    /** 실행 직전 scenario.xml을 지금 입력된 값으로 저장한 뒤 실행 — 저장 실패 시 실행하지
     *  않는다(저장이 실패했는데 옛 scenario.xml로 조용히 실행되면 사용자가 바꾼 시간이
     *  반영 안 된 채 돌아가는 걸 눈치채기 어렵다). */
    const handleRun = async () => {
        if (!(scenDuration > 0)) {
            useMessageStore.getState().setMessage({ type: 'warn', text: '시뮬레이션 시간(분)은 0보다 커야 합니다.' });
            return;
        }
        setScenSaving(true);
        const payload = {
            scenarios: [{
                id: preservedRef.current.id,
                startTime: scenStartTime,
                duration: scenDuration,
                bgtDuration: scenBgtDuration,
                odMatrixID: preservedRef.current.odMatrixID,
                todID: preservedRef.current.todID,
            }],
        };
        try {
            await axiosInstance.post(`/simulation-scenario/${versionId}`, { data: payload, logs: {} });
            useSimulationScenarioStore.getState().setCurrentJsonData(payload);
        } catch (e: any) {
            useMessageStore.getState().setMessage({
                type: 'error',
                text: `시뮬레이션 시간 설정 저장 실패 — 실행하지 않았습니다: ${e?.message ?? e}`,
            });
            setScenSaving(false);
            return;
        }
        setScenSaving(false);
        void startNextSimRun(versionId);
    };

    const anyLoading = KEYS.some((k) => validation[k]?.loading);
    const anyChecked = KEYS.some((k) => validation[k]?.ok !== undefined);
    const anyWarn = KEYS.some((k) => validation[k]?.ok === false);
    const nsReady = KEYS.every((k) => validation[k]?.ok === true);
    const nsIssues = KEYS.flatMap((k) =>
        validation[k]?.ok === false ? (validation[k]?.issues ?? []).map((i) => `${NEXTSIM_REQUIRED_LABELS[k] ?? k}: ${i}`) : []
    );

    const color = nsRunning ? 'var(--accent-text)' : anyLoading ? 'var(--text-muted)' : anyWarn ? 'var(--color-danger)' : anyChecked ? 'var(--color-success)' : 'var(--text-muted)';
    const icon = nsRunning ? '▶' : anyLoading ? '…' : anyWarn ? '⚠' : anyChecked ? '✓' : '●';

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
                onClick={() => setOpen((o) => !o)}
                title="NextSim 실행 필수 데이터 준비 상태"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', marginRight: 8, borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${color}`, background: 'transparent',
                    color, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', height: 26,
                }}
            >
                {icon} NextSim
            </button>
            {open && (
                <>
                    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2100 }} />
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'absolute', top: 32, right: 0, zIndex: 2101, width: 270,
                            background: 'rgba(var(--surface-popover-rgb),0.98)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(var(--overlay-rgb),0.12)', borderRadius: 8,
                            padding: '8px 10px', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>NextSim 준비 상태</span>
                            <button onClick={runAll} disabled={anyLoading} style={validateBtnStyle}>
                                {anyLoading ? '검증중...' : '전체 검증'}
                            </button>
                        </div>
                        <div style={{ marginTop: 4 }}>
                            {KEYS.map((key) => {
                                const v = validation[key];
                                const kIcon = v?.loading ? '…' : v?.ok === true ? '✓' : v?.ok === false ? '⚠' : '·';
                                const kColor = v?.loading ? 'var(--text-muted)' : v?.ok === true ? 'var(--color-success)' : v?.ok === false ? 'var(--color-danger)' : 'var(--text-muted)';
                                const countSuffix = v?.ok === false ? ` ${v.issues?.length ?? 0}건` : '';
                                return (
                                    <span key={key} style={{ color: kColor, fontSize: 11, marginRight: 10, fontWeight: 600 }}>
                                        {kIcon} {NEXTSIM_REQUIRED_LABELS[key] ?? key}{countSuffix}
                                    </span>
                                );
                            })}
                        </div>
                        {KEYS.flatMap((key) => {
                            const v = validation[key];
                            if (!v || v.ok !== false) return [];
                            return (v.issues ?? []).map((issue, i) => (
                                <div key={`${key}-${i}`} style={{ marginTop: 3, fontSize: 10, color: 'var(--color-danger)' }}>
                                    · {NEXTSIM_REQUIRED_LABELS[key] ?? key}: {issue}
                                </div>
                            ));
                        })}

                        {/* ── NextSim 실행 — 준비 상태를 확인하는 이 배지가 실행 버튼의 위치 ── */}
                        {versionId && nsAvailable === true && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(var(--overlay-rgb),0.08)' }}>
                                {!nsRunning ? (
                                    <>
                                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={scenLabelStyle}>시작 시각</div>
                                                <input type="text" value={scenStartTime}
                                                       onChange={(e) => setScenStartTime(e.target.value)}
                                                       placeholder="06:00:00" title="시작 시각 (HH:mm:ss)"
                                                       style={scenInputStyle} />
                                            </div>
                                            <div>
                                                <div style={scenLabelStyle}>시간(분)</div>
                                                <input type="number" min={1} value={scenDuration}
                                                       onChange={(e) => setScenDuration(Number(e.target.value))}
                                                       title="시뮬레이션 시간 (분)" style={{ ...scenInputStyle, width: 52 }} />
                                            </div>
                                            <div>
                                                <div style={scenLabelStyle}>워밍업(분)</div>
                                                <input type="number" min={0} value={scenBgtDuration}
                                                       onChange={(e) => setScenBgtDuration(Number(e.target.value))}
                                                       title="워밍업 시간 (분)" style={{ ...scenInputStyle, width: 52 }} />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void handleRun()}
                                            disabled={anyLoading || !nsReady || nsChecking || scenSaving}
                                            style={runBtnStyle(anyLoading || !nsReady || nsChecking || scenSaving)}
                                            title={
                                                nsChecking ? '실행 상태 확인 중...'
                                                    : anyLoading ? 'NextSim 필수 데이터 확인 중...'
                                                    : !nsReady ? `필수 데이터에 문제가 있어 실행할 수 없습니다:\n${nsIssues.join('\n')}`
                                                        : 'NextSim 시뮬레이션을 실행합니다'
                                            }
                                        >
                                            {scenSaving ? '설정 저장 중...' : '▶ NextSim 실행'}
                                        </button>
                                    </>
                                ) : (
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ flex: 1, fontSize: 11, color: 'rgba(var(--accent-text-rgb),0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {nsOverrun ? '예상 시간을 초과했습니다 — 계속 진행 중' : (nsStage || '준비 중...')} · {formatElapsed(nsElapsed)}
                                                {!nsOverrun && nsEta != null ? ` · 약 ${formatEta(nsEta)} 남음` : ''}
                                                {nsBeat > 10 ? ` · 출력 ${nsBeat}초 전` : ''}
                                            </span>
                                            <button onClick={() => void cancelNextSimRun(versionId)} style={cancelBtnStyle}
                                                    title="진행 중인 시뮬레이션을 중단합니다">
                                                취소
                                            </button>
                                        </div>
                                        <div
                                            style={progressTrackStyle}
                                            title={nsProgress == null ? '첫 실행 — 예상 시간 없음' : undefined}
                                        >
                                            {nsProgress != null ? (
                                                <div style={{ ...progressFillStyle, width: `${nsProgress}%` }} />
                                            ) : (
                                                <div style={progressIndeterminateStyle} />
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
                                            {NEXTSIM_PHASES.map((p, i) => {
                                                const curIdx = NEXTSIM_PHASES.findIndex((x) => x.key === nsStepKey);
                                                const phaseState = curIdx < 0 ? 'pending' : i < curIdx ? 'done' : i === curIdx ? 'current' : 'pending';
                                                const icon = phaseState === 'done' ? '✓' : phaseState === 'current' ? '▶' : '·';
                                                const color = phaseState === 'done' ? 'var(--color-success)' : phaseState === 'current' ? 'var(--accent-text)' : 'var(--text-disabled)';
                                                return (
                                                    <span key={p.key} style={{ fontSize: 10, color, fontWeight: phaseState === 'current' ? 600 : 400 }}>
                                                        {icon} {p.label}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {!nsRunning && nsError && (
                                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-warning)', whiteSpace: 'pre-wrap' }}>
                                        NextSim {nsError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

const validateBtnStyle: React.CSSProperties = {
    background: 'rgba(var(--accent-text-rgb),0.12)',
    border: '1px solid rgba(var(--accent-text-rgb),0.3)',
    color: 'var(--accent-text)',
    cursor: 'pointer',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 4,
    flexShrink: 0,
};

const scenLabelStyle: React.CSSProperties = {
    fontSize: 9, color: 'var(--text-muted)', marginBottom: 2,
};

const scenInputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '3px 5px',
    borderRadius: 4, border: '1px solid rgba(var(--overlay-rgb),0.14)',
    background: 'rgba(var(--overlay-rgb),0.04)', color: 'var(--text-secondary)',
};

const runBtnStyle = (disabled: boolean): React.CSSProperties => ({
    width: '100%', padding: '5px 0', fontSize: 11, borderRadius: 5,
    cursor: disabled ? 'default' : 'pointer', fontWeight: 600, transition: 'all 0.15s',
    background: disabled ? 'rgba(var(--overlay-rgb),0.03)' : 'rgba(var(--color-success-rgb),0.18)',
    border: `1px solid ${disabled ? 'rgba(var(--overlay-rgb),0.08)' : 'rgba(var(--color-success-rgb),0.45)'}`,
    color: disabled ? 'rgba(var(--overlay-rgb),0.35)' : 'var(--color-success)',
});

const cancelBtnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(var(--color-danger-rgb),0.12)', border: '1px solid rgba(var(--color-danger-rgb),0.35)', color: 'var(--color-danger)',
    flexShrink: 0,
};

const progressTrackStyle: React.CSSProperties = {
    height: 4, marginTop: 6, borderRadius: 2, overflow: 'hidden',
    background: 'rgba(var(--overlay-rgb),0.08)',
};

const progressFillStyle: React.CSSProperties = {
    height: '100%', borderRadius: 2, background: 'var(--accent-text)', transition: 'width 0.5s ease',
};

/** 이력 없어 진행률을 모를 때(첫 실행) — 채워지는 바 대신 정적 줄무늬로 "예상 불가"를 표시 */
const progressIndeterminateStyle: React.CSSProperties = {
    height: '100%', width: '100%',
    background: 'repeating-linear-gradient(45deg, rgba(var(--accent-text-rgb),0.35) 0 6px, transparent 6px 12px)',
};

export default NextSimReadinessBadge;
