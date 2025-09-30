import React, { useEffect } from 'react';
import { useMenuStore } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import { apiConfig } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import DropdownMenu from "@component/header/DropdownMenu";
import styles from "@css/Header.module.css"

const HeaderMenu = () => {
    const {menu, setMenu} = useMenuStore(useShallow((state) => ({
        menu: state.menu,
        setMenu: state.setMenu,
    })));

    useEffect(() => {
        const fetchMenu = async () => {
            try {
                const config = apiConfig["MENU"]?.tree
                const response = await axiosInstance({
                    method: config?.method,
                    url: config?.url
                });
                const data = response.data;
                setMenu(data)
            } catch (e) {
                console.error(e)
            }
        }
        fetchMenu()
    }, [setMenu]);
    // 0뎁스 메뉴만 필터링
    const topMenus = menu
        ? menu.filter(item => item.depth === 0)
        : [];

    return (
        <nav className={styles['nav']}>
            {topMenus.map(menuItem => (
                <DropdownMenu
                    key={menuItem.menuId}
                    title={menuItem.nameKor || ""}
                    items={menuItem.children || []}
                />
            ))}
        </nav>
    );
}

export default HeaderMenu;