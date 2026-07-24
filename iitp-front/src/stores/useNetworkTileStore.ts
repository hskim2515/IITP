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
    /** true: 현재 줌 티어(overview/mid, 또는 보기모드 near)에서는 JSON fetch가 동결돼 있어
     *  편집 그리드가 "마지막으로 불러온 화면 범위" 데이터를 보여주고 있음(실시간 아님).
     *  outOfRange: frozen 상태에서 현재 화면이 그 마지막 범위와 안 겹치는 곳으로 이동함
     *  (표시 중인 목록이 지금 보이는 지도 영역과 무관할 가능성이 큼). 영속화하지 않음. */
    gridDataFrozen: boolean;
    gridDataOutOfRange: boolean;
    setGridDataStatus: (frozen: boolean, outOfRange: boolean) => void;
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
            gridDataFrozen: false,
            gridDataOutOfRange: false,
            setGridDataStatus: (frozen, outOfRange) => set((s) => (
                s.gridDataFrozen === frozen && s.gridDataOutOfRange === outOfRange
                    ? s // 참조 동일성 유지 — moveend마다 매번 새 객체로 리렌더 유발 방지
                    : { gridDataFrozen: frozen, gridDataOutOfRange: outOfRange }
            )),
        }),
        {
            name: 'network-tile-mode',
            partialize: (s) => ({ byVersion: s.byVersion }),
        },
    ),
);
