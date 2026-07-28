import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BaseMapType } from '@stores/useMapStore';

/** 더미 신호 자동생성(signal.ts의 generateDummySignals, "화면 내 더미 신호 생성" 버튼) 파라미터.
 *  도로 형태가 지역마다 달라 고정값 하나로는 안 맞는 경우가 있어 사용자가 조정할 수 있게 노출.
 *  oppositeBearingToleranceDeg는 자동생성뿐 아니라 수동 편집 상충 검사(checkManualSignalEditConflicts)
 *  에도 같은 값이 쓰인다 — "마주보는 접근로" 판정 기준을 자동생성/수동편집 양쪽에서 일치시키기 위함. */
export interface AutoGenerationSettings {
    /** 더미 신호 현시(phase) 1개당 길이 (초) */
    signalPhaseDurationSec: number;
    /** 두 접근로 방위각差가 180±이 값(도) 이내면 "마주보는 방향"(동시 녹색 안전)으로 판정 */
    signalOppositeBearingToleranceDeg: number;
}

export const DEFAULT_AUTO_GENERATION_SETTINGS: AutoGenerationSettings = {
    signalPhaseDurationSec: 30,
    signalOppositeBearingToleranceDeg: 30,
};

/**
 * 브라우저에 영속되는(localStorage) 사용자 앱 설정 — 시나리오/버전과 무관하게 이 브라우저에서
 * 항상 유지되는 개인 취향 설정. 시나리오별 값(예: 네트워크 타일 모드)은 useNetworkTileStore처럼
 * 별도 스토어를 쓴다.
 */
interface AppSettingsState {
    /** 세션 시작 시 적용할 배경지도 기본값. null이면 서버 레이어 스키마의 basic 필드를 그대로 사용
     *  (BaseMap.tsx가 폴백 처리). */
    defaultBaseMap: BaseMapType | null;
    setDefaultBaseMap: (v: BaseMapType | null) => void;

    autoGeneration: AutoGenerationSettings;
    setAutoGeneration: (partial: Partial<AutoGenerationSettings>) => void;
    resetAutoGeneration: () => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
    persist(
        (set) => ({
            defaultBaseMap: null,
            setDefaultBaseMap: (v) => set({ defaultBaseMap: v }),

            autoGeneration: DEFAULT_AUTO_GENERATION_SETTINGS,
            setAutoGeneration: (partial) =>
                set((s) => ({ autoGeneration: { ...s.autoGeneration, ...partial } })),
            resetAutoGeneration: () => set({ autoGeneration: DEFAULT_AUTO_GENERATION_SETTINGS }),
        }),
        { name: 'app-settings' },
    ),
);
