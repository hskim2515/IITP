import { create } from "zustand";
import { NEXTSIM_REQUIRED_KEYS, validateAllRequired, FacilityValidationResult } from "@utils/nextSimValidation";

export interface NextSimKeyState {
    loading: boolean;
    ok?: boolean;
    issues?: string[];
}

interface NextSimReadinessState {
    validation: Record<string, NextSimKeyState>;
    runAll: () => Promise<void>;
    /** 검증 결과를 전부 지워 "재검증 필요" 상태로 되돌린다(배지는 미확인과 동일하게 표시). */
    invalidate: () => void;
}

/**
 * NextSim 필수 데이터(도로/신호등) 검증 상태 — 헤더 배지와 시설물 패널 행 표시가
 * 같은 상태를 공유해 "전체 검증"이 어디서 트리거되든 중복 fetch 없이 한 번만 돈다.
 */
export const useNextSimReadinessStore = create<NextSimReadinessState>((set) => ({
    validation: {},
    runAll: async () => {
        set((state) => {
            const next = { ...state.validation };
            NEXTSIM_REQUIRED_KEYS.forEach((key) => { next[key] = { loading: true }; });
            return { validation: next };
        });
        try {
            const results = await validateAllRequired();
            set((state) => {
                const next = { ...state.validation };
                for (const [key, result] of Object.entries(results) as [string, FacilityValidationResult][]) {
                    next[key] = { loading: false, ...result };
                }
                return { validation: next };
            });
        } catch (e) {
            set((state) => {
                const next = { ...state.validation };
                NEXTSIM_REQUIRED_KEYS.forEach((key) => {
                    next[key] = { loading: false, ok: false, issues: ["검증 중 오류가 발생했습니다."] };
                });
                return { validation: next };
            });
        }
    },
    invalidate: () => set({ validation: {} }),
}));

// ── 어떤 레이어든 편집되면 검증 결과를 무효화 ────────────────────────────────
// 검증 통과(✓) 배지를 본 뒤에 네트워크/신호/OD 등 무엇이든 수정하면, 그 순간 이전
// 검증 결과는 더 이상 신뢰할 수 없다 — 다시 "미확인" 상태로 돌아가야 사용자가 재검증
// 없이 실행 버튼을 누르는 걸 막는다. LAYER_CONFIG 전체(어떤 레이어든)를 대상으로
// isChanged가 false→true로 바뀌는 순간을 감지한다 — 검증에 실제로 쓰이는 레이어
// (network/signal/signalTod)만 골라도 되지만, "무엇이든 편집되면"이라는 요구사항과
// 향후 검증 항목이 늘어날 가능성을 감안해 전체를 대상으로 한다.
(async () => {
    const { LAYER_CONFIG } = await import("@component/tool/DataIOPanel");
    for (const cfg of LAYER_CONFIG) {
        (cfg.store as any).subscribe((state: any, prevState: any) => {
            if (state.isChanged && !prevState.isChanged) {
                useNextSimReadinessStore.getState().invalidate();
            }
        });
    }
})();
