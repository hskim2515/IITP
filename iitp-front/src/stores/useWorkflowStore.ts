import {create} from "zustand";
import {MenuTreeResponse} from "@type/openapi.gen";

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
                    isMinimized: false,
                    menu: menu,  // ← 추가
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
        set({
            sessions: remaining,
            activeMenuCode: activeMenuCode === menuCode
                ? (remaining[remaining.length - 1]?.menuCode ?? null)
                : activeMenuCode
        });
    }
}));