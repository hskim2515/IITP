import React, { useMemo, useState, useCallback } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from '@stores/useSimulationStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useAnalyticsStore } from '@stores/useAnalyticsStore';
import { JulianDate } from 'cesium';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
    ComposedChart, Line, ReferenceLine, Cell,
    AreaChart, Area,
} from 'recharts';
import styles from '@css/Dashboard.module.css';
import { TYPE_COLORS, INTERVAL, getCongestionInfo, formatDuration, computeAnalytics, ChartTooltip, CongestionBar } from './dashboardShared';
import PerformanceTab from './PerformanceTab';

interface Props {
    onClose: () => void;
}

type TabType = 'analytics' | 'linkstats' | 'performance';

function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

// ─── Component ────────────────────────────────────────────────
const DashboardRight: React.FC<Props> = ({ onClose }) => {
    const { isRunning, startTime, currentTime } = useSimulationStore();
    const vehicleRoute = useVehicleStore((s) => s.vehicleRoute);
    const { selectedScenario, selectedScenarioVersion } = useScenarioStore();
    const { linkStats, summary, isLoading, error, fetchStats, fetchSummary } = useAnalyticsStore();

    const [activeTab, setActiveTab] = useState<TabType>('analytics');

    const versionId = getActiveVersionId() ?? '';

    const handleFetchStats = useCallback(async () => {
        if (!versionId) return;
        await Promise.all([fetchStats(versionId, 60, 15), fetchSummary(versionId)]);
    }, [versionId, fetchStats, fetchSummary]);

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

    return (
        <div className={styles.rightCol}>

            {/* Tab Bar */}
            <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
                <div className={styles.tabBar}>
                    <button
                        className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('analytics')}
                    >
                        실시간 분석
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'linkstats' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('linkstats')}
                    >
                        링크 통계
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'performance' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('performance')}
                    >
                        성능
                    </button>
                </div>
            </div>

            {/* ── 성능 탭 (렌더 FPS/프레임/뷰포트 티어 — 지도 위 상시 오버레이 대신 여기서 확인) ── */}
            {activeTab === 'performance' && <PerformanceTab/>}

            {/* ── 실시간 분석 탭 ── */}
            {activeTab === 'analytics' && (
                <div className={styles.analyticsPanel} style={{ padding: '12px 12px 14px' }}>
                    {!analyticsData ? (
                        <div className={styles.analyticsEmpty}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--overlay-rgb), 0.3)" strokeWidth="1.5">
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
                            <div className={styles.analyticsKpiRowSide}>
                                <div className={styles.analyticsKpi}>
                                    <div className={styles.analyticsKpiIcon} style={{ color: 'var(--accent)' }}>
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
                                    <div className={styles.analyticsKpiIcon} style={{ color: 'var(--color-warning)' }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                                        </svg>
                                    </div>
                                    <div className={styles.kpiLabel}>평균 여행 시간</div>
                                    <div className={styles.analyticsKpiValue}>{formatDuration(analyticsData.avgTripDurationSec)}</div>
                                    <div className={styles.kpiUnit}>차량당 평균</div>
                                </div>
                                <div className={styles.analyticsKpi}>
                                    <div className={styles.analyticsKpiIcon} style={{ color: 'var(--color-success)' }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                                        </svg>
                                    </div>
                                    <div className={styles.kpiLabel}>전체 평균 속도</div>
                                    <div className={styles.analyticsKpiValue}>{analyticsData.avgSpeedKmh}</div>
                                    <div className={styles.kpiUnit}>km/h</div>
                                </div>
                                <div className={styles.analyticsKpi}>
                                    <div className={styles.analyticsKpiIcon} style={{ color: 'var(--color-danger)' }}>
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

                            {/* 피크 요약 */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div className={styles.sectionBox} style={{ flex: 1, textAlign: 'center' }}>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginBottom: 4 }}>피크 교통량 시각</div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}>{analyticsData.peakTime}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>{analyticsData.peakVolume.toLocaleString()} 대</div>
                                </div>
                                <div className={styles.sectionBox} style={{ flex: 1, textAlign: 'center' }}>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginBottom: 4 }}>총 이동거리</div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-success)', fontVariantNumeric: 'tabular-nums' }}>{analyticsData.totalDistanceKm.toLocaleString()}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>km (누적)</div>
                                </div>
                                <div className={styles.sectionBox} style={{ flex: 1, textAlign: 'center' }}>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginBottom: 4 }}>CO₂ 추정</div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', fontVariantNumeric: 'tabular-nums' }}>{analyticsData.estimatedCO2Kg.toLocaleString()}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>kg</div>
                                </div>
                            </div>

                            {/* Charts Grid */}
                            <div className={styles.analyticsChartGridSide}>
                                <div className={styles.analyticsChartSection}>
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionAccent} style={{ background: 'var(--accent)' }}/>
                                        <span className={styles.sectionTitle}>시간대별 교통량 · 평균속도</span>
                                        <span className={styles.sectionMeta}>{INTERVAL}초 간격</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={190}>
                                        <ComposedChart data={analyticsData.timeSeries} margin={{ top: 5, right: 30, left: -10, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8}/>
                                                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.2}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" vertical={false}/>
                                            <XAxis dataKey="time" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }} interval="preserveStartEnd"/>
                                            <YAxis yAxisId="vol" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }} label={{ value: '대', angle: -90, position: 'insideLeft', fill: 'var(--text-disabled)', fontSize: 10 }}/>
                                            <YAxis yAxisId="spd" orientation="right" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }} label={{ value: 'km/h', angle: 90, position: 'insideRight', fill: 'var(--text-disabled)', fontSize: 10 }}/>
                                            <Tooltip content={<ChartTooltip/>}/>
                                            <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)', paddingTop: 4 }}/>
                                            <Bar yAxisId="vol" dataKey="교통량" fill="url(#volGradient)" radius={[2, 2, 0, 0]} maxBarSize={20}/>
                                            <Line yAxisId="spd" type="monotone" dataKey="평균속도" stroke="var(--color-warning)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--color-warning)' }}/>
                                            {currentBucket && (
                                                <ReferenceLine
                                                    x={currentBucket.time}
                                                    yAxisId="vol"
                                                    stroke="var(--color-danger)"
                                                    strokeWidth={1.5}
                                                    strokeDasharray="4 3"
                                                    label={{ value: '현재', position: 'top', fill: 'var(--color-danger)', fontSize: 9 }}
                                                />
                                            )}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className={styles.analyticsChartSection} style={{ marginTop: 10 }}>
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionAccent} style={{ background: 'var(--color-success)' }}/>
                                        <span className={styles.sectionTitle}>시간대별 평균속도 추이</span>
                                        <span className={styles.sectionMeta}>km/h</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={110}>
                                        <AreaChart data={analyticsData.timeSeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="spdGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.5}/>
                                                    <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.05}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" vertical={false}/>
                                            <XAxis dataKey="time" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 9, fill: 'var(--text-disabled)' }} interval="preserveStartEnd"/>
                                            <YAxis stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 9, fill: 'var(--text-disabled)' }}/>
                                            <Tooltip content={<ChartTooltip/>}/>
                                            <Area type="monotone" dataKey="평균속도" stroke="var(--color-success)" strokeWidth={2} fill="url(#spdGrad)" dot={false}/>
                                            {currentBucket && (
                                                <ReferenceLine x={currentBucket.time} stroke="var(--color-danger)" strokeWidth={1.5} strokeDasharray="4 3"/>
                                            )}
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className={styles.analyticsRightCol}>
                                    <div className={styles.analyticsChartSection}>
                                        <div className={styles.sectionHeader}>
                                            <div className={styles.sectionAccent} style={{ background: 'var(--color-success)' }}/>
                                            <span className={styles.sectionTitle}>차량 유형</span>
                                        </div>
                                        <ResponsiveContainer width="100%" height={120}>
                                            <BarChart data={analyticsData.typeData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" horizontal={false}/>
                                                <XAxis type="number" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}/>
                                                <YAxis type="category" dataKey="type" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} width={42}/>
                                                <Tooltip content={<ChartTooltip/>}/>
                                                <Bar dataKey="count" name="차량 수" radius={[0, 3, 3, 0]} maxBarSize={16}>
                                                    {analyticsData.typeData.map((entry, index) => (
                                                        <Cell key={index} fill={TYPE_COLORS[entry.type] ?? '#6b7280'}/>
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
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
                                            <div className={styles.sectionAccent} style={{ background: 'var(--color-warning)' }}/>
                                            <span className={styles.sectionTitle}>속도 분포</span>
                                            <span className={styles.sectionMeta}>km/h</span>
                                        </div>
                                        <ResponsiveContainer width="100%" height={105}>
                                            <BarChart data={analyticsData.speedDistribution} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" vertical={false}/>
                                                <XAxis dataKey="range" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}/>
                                                <YAxis stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 10, fill: 'var(--text-disabled)' }}/>
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

            {/* ── 링크 통계 탭 ── */}
            {activeTab === 'linkstats' && (
                <div style={{ padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* 조회 버튼 + 상태 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                            className={styles.fetchBtn}
                            onClick={handleFetchStats}
                            disabled={isLoading || !versionId}
                        >
                            {isLoading ? (
                                <><span className={styles.spinner}/> 집계 중...</>
                            ) : (
                                <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.56"/>
                                    </svg>
                                    DB 통계 불러오기
                                </>
                            )}
                        </button>
                        {!versionId && <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>시나리오를 먼저 선택하세요</span>}
                        {error && <span style={{ fontSize: 11, color: 'var(--color-danger)' }}>{error}</span>}
                    </div>

                    {/* 요약 KPI (summary) */}
                    {summary && (
                        <div className={styles.kpiGrid} style={{ gap: 8 }}>
                            <div className={styles.kpiCard + ' ' + styles.kpiBlue}>
                                <div className={styles.kpiLabel}>총 차량 수</div>
                                <div className={styles.kpiValue} style={{ fontSize: 20 }}>{summary.totalVehicles.toLocaleString()}<span className={styles.kpiValueSuffix}>대</span></div>
                            </div>
                            <div className={styles.kpiCard + ' ' + styles.kpiGreen}>
                                <div className={styles.kpiLabel}>분석 링크 수</div>
                                <div className={styles.kpiValue} style={{ fontSize: 20 }}>{summary.totalLinks.toLocaleString()}<span className={styles.kpiValueSuffix}>개</span></div>
                            </div>
                            <div className={styles.kpiCard + ' ' + styles.kpiAmber}>
                                <div className={styles.kpiLabel}>시뮬레이션 시간</div>
                                <div className={styles.kpiValue} style={{ fontSize: 16 }}>{formatTime(summary.simulationDuration)}</div>
                            </div>
                            <div className={styles.kpiCard + ' ' + styles.kpiPurple}>
                                <div className={styles.kpiLabel}>피크 교통량</div>
                                <div className={styles.kpiValue} style={{ fontSize: 20 }}>{summary.peakVolume.toLocaleString()}<span className={styles.kpiValueSuffix}>대</span></div>
                                <div className={styles.kpiUnit}>{summary.peakTimestep}초 구간</div>
                            </div>
                        </div>
                    )}

                    {/* 상위 링크 테이블 */}
                    {linkStats && linkStats.topLinks.length > 0 ? (
                        <div className={styles.sectionBox} style={{ padding: 0, overflow: 'hidden' }}>
                            <div className={styles.sectionHeader} style={{ padding: '12px 14px 8px', marginBottom: 0, borderBottom: '1px solid rgba(var(--overlay-rgb), 0.05)' }}>
                                <div className={styles.sectionAccent} style={{ background: 'var(--accent)' }}/>
                                <span className={styles.sectionTitle}>교통량 상위 링크</span>
                                <span className={styles.sectionMeta}>{linkStats.interval}초 간격</span>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table className={styles.statsTable}>
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>링크 ID</th>
                                            <th>교통량</th>
                                            <th>평균속도</th>
                                            <th>혼잡도</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {linkStats.topLinks.map((link, idx) => {
                                            const ci = getCongestionInfo(link.avgSpeed);
                                            return (
                                                <tr key={link.linkId}>
                                                    <td className={styles.statsTdRank}>{idx + 1}</td>
                                                    <td className={styles.statsTdId}>{link.linkId}</td>
                                                    <td className={styles.statsTdNum}>{link.totalVolume.toLocaleString()}</td>
                                                    <td className={styles.statsTdNum} style={{ color: ci.color }}>
                                                        {link.avgSpeed > 0 ? `${link.avgSpeed} km/h` : '-'}
                                                    </td>
                                                    <td>
                                                        <span className={styles.congestionPill} style={{ color: ci.color, borderColor: ci.color + '40', background: ci.bgColor }}>
                                                            {ci.label}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : !isLoading && !linkStats ? (
                        <div className={styles.analyticsEmpty}>
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--overlay-rgb), 0.3)" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
                                <line x1="9" y1="21" x2="9" y2="9"/>
                            </svg>
                            <p className={styles.emptyTitle}>통계 없음</p>
                            <p className={styles.emptyDesc}>위 버튼을 눌러 DB에서 통계를 집계하세요</p>
                        </div>
                    ) : null}

                    {/* 전체 시계열 차트 */}
                    {linkStats && linkStats.overallTimeSeries.length > 0 && (
                        <div className={styles.analyticsChartSection}>
                            <div className={styles.sectionHeader}>
                                <div className={styles.sectionAccent} style={{ background: '#8b5cf6' }}/>
                                <span className={styles.sectionTitle}>전체 시간대별 교통량</span>
                                <span className={styles.sectionMeta}>(DB 집계)</span>
                            </div>
                            <ResponsiveContainer width="100%" height={140}>
                                <BarChart
                                    data={linkStats.overallTimeSeries.map(s => ({ time: `${s.time}s`, 교통량: s.volume }))}
                                    margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="dbVolGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--overlay-rgb), 0.08)" vertical={false}/>
                                    <XAxis dataKey="time" stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 9, fill: 'var(--text-disabled)' }} interval="preserveStartEnd"/>
                                    <YAxis stroke="rgba(var(--overlay-rgb), 0.3)" tick={{ fontSize: 9, fill: 'var(--text-disabled)' }}/>
                                    <Tooltip content={<ChartTooltip/>}/>
                                    <Bar dataKey="교통량" fill="url(#dbVolGrad)" radius={[2, 2, 0, 0]} maxBarSize={16}/>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DashboardRight;
