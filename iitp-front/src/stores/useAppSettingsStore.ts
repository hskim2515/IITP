import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BaseMapType } from '@stores/useMapStore';

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
}

export const useAppSettingsStore = create<AppSettingsState>()(
    persist(
        (set) => ({
            defaultBaseMap: null,
            setDefaultBaseMap: (v) => set({ defaultBaseMap: v }),
        }),
        { name: 'app-settings' },
    ),
);
