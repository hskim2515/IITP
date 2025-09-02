import { create } from "zustand";
import { combine } from "zustand/middleware";
import { createSelectors } from "@stores/createSelectors";

// 트리 구조 데이터를 표현하는 인터페이스
export interface MenuTree {
    menuId: number;
    menuCode: string; // 호출 편의를 위해 layer 이름으로 사용 중
    language: string;
    nameKor: string;
    nameEn: string;
    depth: number;
    sortOrder: number; // 메뉴 배치 순서를 위한 변수
    available: string; // 필요에 따라 "Y" | "N" 등으로 변경 가능
    children?: MenuTree[];
    rootId: number; // 최상단 메뉴의 ID, 메뉴 위치 변경 고려
}

interface State {
    menu: MenuTree[] | null;
    activeDropdownMenu: MenuTree | null;
    activeSubmenu: MenuTree | null;
}

interface Actions {
    setMenu: (menu: MenuTree[]) => void;
    setActiveDropdownMenu: (menu: MenuTree | null) => void;
    setActiveSubmenu: (menu: MenuTree | null) => void;
}
const initialState: State = {
    menu: null,
    activeDropdownMenu: null,
    activeSubmenu: null,
}

export const useMenuStore = createSelectors(create<State & Actions>(
    (combine(initialState,(set) => ({
            setMenu: (state) => set({ menu: state }),
            setActiveDropdownMenu: (state) => set({ activeDropdownMenu: state }),
            setActiveSubmenu: (state) => set({ activeSubmenu: state }),
        })
    ))
));

export function findMenuByCode(menuList: MenuTree[], code: string): MenuTree | null {
    for (const menu of menuList) {
        if (menu.menuCode === code) {
            return menu;
        }
        if (menu.children) {
            const found = findMenuByCode(menu.children, code);
            if (found) return found;
        }
    }
    return null;
}

