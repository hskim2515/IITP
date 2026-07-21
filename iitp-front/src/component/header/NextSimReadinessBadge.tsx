import React, { useEffect, useState } from 'react';
import { useNextSimReadinessStore } from '@stores/useNextSimReadinessStore';
import { NEXTSIM_REQUIRED_KEYS, NEXTSIM_REQUIRED_LABELS } from '@utils/nextSimValidation';
import { getActiveVersionId } from '@utils/versionId';
import {
    useNextSimRunStore, checkNextSimAvailable, startNextSimRun, cancelNextSimRun, formatElapsed,
} from '@utils/nextsim';

const KEYS = Array.from(NEXTSIM_REQUIRED_KEYS);

const NextSimReadinessBadge: React.FC = () => {
    const [open, setOpen] = useState(false);
    const validation = useNextSimReadinessStore((s) => s.validation);
    const runAll = useNextSimReadinessStore((s) => s.runAll);

    // NextSim 실행 — 준비 상태를 확인하는 이 배지가 실행 버튼의 자연스러운 위치
    // (개별 편집창마다 실행 버튼을 두면 중복·불일치 소지 — 여기 한 곳으로 통일).
    const versionId    = getActiveVersionId() ?? '';
    const nsAvailable  = useNextSimRunStore((s) => s.available);
    const nsRunning    = useNextSimRunStore((s) => s.runningVersionId) === versionId;
    const nsStage      = useNextSimRunStore((s) => s.stage);
    const nsElapsed    = useNextSimRunStore((s) => s.elapsedSeconds);
    const nsBeat       = useNextSimRunStore((s) => s.sinceOutputSeconds);
    const nsError      = useNextSimRunStore((s) => s.lastError);
    useEffect(() => { void checkNextSimAvailable(); }, []);

    const anyLoading = KEYS.some((k) => validation[k]?.loading);
    const anyChecked = KEYS.some((k) => validation[k]?.ok !== undefined);
    const anyWarn = KEYS.some((k) => validation[k]?.ok === false);
    const nsReady = KEYS.every((k) => validation[k]?.ok === true);
    const nsIssues = KEYS.flatMap((k) =>
        validation[k]?.ok === false ? (validation[k]?.issues ?? []).map((i) => `${NEXTSIM_REQUIRED_LABELS[k] ?? k}: ${i}`) : []
    );

    const color = nsRunning ? '#7aa2ff' : anyLoading ? '#888' : anyWarn ? '#ff4757' : anyChecked ? '#2ed573' : '#888';
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
                            background: 'rgba(13,15,24,0.98)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                            padding: '8px 10px', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ flex: 1, fontSize: 11, color: '#999' }}>NextSim 준비 상태</span>
                            <button onClick={runAll} disabled={anyLoading} style={validateBtnStyle}>
                                {anyLoading ? '검증중...' : '전체 검증'}
                            </button>
                        </div>
                        <div style={{ marginTop: 4 }}>
                            {KEYS.map((key) => {
                                const v = validation[key];
                                const kIcon = v?.loading ? '…' : v?.ok === true ? '✓' : v?.ok === false ? '⚠' : '·';
                                const kColor = v?.loading ? '#888' : v?.ok === true ? '#2ed573' : v?.ok === false ? '#ff4757' : '#888';
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
                                <div key={`${key}-${i}`} style={{ marginTop: 3, fontSize: 10, color: '#ff4757' }}>
                                    · {NEXTSIM_REQUIRED_LABELS[key] ?? key}: {issue}
                                </div>
                            ));
                        })}

                        {/* ── NextSim 실행 — 준비 상태를 확인하는 이 배지가 실행 버튼의 위치 ── */}
                        {versionId && nsAvailable === true && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                {!nsRunning ? (
                                    <button
                                        onClick={() => void startNextSimRun(versionId)}
                                        disabled={anyLoading || !nsReady}
                                        style={runBtnStyle(anyLoading || !nsReady)}
                                        title={
                                            anyLoading ? 'NextSim 필수 데이터 확인 중...'
                                                : !nsReady ? `필수 데이터에 문제가 있어 실행할 수 없습니다:\n${nsIssues.join('\n')}`
                                                    : 'NextSim 시뮬레이션을 실행합니다'
                                        }
                                    >
                                        ▶ NextSim 실행
                                    </button>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ flex: 1, fontSize: 11, color: '#7da7d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {nsStage || '준비 중...'} · {formatElapsed(nsElapsed)}
                                            {nsBeat > 10 ? ` · 출력 ${nsBeat}초 전` : ''}
                                        </span>
                                        <button onClick={() => void cancelNextSimRun(versionId)} style={cancelBtnStyle}
                                                title="진행 중인 시뮬레이션을 중단합니다">
                                            취소
                                        </button>
                                    </div>
                                )}
                                {!nsRunning && nsError && (
                                    <div style={{ marginTop: 6, fontSize: 10, color: '#ff9f43', whiteSpace: 'pre-wrap' }}>
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
    background: 'rgba(122,162,255,0.12)',
    border: '1px solid rgba(122,162,255,0.3)',
    color: '#7aa2ff',
    cursor: 'pointer',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 4,
    flexShrink: 0,
};

const runBtnStyle = (disabled: boolean): React.CSSProperties => ({
    width: '100%', padding: '5px 0', fontSize: 11, borderRadius: 5,
    cursor: disabled ? 'default' : 'pointer', fontWeight: 600, transition: 'all 0.15s',
    background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(0,180,100,0.18)',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : 'rgba(60,210,140,0.45)'}`,
    color: disabled ? '#444' : '#4ecb8d',
});

const cancelBtnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,90,90,0.35)', color: '#e08585',
    flexShrink: 0,
};

export default NextSimReadinessBadge;
