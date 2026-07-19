import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NetworkTileState {
    /** true: 타일 뷰포트 모드 (KTDB 대용량 임포트 후 활성화). false: 전체 로드 모드 (일반 편집). */
    tileMode: boolean;
    /** 시나리오(versionId)별 tileMode 영속값 — 대형 시나리오만 타일 모드, 소형은 편집 가능한 전체 로드 유지 */
    byVersion: Record<string, boolean>;
    /** tileMode 설정. versionId를 주면 해당 시나리오의 영속값도 함께 기록 */
    setTileMode: (v: boolean, versionId?: string) => void;
    /** 시나리오 진입 시 해당 시나리오의 영속값으로 tileMode 복원 (없으면 false) */
    hydrateForVersion: (versionId: string) => void;
    /** in-flight 타일 요청 수 (>0 이면 로딩 스피너 표시). 영속화하지 않음. */
    loadingCount: number;
    incLoading: () => void;
    decLoading: () => void;
}

export const useNetworkTileStore = create<NetworkTileState>()(
    persist(
        (set, get) => ({
            tileMode: false,
            byVersion: {},
            setTileMode: (v, versionId) => set((s) => ({
                tileMode: v,
                byVersion: versionId ? { ...s.byVersion, [versionId]: v } : s.byVersion,
            })),
            hydrateForVersion: (versionId) => set({ tileMode: get().byVersion[versionId] ?? false }),
            loadingCount: 0,
            incLoading: () => set((s) => ({ loadingCount: s.loadingCount + 1 })),
            decLoading: () => set((s) => ({ loadingCount: Math.max(0, s.loadingCount - 1) })),
        }),
        {
            name: 'network-tile-mode',
            partialize: (s) => ({ byVersion: s.byVersion }),
        },
    ),
);
