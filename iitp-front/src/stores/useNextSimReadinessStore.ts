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
}));
