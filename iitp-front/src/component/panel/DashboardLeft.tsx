import React, { useMemo } from 'react';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useSignalTimelineStore } from '@stores/useSignalTimelineStore';
import { JulianDate } from 'cesium';
import styles from '@css/Dashboard.module.css';
import { useLayerStore } from '@stores/useLayerStore';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface Props {
    onClose: () => void;
}

const LAYER_LABELS: Record<string, string> = {
    heatmap: '히트맵',
    trip: '차량 경로',
    od: 'OD 매트릭스',
    vehicle: '차량',
    signal: '신호',
    network: '네트워크',
    busStation: '버스 정류장',
    railStation: '철도 역',
    pavementMarking: '노면마킹',
};

const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className={styles.chartTooltip}>
            <div className={styles.chartTooltipLabel}>{label}</div>
            {payload.map((p: any, i: number) => (
                <div key={i} className={styles.chartTooltipRow}>
                    <span className={styles.chartTooltipDot} style={{ background: p.color }}/>
                    <span className={styles.chartTooltipName}>{p.name}</span>
                    <span className={styles.chartTooltipValue}>{p.value?.toLocaleString()}</span>
                </div>
            ))}
        </div>
    );
};

// ─── Component ────────────────────────────────────────────────
const DashboardLeft: React.FC<Props> = ({ onClose }) => {
    const { isRunning, speed, startTime, endTime, currentTime } = useSimulationStore();
    const activeVehicleCount = useVehicleStore((s) => s.activeVehicleCount);
    const activeLayerName = useLayerStore((s) => s.activeLayerName);
    const updateLogs = useNetworkHistoryStore((s) => s.updateLogs);
    const selectedScenario = useScenarioStore((s) => s.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const signalTimeline = useSignalTimelineStore((s) => s.signalTimeline);
    const historyChartData = useMemo(() =>
            updateLogs.slice(-10).map((log) => ({
                time: new Date(log.timestamp).toLocaleTimeString('ko-KR', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                }),
                추가: log.json.added?.length ?? 0,
                수정: log.json.modified?.length ?? 0,
                삭제: log.json.deleted?.length ?? 0,
            })),
        [updateLogs]
    );

    // const totalChanges = useMemo(() =>
    //         updateLogs.reduce(
    //             (acc, log) => ({
    //                 added: acc.added + (log.json.added?.length ?? 0),
    //                 modified: acc.modified + (log.json.modified?.length ?? 0),
    //                 deleted: acc.deleted + (log.json.deleted?.length ?? 0),
    //             }),
    //             { added: 0, modified: 0, deleted: 0 }
    //         ),
    //     [updateLogs]
    // );
    const networkData = useNetworkStore((s) => s.currentJsonData);

    const linkCount = networkData?.links?.length ?? 0;
    const nodeCount = networkData?.nodes?.length ?? 0;

    const formatTime = (jd?: JulianDate) => {
        if (!jd) return '--:--:--';
        try { return JulianDate.toDate(jd).toTimeString().split(' ')[0]; }
        catch { return '--:--:--'; }
    };

    const progress = useMemo(() => {
        if (!startTime || !endTime || !currentTime) return 0;
        const total = JulianDate.secondsDifference(endTime, startTime);
        const elapsed = JulianDate.secondsDifference(currentTime, startTime);
        return total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    }, [startTime, endTime, currentTime]);


    const totalChanges = useMemo(() =>
        updateLogs.reduce(
            (acc, log) => ({
                added: acc.added + (log.json.added?.length ?? 0),
                modified: acc.modified + (log.json.modified?.length ?? 0),
                deleted: acc.deleted + (log.json.deleted?.length ?? 0),
            }),
            { added: 0, modified: 0, deleted: 0 }
        ),
        [updateLogs]
    );
    const simulationLabel = isRunning ? '실행 중' : currentTime ? '일시정지' : '대기';

    const signalCount = signalTimeline?.length ?? 0;
    const greenCount = useMemo(() => {
        if (!signalTimeline?.length || !currentTime) return 0;
        const nowMs = JulianDate.toDate(currentTime).getTime();
        return signalTimeline.filter(node =>
            node.signalTimeline?.some(t =>
                t.signalState === 'green' &&
                new Date(t.startTime).getTime() <= nowMs &&
                new Date(t.endTime).getTime() >= nowMs
            )
        ).length;
    }, [signalTimeline, currentTime]);

    const speedLimitStats = useMemo(() => {
        if (!networkData?.links?.length) return [];
        const buckets: Record<string, number> = {};
        networkData.links.forEach((link: any) => {
            const spd = link.speedLimit ?? link.speed_limit ?? link.maxspeed ?? '?';
            const key = `${spd}`;
            buckets[key] = (buckets[key] ?? 0) + 1;
        });
        return Object.entries(buckets)
            .map(([speed, count]) => ({ speed, count }))
            .sort((a, b) => Number(a.speed) - Number(b.speed))
            .slice(0, 6);
    }, [networkData]);

    return (
        <div className={styles.leftCol}>

            {/* ── 시나리오 정보 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: '#7aa2ff' }}/>
                    <span className={styles.sectionTitle}>시나리오</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#666' }}>시나리오</span>
                        <span style={{ fontSize: 12, color: '#ddd', fontWeight: 500 }}>{selectedScenario?.label ?? '-'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#666' }}>버전</span>
                        <span style={{ fontSize: 12, color: '#7aa2ff' }}>{selectedScenarioVersion?.label ?? '-'}</span>
                    </div>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            <div className={styles.kpiGrid}>
                <div className={`${styles.kpiCard} ${styles.kpiBlue}`}>
                    <div className={styles.kpiLabel}>활성 차량</div>
                    <div className={styles.kpiValue}>{activeVehicleCount.toLocaleString()}</div>
                    <div className={styles.kpiUnit}>현재 운행 중</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.kpiGreen}`}>
                    <div className={styles.kpiLabel}>도로 링크</div>
                    <div className={styles.kpiValue}>{linkCount.toLocaleString()}</div>
                    <div className={styles.kpiUnit}>노드 {nodeCount.toLocaleString()}개</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.kpiAmber}`}>
                    <div className={styles.kpiLabel}>편집 세션</div>
                    <div className={styles.kpiValue}>{updateLogs.length.toLocaleString()}</div>
                    <div className={styles.kpiUnit}>총 {totalChanges.added + totalChanges.modified + totalChanges.deleted}건 변경</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.kpiPurple}`}>
                    <div className={styles.kpiLabel}>재생 속도</div>
                    <div className={styles.kpiValue}>{speed}<span className={styles.kpiValueSuffix}>x</span></div>
                    <div className={styles.kpiUnit}>배속 재생</div>
                </div>
                <div className={`${styles.kpiCard} ${isRunning ? styles.kpiCardActive : styles.kpiDefault}`}>
                    <div className={styles.kpiLabel}>시뮬레이션</div>
                    <div className={styles.kpiStatus}>
                        <span className={isRunning ? styles.dotRunning : styles.dotStopped}/>
                        {simulationLabel}
                    </div>
                    <div className={styles.kpiUnit}>{formatTime(startTime)} ~ {formatTime(endTime)}</div>
                </div>
            </div>

            {/* ── Progress Bar ── */}
            <div className={styles.progressSection}>
                <div className={styles.progressMeta}>
                    <span className={styles.progressLabel}>시뮬레이션 진행률</span>
                    <div className={styles.progressTimeGroup}>
                        <span className={styles.progressTimeCurrent}>{formatTime(currentTime)}</span>
                        <span className={styles.progressTimeSep}>/</span>
                        <span className={styles.progressTime}>{formatTime(endTime)}</span>
                        <span className={styles.progressPctBadge}>{progress.toFixed(1)}%</span>
                    </div>
                </div>
                <div className={styles.progressTrack}>
                    <div className={styles.progressFill} style={{ width: `${progress}%` }}/>
                    <div className={styles.progressGlow} style={{ left: `${progress}%` }}/>
                </div>
            </div>
            {/* ── 신호 현황 ── */}
            {signalCount > 0 && (
                <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent} style={{ background: '#10b981' }}/>
                        <span className={styles.sectionTitle}>신호 현황</span>
                        <span className={styles.sectionMeta}>교차로 {signalCount}개</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>{greenCount}</div>
                            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>녹색 진행</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444', fontVariantNumeric: 'tabular-nums' }}>{signalCount - greenCount}</div>
                            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>적색 정지</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(122,162,255,0.08)', border: '1px solid rgba(122,162,255,0.2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#ccc', fontVariantNumeric: 'tabular-nums' }}>{signalCount}</div>
                            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>전체</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 활성 레이어 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: '#4169E1' }}/>
                    <span className={styles.sectionTitle}>활성 레이어</span>
                    <span className={styles.sectionMeta}>{activeLayerName?.length ?? 0}개</span>
                </div>
                <div className={styles.layerList}>
                    {(!activeLayerName || activeLayerName.length === 0) ? (
                        <div className={styles.emptyText}>활성화된 레이어 없음</div>
                    ) : (
                        activeLayerName.map((name) => (
                            <div key={name} className={styles.layerItem}>
                                <span className={styles.layerDot}/>
                                <span>{LAYER_LABELS[name] ?? name}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── 속도 제한별 링크 분포 ── */}
            {speedLimitStats.length > 0 && (
                <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent} style={{ background: '#f59e0b' }}/>
                        <span className={styles.sectionTitle}>속도 제한별 링크</span>
                        <span className={styles.sectionMeta}>km/h</span>
                    </div>
                    <ResponsiveContainer width="100%" height={110}>
                        <BarChart data={speedLimitStats} margin={{ top: 2, right: 8, left: -22, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false}/>
                            <XAxis dataKey="speed" stroke="#333" tick={{ fontSize: 10, fill: '#555' }}/>
                            <YAxis stroke="#333" tick={{ fontSize: 10, fill: '#555' }}/>
                            <Tooltip content={<ChartTooltip/>}/>
                            <Bar dataKey="count" name="링크 수" fill="#f59e0b" radius={[3, 3, 0, 0]}/>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className={styles.mainGridSide}>
                <div className={styles.chartSection}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent}/>
                        <span className={styles.sectionTitle}>네트워크 편집 이력</span>
                        <span className={styles.sectionMeta}>최근 {historyChartData.length}회</span>
                    </div>
                    {historyChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={historyChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#222"/>
                                <XAxis dataKey="time" stroke="#333" tick={{ fontSize: 10, fill: '#666' }}/>
                                <YAxis stroke="#333" tick={{ fontSize: 10, fill: '#666' }}/>
                                <Tooltip content={<ChartTooltip/>}/>
                                <Legend wrapperStyle={{ fontSize: 11, color: '#666', paddingTop: 4 }}/>
                                <Bar dataKey="추가" fill="#10b981" radius={[3, 3, 0, 0]}/>
                                <Bar dataKey="수정" fill="#4169E1" radius={[3, 3, 0, 0]}/>
                                <Bar dataKey="삭제" fill="#ef4444" radius={[3, 3, 0, 0]}/>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className={styles.emptyChart}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>편집 이력이 없습니다</span>
                        </div>
                    )}
                    <div className={styles.changeSummary}>
                        <div className={styles.changeChip} style={{ color: '#10b981', borderColor: 'rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.08)' }}>
                            <span>+ 추가</span><strong>{totalChanges.added}</strong>
                        </div>
                        <div className={styles.changeChip} style={{ color: '#7aa2ff', borderColor: 'rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.08)' }}>
                            <span>≈ 수정</span><strong>{totalChanges.modified}</strong>
                        </div>
                        <div className={styles.changeChip} style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}>
                            <span>− 삭제</span><strong>{totalChanges.deleted}</strong>
                        </div>
                    </div>
                </div>

            </div>

            {/* ── 최근 편집 이력 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: '#f59e0b' }}/>
                    <span className={styles.sectionTitle}>최근 편집</span>
                    <span className={styles.sectionMeta}>{updateLogs.length}건</span>
                </div>
                <div className={styles.historyList}>
                    {updateLogs.length === 0 ? (
                        <div className={styles.emptyText}>편집 내역 없음</div>
                    ) : (
                        [...updateLogs].reverse().slice(0, 5).map((log, i) => {
                            const parts: string[] = [];
                            if (log.json.added?.length) parts.push(`+${log.json.added.length}`);
                            if (log.json.modified?.length) parts.push(`~${log.json.modified.length}`);
                            if (log.json.deleted?.length) parts.push(`-${log.json.deleted.length}`);
                            return (
                                <div key={i} className={styles.historyItem}>
                                    <div className={styles.historyItemLeft}>
                                        <div className={styles.historyDot}/>
                                    </div>
                                    <div className={styles.historyItemRight}>
                                        <span className={styles.historyTime}>
                                            {new Date(log.timestamp).toLocaleTimeString('ko-KR')}
                                        </span>
                                        <span className={styles.historyDesc}>
                                            {parts.join(' · ') || '변경 없음'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default DashboardLeft;
