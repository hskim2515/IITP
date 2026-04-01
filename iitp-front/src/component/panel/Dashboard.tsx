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
        <div className={styles.sidePanel}>
            <div className={styles.container}>

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

                <div className={styles.twoCol}>
                <div className={styles.leftCol}>

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

                </div>{/* end leftCol */}
                </div>{/* end twoCol */}
            </div>
        </div>
    );
};

export default Dashboard;
