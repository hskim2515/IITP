import { create } from 'zustand';
import axiosInstance from '@api/axiosInstance';

export interface TimeSlotStats {
    time: number;      // 시뮬레이션 시작 기준 초
    volume: number;    // 해당 구간 고유 차량 수
    avgSpeed: number;  // 평균 속도 (km/h)
}

export interface LinkSummary {
    linkId: string;
    totalVolume: number;
    avgSpeed: number;
    timeSeries: TimeSlotStats[];
}

export interface LinkStatsData {
    interval: number;
    overallTimeSeries: TimeSlotStats[];
    topLinks: LinkSummary[];
}

export interface OverallSummary {
    totalVehicles: number;
    totalLinks: number;
    simulationDuration: number; // seconds
    peakVolume: number;
    peakTimestep: number;       // seconds from start
}

interface AnalyticsState {
    linkStats: LinkStatsData | null;
    summary: OverallSummary | null;
    isLoading: boolean;
    error: string | null;
    fetchStats: (versionId: string, interval?: number, topN?: number) => Promise<void>;
    fetchSummary: (versionId: string) => Promise<void>;
    setLinkStats: (stats: LinkStatsData) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    clear: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
    linkStats: null,
    summary: null,
    isLoading: false,
    error: null,

    fetchStats: async (versionId, interval = 60, topN = 10) => {
        set({ isLoading: true, error: null });
        try {
            const res = await axiosInstance.get(`/analytics/link-stats/${versionId}`, {
                params: { interval, topN },
            });
            set({ linkStats: res.data as LinkStatsData, isLoading: false });
        } catch (e: any) {
            set({ error: e?.message ?? '통계 데이터 조회 실패', isLoading: false });
        }
    },

    fetchSummary: async (versionId) => {
        try {
            const res = await axiosInstance.get(`/analytics/summary/${versionId}`);
            set({ summary: res.data as OverallSummary });
        } catch (e: any) {
            set({ error: e?.message ?? '요약 데이터 조회 실패' });
        }
    },

    setLinkStats: (stats) => set({ linkStats: stats, error: null }),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error, isLoading: false }),
    clear: () => set({ linkStats: null, summary: null, error: null }),
}));
