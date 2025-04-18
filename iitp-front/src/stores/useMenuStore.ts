import { create } from "zustand";
import { devtools } from "zustand/middleware";

// 트리 구조 데이터를 표현하는 인터페이스
export interface MenuTree {
    menuId: number;
    menuCode: string;
    language: string;
    nameKor: string;
    nameEn: string;
    depth: number;
    sortOrder: number;
    available: string; // 필요에 따라 "Y" | "N" 등으로 변경 가능
    children?: MenuTree[];
    rootId: number;
}

// zustand 스토어 상태 인터페이스
interface MenuState {
    menu: MenuTree[] | null;
    activeDropdownMenu: MenuTree | null;
    setMenu: (menu: MenuTree[]) => void;
    setActiveDropdownMenu: (menu: MenuTree[]) => void;
}

// zustand 스토어 생성 (devtools 적용)
export const useMenuStore = create<MenuState>(((set) => ({
        menu: null,
        activeDropdownMenu: null,
        setMenu: (state: MenuTree[]) => set({ menu: state }),
        setActiveDropdownMenu: (state: MenuTree) => set({ activeDropdownMenu: state }),
})));
