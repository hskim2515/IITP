import React, { useEffect } from "react";
import { useMenuStore, MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "@schema/propertyFormSchema";

const LeftPanel = () => {

    const {
        activeDropdownMenu,
        activeSubmenu,
        setActiveDropdownMenu,
        setActiveSubmenu,
    } = useMenuStore();

    useEffect(() => {
        if(!activeDropdownMenu) return
    }, [activeDropdownMenu]);

    if (!activeDropdownMenu) return null;

    // FACILITY인 경우: 사이드바 없이 PropertyPanel만 렌더링
    if (activeDropdownMenu.menuCode === "FACILITY" && activeSubmenu) return null;

    // 일반 메뉴인 경우: 사이드바 + 팝업
    const submenuData: MenuTree[] | undefined = activeDropdownMenu.children;

    const handleClickSubmenu = (item: MenuTree) => {
        if (propertyFormSchema[item.menuCode]) {
            setActiveSubmenu(item);
        } else {
            setActiveSubmenu(null);
        }
    };

    return (
        <div style={styles.sidebar}>
            <div style={styles.header}>
                <h3>{activeDropdownMenu.nameKor}</h3>
                <button className="close-btn" onClick={() => {
                    setActiveDropdownMenu(null)
                    setActiveSubmenu(null)
                }}>
                    ×
                </button>
            </div>
            <div>
                {submenuData && submenuData.map((item) => (
                    <p
                        key={item.menuId}
                        onClick={() => handleClickSubmenu(item)}
                        style={styles.menuItem}
                    >
                        {item.nameKor}
                    </p>
                ))}
            </div>
        </div>
    );
};


const styles = {
    sidebar: {
        width: "12vw",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        color: "#fff",
        padding: "20px",
        position: "fixed" as const,
        left: 0,
        top: "50px",
        zIndex: 998,
        bottom: 0,
        display: "flex",
        flexDirection: "column" as const,
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
    },
    menuItem: {
        cursor: "pointer",
        margin: "4px 0",
    },
};

export default LeftPanel;
