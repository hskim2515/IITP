import React, { useEffect, useState } from 'react';
import { useMenuStore, MenuTree } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import SimulationControls from "./SimulationControls";

const Header: React.FC = () => {
    const { menu, setMenu, activeDropdownMenu, setActiveDropdownMenu } = useMenuStore(useShallow((state) => ({
        menu: state.menu,
        setMenu: state.setMenu,
        activeDropdownMenu: state.activeDropdownMenu,
        setActiveDropdownMenu: state.setActiveDropdownMenu,
    })));
    const baseUrl =process.env.VITE_API_URL;
    const menuTreeUrl = `${baseUrl}/menu/tree`;

    // 컴포넌트 마운트 시 백엔드에서 메뉴 트리 데이터를 fetch하여 zustand 스토어에 저장
    useEffect(() => {
        fetch(menuTreeUrl, { method: "GET" })
            .then(response => response.json())
            .then(data => setMenu(data))
            .catch(error => console.error("메뉴 데이터 가져오기 실패:", error));
    }, [setMenu]);

    // 0뎁스 메뉴만 필터링
    const topMenus = menu ? menu.filter(item => item.depth === 0) : [];

    return (
        <header style={styles.header}>
            <nav style={styles.nav}>
                {topMenus.map(menuItem => (
                    <DropdownMenu
                        key={menuItem.menuId}
                        title={menuItem.nameKor}
                        // 자식 메뉴의 MenuTree 객체 배열을 props로 전달
                        items={menuItem.children || []}
                        setActiveDropdownMenu={setActiveDropdownMenu}
                    />
                ))}
            </nav>
            <SimulationControls />
        </header>
    );
};

// DropdownMenu 컴포넌트의 props 타입을 MenuTree 항목을 포함하도록 수정
interface DropdownMenuProps {
    title: string;
    items: MenuTree[];
    setActiveDropdownMenu: (menu: MenuTree) => void;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ title, items, setActiveDropdownMenu }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div
            style={styles.menuContainer}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <span style={styles.menuTitle}>{title}</span>
            {isOpen && (
                <div style={styles.dropdown}>
                    {items.map((item, index) => (
                        <div
                            key={item.menuId} // key로 menuId를 사용하는 것이 고유 식별에 좋습니다.
                            style={styles.menuItem}
                            onClick={() => {
                                setActiveDropdownMenu(item);
                                console.log("activeDropdownMenu set:", item);
                            }}
                        >
                            {item.nameKor}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const styles = {
    header: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        width: '98%',
        height: '50px',
        backgroundColor: '#333',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 1000,
    },
    nav: {
        display: 'flex',
        gap: '20px',
    },
    menuContainer: {
        position: 'relative' as const,
        cursor: 'pointer',
    },
    menuTitle: {
        padding: '10px',
        fontSize: '16px',
    },
    dropdown: {
        position: 'absolute' as const,
        top: '100%',
        left: 0,
        backgroundColor: '#444',
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
        borderRadius: '4px',
        overflow: 'hidden',
        minWidth: '150px',
    },
    menuItem: {
        padding: '10px',
        cursor: 'pointer',
        color: '#fff',
        fontSize: '14px',
        borderBottom: '1px solid #555',
        backgroundColor: '#444',
        transition: 'background 0.3s',
    },
};

export default Header;
