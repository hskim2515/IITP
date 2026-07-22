import React from 'react';
import styles from '@css/Dashboard.module.css';

export const LAYER_LABELS: Record<string, string> = {
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

export const TYPE_LABELS: Record<string, string> = {
    CAR: '승용차', TAXI: '택시', BUS: '버스', TRUCK: '화물차', MOTO: '이륜차', default: '기타',
};

export const TYPE_COLORS: Record<string, string> = {
    승용차: '#4169E1', 택시: '#f59e0b', 버스: '#10b981', 화물차: '#e74c3c', 이륜차: '#8b5cf6', 기타: '#6b7280',
};

export const INTERVAL = 60;

export function getCongestionInfo(speedKmh: number): { label: string; color: string; bgColor: string; level: number } {
    if (speedKmh <= 0)  return { label: '데이터 없음', color: '#6b7280', bgColor: 'rgba(107,114,128,0.12)', level: 0 };
    if (speedKmh < 20)  return { label: '심한 정체', color: '#ef4444', bgColor: 'rgba(239,68,68,0.12)', level: 1 };
    if (speedKmh < 40)  return { label: '정체', color: '#f97316', bgColor: 'rgba(249,115,22,0.12)', level: 2 };
    if (speedKmh < 60)  return { label: '서행', color: '#eab308', bgColor: 'rgba(234,179,8,0.12)', level: 3 };
    if (speedKmh < 80)  return { label: '원활', color: '#22c55e', bgColor: 'rgba(34,197,94,0.12)', level: 4 };
    return                     { label: '매우 원활', color: '#4169E1', bgColor: 'rgba(65,105,225,0.12)', level: 5 };
}

export function formatDuration(sec: number): string {
    if (sec < 60) return `${Math.round(sec)}초`;
    if (sec < 3600) return `${Math.round(sec / 60)}분`;
    return `${(sec / 3600).toFixed(1)}시간`;
}

export function computeAnalytics(vehicleRoute: any[]) {
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
export const ChartTooltip = ({ active, payload, label }: any) => {
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
export const CongestionBar: React.FC<{ level: number }> = ({ level }) => (
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
