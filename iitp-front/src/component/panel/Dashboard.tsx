import React, { useMemo, useState } from 'react';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useLayerStore } from '@stores/useLayerStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { JulianDate } from 'cesium';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
    ComposedChart, Line, ReferenceLine, Cell,
    AreaChart, Area,
} from 'recharts';
import styles from '@css/Dashboard.module.css';

interface Props {
    onClose: () => void;
}

type TabType = 'history' | 'analytics';

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

const TYPE_LABELS: Record<string, string> = {
    CAR: '승용차', TAXI: '택시', BUS: '버스', TRUCK: '화물차', MOTO: '이륜차', default: '기타',
};

const TYPE_COLORS: Record<string, string> = {
    승용차: '#4169E1', 택시: '#f59e0b', 버스: '#10b981', 화물차: '#e74c3c', 이륜차: '#8b5cf6', 기타: '#6b7280',
};

const INTERVAL = 60;

function getCongestionInfo(speedKmh: number): { label: string; color: string; bgColor: string; level: number } {
    if (speedKmh <= 0)  return { label: '데이터 없음', color: '#6b7280', bgColor: 'rgba(107,114,128,0.12)', level: 0 };
    if (speedKmh < 20)  return { label: '심한 정체', color: '#ef4444', bgColor: 'rgba(239,68,68,0.12)', level: 1 };
    if (speedKmh < 40)  return { label: '정체', color: '#f97316', bgColor: 'rgba(249,115,22,0.12)', level: 2 };
    if (speedKmh < 60)  return { label: '서행', color: '#eab308', bgColor: 'rgba(234,179,8,0.12)', level: 3 };
    if (speedKmh < 80)  return { label: '원활', color: '#22c55e', bgColor: 'rgba(34,197,94,0.12)', level: 4 };
    return                     { label: '매우 원활', color: '#4169E1', bgColor: 'rgba(65,105,225,0.12)', level: 5 };
}

function formatDuration(sec: number): string {
    if (sec < 60) return `${Math.round(sec)}초`;
    if (sec < 3600) return `${Math.round(sec / 60)}분`;
    return `${(sec / 3600).toFixed(1)}시간`;
}

function computeAnalytics(vehicleRoute: any[]) {
    const vehicles: { type: string; path: number[] }[] = vehicleRoute.map((entry) => ({
        type: Array.isArray(entry) ? 'CAR' : (String(entry?.type || 'CAR')),
        path: (Array.isArray(entry) ? entry : (entry?.path ?? [])) as number[],
    })).filter((v) => Array.isArray(v.path) && v.path.length >= 8);

    if (vehicles.length === 0) return null;

    let minT = Infinity, maxT = -Infinity;
    for (const { path } of vehicles) {
        const t0 = path[0] as number;
        const tLast = path[path.length - 4] as number;
        if (t0 < minT) minT = t0;
        if (tLast > maxT) maxT = tLast;
    }
    if (!isFinite(minT) || !isFinite(maxT)) return null;

    const numBuckets = Math.ceil((maxT - minT) / INTERVAL) + 1;
    const volumeSets: Set<number>[] = Array.from({ length: numBuckets }, () => new Set<number>());
    const speedSums = new Float64Array(numBuckets);
    const speedCounts = new Int32Array(numBuckets);
    const typeCounts: Record<string, number> = {};

    let totalDistanceM = 0;
    let totalTripDurationSec = 0;
    const speedBins = [0, 0, 0, 0, 0]; // <20, 20-40, 40-60, 60-80, 80+

    for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
        const { type, path } = vehicles[vIdx]!;
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;

        const vt0 = path[0] as number;
        const vtLast = path[path.length - 4] as number;
        totalTripDurationSec += (vtLast - vt0);

        for (let i = 0; i + 7 < path.length; i += 4) {
            const t0 = path[i] as number;
            const bucketIdx = Math.floor((t0 - minT) / INTERVAL);
            if (bucketIdx < 0 || bucketIdx >= numBuckets) continue;
            volumeSets[bucketIdx]!.add(vIdx);
            const dt = (path[i + 4] as number) - t0;
            if (dt > 0) {
                const dx = (path[i + 5] as number) - (path[i + 1] as number);
                const dy = (path[i + 6] as number) - (path[i + 2] as number);
                const dz = (path[i + 7] as number) - (path[i + 3] as number);
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                totalDistanceM += dist;
                const kmh = dist / dt * 3.6;
                if (kmh > 0 && kmh < 200) {
                    speedSums[bucketIdx] = (speedSums[bucketIdx] ?? 0) + kmh;
                    speedCounts[bucketIdx] = (speedCounts[bucketIdx] ?? 0) + 1;
                    if (kmh < 20) speedBins[0] = (speedBins[0] ?? 0) + 1;
                    else if (kmh < 40) speedBins[1] = (speedBins[1] ?? 0) + 1;
                    else if (kmh < 60) speedBins[2] = (speedBins[2] ?? 0) + 1;
                    else if (kmh < 80) speedBins[3] = (speedBins[3] ?? 0) + 1;
                    else speedBins[4] = (speedBins[4] ?? 0) + 1;
                }
            }
        }
    }

    const timeSeries = Array.from({ length: numBuckets }, (_, i) => ({
        time: `${Math.round(minT + i * INTERVAL)}s`,
        교통량: volumeSets[i]!.size,
        평균속도: (speedCounts[i] ?? 0) > 0 ? +(speedSums[i]! / speedCounts[i]!).toFixed(1) : 0,
    }));

    const typeData = Object.entries(typeCounts)
        .map(([k, v]) => ({ type: TYPE_LABELS[k] ?? k, count: v, pct: +(v / vehicles.length * 100).toFixed(1) }))
        .sort((a, b) => b.count - a.count);

    const speedDistribution = [
        { range: '0-20', count: speedBins[0], color: '#ef4444' },
        { range: '20-40', count: speedBins[1], color: '#f97316' },
        { range: '40-60', count: speedBins[2], color: '#eab308' },
        { range: '60-80', count: speedBins[3], color: '#22c55e' },
        { range: '80+', count: speedBins[4], color: '#4169E1' },
    ];

    const totalSpeedSum = Array.from(speedSums).reduce((a, b) => a + b, 0);
    const totalSpeedCount = Array.from(speedCounts).reduce((a, b) => a + b, 0);
    const peakBucket = timeSeries.reduce((m, b) => (b.교통량 > m.교통량 ? b : m), timeSeries[0]!);
    const avgSpeedKmh = totalSpeedCount > 0 ? +(totalSpeedSum / totalSpeedCount).toFixed(1) : 0;

    return {
        timeSeries,
        typeData,
        speedDistribution,
        totalVehicles: vehicles.length,
        peakTime: peakBucket?.time ?? '-',
        peakVolume: peakBucket?.교통량 ?? 0,
        avgSpeedKmh,
        totalDistanceKm: +(totalDistanceM / 1000).toFixed(1),
        avgTripDurationSec: vehicles.length > 0 ? +(totalTripDurationSec / vehicles.length).toFixed(0) : 0,
        estimatedCO2Kg: +(totalDistanceM / 1000 * 0.12).toFixed(1),
    };
}

// ─── Custom Tooltip ────────────────────────────────────────────
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

// ─── Congestion Bar ────────────────────────────────────────────
const CongestionBar: React.FC<{ level: number }> = ({ level }) => (
    <div className={styles.congestionBar}>
        {[1, 2, 3, 4, 5].map((l) => (
            <div
                key={l}
                className={styles.congestionSegment}
                style={{
                    background: l <= level
                        ? ['#ef4444', '#f97316', '#eab308', '#22c55e', '#4169E1'][l - 1]
                        : '#2a2a2a',
                }}
            />
        ))}
    </div>
);

// ─── Component ────────────────────────────────────────────────
const Dashboard: React.FC<Props> = ({ onClose }) => {
    const { isRunning, speed, startTime, endTime, currentTime } = useSimulationStore();
    const activeVehicleCount = useVehicleStore((s) => s.activeVehicleCount);
    const vehicleRoute = useVehicleStore((s) => s.vehicleRoute);
    const networkData = useNetworkStore((s) => s.currentJsonData);
    const activeLayerName = useLayerStore((s) => s.activeLayerName);
    const selectedScenario = useScenarioStore((s) => s.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const updateLogs = useNetworkHistoryStore((s) => s.updateLogs);

    const [activeTab, setActiveTab] = useState<TabType>('history');

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

    const analyticsData = useMemo(() => {
        if (!vehicleRoute || !Array.isArray(vehicleRoute) || vehicleRoute.length === 0) return null;
        return computeAnalytics(vehicleRoute as any[]);
    }, [vehicleRoute]);

    const currentBucketIdx = useMemo(() => {
        if (!analyticsData || !startTime || !currentTime) return -1;
        const elapsed = JulianDate.secondsDifference(currentTime, startTime);
        return Math.max(0, Math.min(
            Math.floor(elapsed / INTERVAL),
            analyticsData.timeSeries.length - 1
        ));
    }, [analyticsData, startTime, currentTime]);

    const currentBucket = analyticsData?.timeSeries[currentBucketIdx] ?? null;
    const congestion = getCongestionInfo(currentBucket?.평균속도 ?? 0);

    const simulationLabel = isRunning ? '실행 중' : currentTime ? '일시정지' : '대기';

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.container} onClick={(e) => e.stopPropagation()}>

                {/* ── Header ── */}
                <div className={styles.header}>
                    <div className={styles.headerLeft}>
                        <div className={styles.headerIcon}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                            </svg>
                        </div>
                        <span className={styles.title}>교통 시뮬레이션 대시보드</span>
                        <span className={styles.scenarioTag}>
                            {selectedScenario?.label ?? '-'}
                        </span>
                        {selectedScenarioVersion && (
                            <span className={styles.versionTag}>{selectedScenarioVersion.label}</span>
                        )}
                    </div>
                    <div className={styles.headerRight}>
                        <div className={`${styles.statusPill} ${isRunning ? styles.statusPillRunning : ''}`}>
                            <span className={isRunning ? styles.dotRunning : styles.dotStopped}/>
                            {simulationLabel}
                        </div>
                        <button className={styles.closeBtn} onClick={onClose}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── KPI Cards ── */}
                <div className={styles.kpiRow}>
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

                {/* ── Tabs ── */}
                <div className={styles.tabBar}>
                    <button
                        className={`${styles.tab} ${activeTab === 'history' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                            <path d="M3 3h18v18H3z"/><path d="M8 12h8M8 8h5M8 16h3"/>
                        </svg>
                        편집 이력
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('analytics')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                        교통량 분석
                    </button>
                </div>

                {/* ── Tab: 편집 이력 ── */}
                {activeTab === 'history' && (
                    <div className={styles.mainGrid}>
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

                        <div className={styles.rightColumn}>
                            <div className={styles.sectionBox}>
                                <div className={styles.sectionHeader}>
                                    <div className={styles.sectionAccent} style={{ background: '#10b981' }}/>
                                    <span className={styles.sectionTitle}>활성 레이어</span>
                                    <span className={styles.sectionMeta}>{(activeLayerName?.length ?? 0)}개</span>
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
                    </div>
                )}

                {/* ── Tab: 교통량 분석 ── */}
                {activeTab === 'analytics' && (
                    <div className={styles.analyticsPanel}>
                        {!analyticsData ? (
                            <div className={styles.analyticsEmpty}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                                </svg>
                                <p className={styles.emptyTitle}>분석 데이터 없음</p>
                                <p className={styles.emptyDesc}>시뮬레이션 데이터를 로드하면 자동으로 분석됩니다</p>
                            </div>
                        ) : (
                            <>
                                {/* Live Status Row */}
                                <div className={styles.liveRow} style={{ borderColor: congestion.color + '40', background: congestion.bgColor }}>
                                    <div className={styles.liveDot} style={{ background: congestion.color, boxShadow: `0 0 8px ${congestion.color}` }}/>
                                    <span className={styles.liveLabel} style={{ color: congestion.color }}>LIVE</span>
                                    <span className={styles.liveTime}>{currentBucket?.time ?? '-'}</span>
                                    <div className={styles.liveSeparator}/>
                                    <div className={styles.liveStat}>
                                        <span className={styles.liveStatLabel}>교통량</span>
                                        <span className={styles.liveStatValue}>{currentBucket?.교통량?.toLocaleString() ?? '-'}</span>
                                        <span className={styles.liveStatUnit}>대</span>
                                    </div>
                                    <div className={styles.liveSeparator}/>
                                    <div className={styles.liveStat}>
                                        <span className={styles.liveStatLabel}>평균속도</span>
                                        <span className={styles.liveStatValue} style={{ color: congestion.color }}>{currentBucket?.평균속도 ?? '-'}</span>
                                        <span className={styles.liveStatUnit}>km/h</span>
                                    </div>
                                    <div className={styles.liveSeparator}/>
                                    <div className={styles.liveCongest}>
                                        <span className={styles.liveStatLabel}>혼잡도</span>
                                        <span className={styles.congestionLabel} style={{ color: congestion.color }}>{congestion.label}</span>
                                        <CongestionBar level={congestion.level}/>
                                    </div>
                                </div>

                                {/* Analytics KPI Grid */}
                                <div className={styles.analyticsKpiRow}>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#4169E1' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                                                <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>총 차량 수</div>
                                        <div className={styles.analyticsKpiValue}>{analyticsData.totalVehicles.toLocaleString()}</div>
                                        <div className={styles.kpiUnit}>대 (전체 시뮬레이션)</div>
                                    </div>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#f59e0b' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>평균 여행 시간</div>
                                        <div className={styles.analyticsKpiValue}>{formatDuration(analyticsData.avgTripDurationSec)}</div>
                                        <div className={styles.kpiUnit}>차량당 평균</div>
                                    </div>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#10b981' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>전체 평균 속도</div>
                                        <div className={styles.analyticsKpiValue}>{analyticsData.avgSpeedKmh}</div>
                                        <div className={styles.kpiUnit}>km/h</div>
                                    </div>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#ef4444' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>피크 교통량</div>
                                        <div className={styles.analyticsKpiValue}>{analyticsData.peakVolume.toLocaleString()}</div>
                                        <div className={styles.kpiUnit}>대 · {analyticsData.peakTime}</div>
                                    </div>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#8b5cf6' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>총 이동 거리</div>
                                        <div className={styles.analyticsKpiValue}>{analyticsData.totalDistanceKm.toLocaleString()}</div>
                                        <div className={styles.kpiUnit}>km (누적)</div>
                                    </div>
                                    <div className={styles.analyticsKpi}>
                                        <div className={styles.analyticsKpiIcon} style={{ color: '#6b7280' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                                                <circle cx="12" cy="9" r="2.5"/>
                                            </svg>
                                        </div>
                                        <div className={styles.kpiLabel}>CO₂ 추정 배출</div>
                                        <div className={styles.analyticsKpiValue}>{analyticsData.estimatedCO2Kg.toLocaleString()}</div>
                                        <div className={styles.kpiUnit}>kg (120g/km 기준)</div>
                                    </div>
                                </div>

                                {/* Charts Grid */}
                                <div className={styles.analyticsChartGrid}>
                                    {/* Left: 시간대별 교통량 + 속도 */}
                                    <div className={styles.analyticsChartSection}>
                                        <div className={styles.sectionHeader}>
                                            <div className={styles.sectionAccent} style={{ background: '#4169E1' }}/>
                                            <span className={styles.sectionTitle}>시간대별 교통량 · 평균속도</span>
                                            <span className={styles.sectionMeta}>{INTERVAL}초 간격</span>
                                        </div>
                                        <ResponsiveContainer width="100%" height={190}>
                                            <ComposedChart data={analyticsData.timeSeries} margin={{ top: 5, right: 30, left: -10, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#4169E1" stopOpacity={0.8}/>
                                                        <stop offset="95%" stopColor="#4169E1" stopOpacity={0.2}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false}/>
                                                <XAxis dataKey="time" stroke="#333" tick={{ fontSize: 10, fill: '#555' }} interval="preserveStartEnd"/>
                                                <YAxis yAxisId="vol" stroke="#333" tick={{ fontSize: 10, fill: '#555' }} label={{ value: '대', angle: -90, position: 'insideLeft', fill: '#444', fontSize: 10 }}/>
                                                <YAxis yAxisId="spd" orientation="right" stroke="#333" tick={{ fontSize: 10, fill: '#555' }} label={{ value: 'km/h', angle: 90, position: 'insideRight', fill: '#444', fontSize: 10 }}/>
                                                <Tooltip content={<ChartTooltip/>}/>
                                                <Legend wrapperStyle={{ fontSize: 11, color: '#666', paddingTop: 4 }}/>
                                                <Bar yAxisId="vol" dataKey="교통량" fill="url(#volGradient)" radius={[2, 2, 0, 0]} maxBarSize={20}/>
                                                <Line yAxisId="spd" type="monotone" dataKey="평균속도" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#f59e0b' }}/>
                                                {currentBucket && (
                                                    <ReferenceLine
                                                        x={currentBucket.time}
                                                        yAxisId="vol"
                                                        stroke="#ff6b6b"
                                                        strokeWidth={1.5}
                                                        strokeDasharray="4 3"
                                                        label={{ value: '현재', position: 'top', fill: '#ff6b6b', fontSize: 9 }}
                                                    />
                                                )}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* Right: 차량 유형 + 속도 분포 */}
                                    <div className={styles.analyticsRightCol}>
                                        <div className={styles.analyticsChartSection}>
                                            <div className={styles.sectionHeader}>
                                                <div className={styles.sectionAccent} style={{ background: '#10b981' }}/>
                                                <span className={styles.sectionTitle}>차량 유형</span>
                                            </div>
                                            <ResponsiveContainer width="100%" height={120}>
                                                <BarChart data={analyticsData.typeData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" horizontal={false}/>
                                                    <XAxis type="number" stroke="#333" tick={{ fontSize: 10, fill: '#555' }}/>
                                                    <YAxis type="category" dataKey="type" stroke="#333" tick={{ fontSize: 11, fill: '#999' }} width={42}/>
                                                    <Tooltip content={<ChartTooltip/>}/>
                                                    <Bar dataKey="count" name="차량 수" radius={[0, 3, 3, 0]} maxBarSize={16}>
                                                        {analyticsData.typeData.map((entry, index) => (
                                                            <Cell key={index} fill={TYPE_COLORS[entry.type] ?? '#6b7280'}/>
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                            {/* type pct pills */}
                                            <div className={styles.typePills}>
                                                {analyticsData.typeData.slice(0, 4).map((d) => (
                                                    <span key={d.type} className={styles.typePill} style={{ borderColor: (TYPE_COLORS[d.type] ?? '#6b7280') + '60', color: TYPE_COLORS[d.type] ?? '#6b7280' }}>
                                                        {d.type} {d.pct}%
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className={styles.analyticsChartSection}>
                                            <div className={styles.sectionHeader}>
                                                <div className={styles.sectionAccent} style={{ background: '#f59e0b' }}/>
                                                <span className={styles.sectionTitle}>속도 분포</span>
                                                <span className={styles.sectionMeta}>km/h</span>
                                            </div>
                                            <ResponsiveContainer width="100%" height={105}>
                                                <BarChart data={analyticsData.speedDistribution} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false}/>
                                                    <XAxis dataKey="range" stroke="#333" tick={{ fontSize: 10, fill: '#555' }}/>
                                                    <YAxis stroke="#333" tick={{ fontSize: 10, fill: '#555' }}/>
                                                    <Tooltip content={<ChartTooltip/>}/>
                                                    <Bar dataKey="count" name="샘플 수" radius={[3, 3, 0, 0]}>
                                                        {analyticsData.speedDistribution.map((entry, index) => (
                                                            <Cell key={index} fill={entry.color}/>
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default Dashboard;
