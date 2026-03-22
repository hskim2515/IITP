import { create } from 'zustand';

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

interface AnalyticsState {
    linkStats: LinkStatsData | null;
    isLoading: boolean;
    error: string | null;
    setLinkStats: (stats: LinkStatsData) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    clear: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
    linkStats: null,
    isLoading: false,
    error: null,
    setLinkStats: (stats) => set({ linkStats: stats, error: null }),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error, isLoading: false }),
    clear: () => set({ linkStats: null, error: null }),
}));
