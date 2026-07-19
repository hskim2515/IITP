import {create} from "zustand";
import {MenuTreeResponse} from "@type/openapi.gen";
import {NETWORK_TILING} from "@utils/lodConstants";
import {useNetworkTileStore} from "@stores/useNetworkTileStore";

interface EditingSession {
    menuCode: string;
    nameKor: string;
    isMinimized: boolean;
    menu: MenuTreeResponse;
}

export const useWorkflowStore = create((set, get) => ({
    sessions: [] as EditingSession[],
    activeMenuCode: null as string | null,

    openSession: (menu: MenuTreeResponse) => {
        const { sessions } = get();
        const existing = sessions.find(s => s.menuCode === menu.menuCode);
        // 타일 모드 NETWORK 편집: 그리드가 viewport 동기화 데이터만 보여 의미가 약한데
        // 화면 하단 40%를 차지 + 편집 가이드 패널과 겹침 → 접힌 상태로 시작 (태스크바에서 펼침)
        const startMinimized = menu.menuCode === 'NETWORK'
            && (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode);
        if (existing) {
            set({
                activeMenuCode: menu.menuCode,
                sessions: sessions.map(s =>
                    s.menuCode === menu.menuCode ? { ...s, isMinimized: false } : s
                )
            });
        } else {
            set({
                activeMenuCode: menu.menuCode,
                sessions: [...sessions, {
                    menuCode: menu.menuCode,
                    nameKor: menu.nameKor,
                    isMinimized: startMinimized,
                    menu: menu,
                }]
            });
        }
    },

    // 최소화 로직
    minimizeSession: (menuCode: string) => {
        set({
            activeMenuCode: null,
            sessions: get().sessions.map(s =>
                s.menuCode === menuCode ? { ...s, isMinimized: true } : s
            )
        });
    },

    closeSession: (menuCode: string) => {
        const { sessions, activeMenuCode } = get();
        const remaining = sessions.filter(s => s.menuCode !== menuCode);
        let nextActive = activeMenuCode;
        if (activeMenuCode === menuCode) {
            // 최소화되지 않은 마지막 세션으로 복원, 없으면 null
            const candidate = [...remaining].reverse().find(s => !s.isMinimized);
            nextActive = candidate?.menuCode ?? null;
        }
        set({
            sessions: remaining,
            activeMenuCode: nextActive,
        });
    },

    // Taskbar 토글: active면 minimize, 아니면 restore
    toggleSession: (menu: MenuTreeResponse) => {
        const { sessions, activeMenuCode } = get();
        const existing = sessions.find(s => s.menuCode === menu.menuCode);
        if (existing && activeMenuCode === menu.menuCode && !existing.isMinimized) {
            // 이미 활성 상태 → 최소화
            set({
                activeMenuCode: null,
                sessions: sessions.map(s =>
                    s.menuCode === menu.menuCode ? { ...s, isMinimized: true } : s
                )
            });
        } else {
            // 최소화 상태이거나 비활성 → 복원/활성화
            get().openSession(menu);
        }
    }
}));