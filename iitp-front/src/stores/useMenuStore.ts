import { create } from "zustand";
import { combine } from "zustand/middleware";
import { createSelectors } from "@stores/createSelectors";
import { MenuTreeResponse } from "@type/openapi.gen";

interface State {
    menu: MenuTreeResponse[] | null;
    activeDropdownMenu: MenuTreeResponse | null;
    activeSubmenu: MenuTreeResponse | null;
}

interface Actions {
    setMenu: (menu: MenuTreeResponse[]) => void;
    setActiveDropdownMenu: (menu: MenuTreeResponse | null) => void;
    setActiveSubmenu: (menu: MenuTreeResponse | null) => void;
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

export function findMenuByCode(menuList: MenuTreeResponse[], code: string): MenuTreeResponse | null {
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

// target이 root에 포함되어 있는 메뉴인지 확인
export function isIncludesMenuCode(root: MenuTreeResponse, targetCode: string | undefined | null): boolean {
    if(!targetCode) return false;
    if(root.menuCode === targetCode) return true;
    if(root.children && root.children.length > 0) {
        for (const child of root.children) {
            if (isIncludesMenuCode(child, targetCode)) return true;
        }
    }
    return false;
}

// 메뉴List에서 parent를 찾고, target이 속해있는지 확인
export function isDescendantOf(
    menuList: MenuTreeResponse[] | null,
    parentCode: string,
    targetCode: string | undefined | null
): boolean {
    if (!menuList || !parentCode || !targetCode) return false;
    const parent = findMenuByCode(menuList, parentCode);
    if (!parent) return false;
    return isIncludesMenuCode(parent, targetCode);
}