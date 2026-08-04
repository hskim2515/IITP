import React, { useMemo } from 'react';
import { ConsolePanel } from '@component/console/ConsolePanel';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useSignalTimelineStore } from '@stores/useSignalTimelineStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useBusPtLineStore, useBusPtLineWeekdayStore, useBusPtLineWeekendStore } from '@stores/useBusPtLineStore';
import { useRailPtLineStore } from '@stores/useRailPtLineStore';
import { useSignalTodStore } from '@stores/useSignalTodStore';
import { useSimulationScenarioStore } from '@stores/useSimulationScenarioStore';
import { usePavementMarkingStore } from '@stores/usePavementMarkingStore';
import { JulianDate } from 'cesium';
import styles from '@css/Dashboard.module.css';
import { useLayerStore } from '@stores/useLayerStore';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { LAYER_LABELS, ChartTooltip } from './dashboardShared';

interface Props {
    onClose: () => void;
}

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
    const networkChanged = useNetworkStore((s) => s.isChanged);

    const linkCount = networkData?.links?.length ?? 0;
    const nodeCount = networkData?.nodes?.length ?? 0;

    // 시설물 현황
    const busStationData = useBusStationStore((s) => s.currentJsonData);
    const busStationChanged = useBusStationStore((s) => s.isChanged);
    const railStationData = useRailStationStore((s) => s.currentJsonData);
    const railStationChanged = useRailStationStore((s) => s.isChanged);
    const signalData = useSignalStore((s) => s.currentJsonData);
    const signalChanged = useSignalStore((s) => s.isChanged);
    const busPtLineData = useBusPtLineStore((s) => s.currentJsonData);
    const busPtLineChanged = useBusPtLineStore((s) => s.isChanged);
    const busPtLineWeekdayData = useBusPtLineWeekdayStore((s) => s.currentJsonData);
    const busPtLineWeekdayChanged = useBusPtLineWeekdayStore((s) => s.isChanged);
    const busPtLineWeekendData = useBusPtLineWeekendStore((s) => s.currentJsonData);
    const busPtLineWeekendChanged = useBusPtLineWeekendStore((s) => s.isChanged);
    const railPtLineData = useRailPtLineStore((s) => s.currentJsonData);
    const railPtLineChanged = useRailPtLineStore((s) => s.isChanged);
    const signalTodData = useSignalTodStore((s) => s.currentJsonData);
    const signalTodChanged = useSignalTodStore((s) => s.isChanged);
    const simScenarioData = useSimulationScenarioStore((s) => s.currentJsonData);
    const simScenarioChanged = useSimulationScenarioStore((s) => s.isChanged);
    const pavementMarkingData = usePavementMarkingStore((s) => s.currentJsonData);
    const pavementMarkingChanged = usePavementMarkingStore((s) => s.isChanged);

    const facilityStats = useMemo(() => [
        { label: '네트워크 링크', count: (networkData as any)?.links?.length ?? 0 },
        { label: '네트워크 노드', count: (networkData as any)?.nodes?.length ?? 0 },
        { label: '버스 정류장',   count: (busStationData as any)?.busStations?.length ?? 0 },
        { label: '철도 역',       count: (railStationData as any)?.railStations?.length ?? 0 },
        { label: '신호',          count: (signalData as any)?.signals?.length ?? 0 },
        { label: '신호 TOD',      count: (signalTodData as any)?.nodes?.length ?? 0 },
        { label: '버스 노선',     count: (busPtLineData as any)?.lines?.length ?? 0 },
        { label: '버스 노선(평일)',count: (busPtLineWeekdayData as any)?.lines?.length ?? 0 },
        { label: '버스 노선(주말)',count: (busPtLineWeekendData as any)?.lines?.length ?? 0 },
        { label: '철도 노선',     count: (railPtLineData as any)?.lines?.length ?? 0 },
        { label: '시뮬레이션 시나리오', count: (simScenarioData as any)?.scenarios?.length ?? 0 },
        { label: '노면 마킹',     count: (pavementMarkingData as any)?.pavementMarkings?.length ?? 0 },
    ].filter(s => s.count > 0), [networkData, busStationData, railStationData, signalData, signalTodData,
        busPtLineData, busPtLineWeekdayData, busPtLineWeekendData, railPtLineData, simScenarioData, pavementMarkingData]);

    const unsavedLayers = useMemo(() => {
        const layers: string[] = [];
        if (networkChanged) layers.push('네트워크');
        if (busStationChanged) layers.push('버스 정류장');
        if (railStationChanged) layers.push('철도 역');
        if (signalChanged) layers.push('신호');
        if (signalTodChanged) layers.push('신호 TOD');
        if (busPtLineChanged) layers.push('버스 노선');
        if (busPtLineWeekdayChanged) layers.push('버스 노선(평일)');
        if (busPtLineWeekendChanged) layers.push('버스 노선(주말)');
        if (railPtLineChanged) layers.push('철도 노선');
        if (simScenarioChanged) layers.push('시뮬레이션 시나리오');
        if (pavementMarkingChanged) layers.push('노면 마킹');
        return layers;
    }, [networkChanged, busStationChanged, railStationChanged, signalChanged, signalTodChanged,
        busPtLineChanged, busPtLineWeekdayChanged, busPtLineWeekendChanged, railPtLineChanged,
        simScenarioChanged, pavementMarkingChanged]);

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
                    <div className={styles.sectionAccent} style={{ background: 'var(--accent-text)' }}/>
                    <span className={styles.sectionTitle}>시나리오</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)' }}>시나리오</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{selectedScenario?.label ?? '-'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)' }}>버전</span>
                        <span style={{ fontSize: 12, color: 'var(--accent-text)' }}>{selectedScenarioVersion?.label ?? '-'}</span>
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
                        <div className={styles.sectionAccent} style={{ background: 'var(--color-success)' }}/>
                        <span className={styles.sectionTitle}>신호 현황</span>
                        <span className={styles.sectionMeta}>교차로 {signalCount}개</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1, background: 'rgba(var(--color-success-rgb), 0.1)', border: '1px solid rgba(var(--color-success-rgb), 0.25)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-success)', fontVariantNumeric: 'tabular-nums' }}>{greenCount}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>녹색 진행</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(var(--color-danger-rgb), 0.1)', border: '1px solid rgba(var(--color-danger-rgb), 0.25)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-danger)', fontVariantNumeric: 'tabular-nums' }}>{signalCount - greenCount}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>적색 정지</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(var(--accent-text-rgb), 0.08)', border: '1px solid rgba(var(--accent-text-rgb), 0.2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{signalCount}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>전체</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 활성 레이어 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: 'var(--accent)' }}/>
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

            {/* ── 시설물 현황 ── */}
            {facilityStats.length > 0 && (
                <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent} style={{ background: '#06b6d4' }}/>
                        <span className={styles.sectionTitle}>시설물 현황</span>
                        <span className={styles.sectionMeta}>{facilityStats.length}개 레이어</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {facilityStats.map(({ label, count }) => (
                            <div key={label} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '4px 8px', background: 'rgba(6,182,212,0.05)',
                                border: '1px solid rgba(6,182,212,0.15)', borderRadius: 6,
                            }}>
                                <span style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginLeft: 4, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 미저장 레이어 ── */}
            {unsavedLayers.length > 0 && (
                <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent} style={{ background: 'var(--color-warning)' }}/>
                        <span className={styles.sectionTitle}>미저장 레이어</span>
                        <span className={styles.sectionMeta} style={{ color: 'var(--color-warning)' }}>{unsavedLayers.length}개</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {unsavedLayers.map(name => (
                            <span key={name} style={{
                                fontSize: 10, padding: '3px 8px',
                                background: 'rgba(var(--color-warning-rgb), 0.12)',
                                border: '1px solid rgba(var(--color-warning-rgb), 0.35)',
                                borderRadius: 12, color: 'var(--color-warning)',
                            }}>{name}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 속도 제한별 링크 분포 ── */}
            {speedLimitStats.length > 0 && (
                <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionAccent} style={{ background: 'var(--color-warning)' }}/>
                        <span className={styles.sectionTitle}>속도 제한별 링크</span>
                        <span className={styles.sectionMeta}>km/h</span>
                    </div>
                    <ResponsiveContainer width="100%" height={110}>
                        <BarChart data={speedLimitStats} margin={{ top: 2, right: 8, left: -22, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" vertical={false}/>
                            <XAxis dataKey="speed" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}/>
                            <YAxis stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}/>
                            <Tooltip content={<ChartTooltip/>}/>
                            <Bar dataKey="count" name="링크 수" fill="var(--color-warning)" radius={[3, 3, 0, 0]}/>
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
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)"/>
                                <XAxis dataKey="time" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'rgba(var(--overlay-rgb), 0.4)' }}/>
                                <YAxis stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'rgba(var(--overlay-rgb), 0.4)' }}/>
                                <Tooltip content={<ChartTooltip/>}/>
                                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)', paddingTop: 4 }}/>
                                <Bar dataKey="추가" fill="var(--color-success)" radius={[3, 3, 0, 0]}/>
                                <Bar dataKey="수정" fill="var(--accent)" radius={[3, 3, 0, 0]}/>
                                <Bar dataKey="삭제" fill="var(--color-danger)" radius={[3, 3, 0, 0]}/>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className={styles.emptyChart}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>편집 이력이 없습니다</span>
                        </div>
                    )}
                    <div className={styles.changeSummary}>
                        <div className={styles.changeChip} style={{ color: 'var(--color-success)', borderColor: 'rgba(var(--color-success-rgb), 0.3)', background: 'rgba(var(--color-success-rgb), 0.08)' }}>
                            <span>+ 추가</span><strong>{totalChanges.added}</strong>
                        </div>
                        <div className={styles.changeChip} style={{ color: 'var(--accent-text)', borderColor: 'rgba(var(--accent-rgb), 0.3)', background: 'rgba(var(--accent-rgb), 0.08)' }}>
                            <span>≈ 수정</span><strong>{totalChanges.modified}</strong>
                        </div>
                        <div className={styles.changeChip} style={{ color: 'var(--color-danger)', borderColor: 'rgba(var(--color-danger-rgb), 0.3)', background: 'rgba(var(--color-danger-rgb), 0.08)' }}>
                            <span>− 삭제</span><strong>{totalChanges.deleted}</strong>
                        </div>
                    </div>
                </div>

            </div>

            {/* ── 최근 편집 이력 ── */}
            <div className={styles.sectionBox}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionAccent} style={{ background: 'var(--color-warning)' }}/>
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

            {/* ── 로그 ── */}
            <ConsolePanel embedded />
        </div>
    );
};

export default DashboardLeft;
