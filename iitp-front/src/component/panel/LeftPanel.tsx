import React from "react";
import { useMenuStore, MenuTree } from "@stores/useMenuStore";

import { propertyFormSchema } from "@component/form/propertyFormSchema";
import PropertyForm from "@component/popup/PropertyPopup";

const LeftPanel = () => {
    const {
        activeDropdownMenu,
        activeSubmenu,
        setActiveDropdownMenu,
        setActiveSubmenu,
    } = useMenuStore();

    if (!activeDropdownMenu) return null;

    // FACILITY인 경우: 사이드바 없이 PropertyPanel만 렌더링
    if (activeDropdownMenu.menuCode === "FACILITY" && activeSubmenu) {
        return;
    }

    // 일반 메뉴인 경우: 사이드바 + 팝업
    const submenuData: MenuTree[] | undefined = activeDropdownMenu.children;

    const handleClickSubmenu = (item: MenuTree) => {
        if (propertyFormSchema[item.menuCode]) {
            setActiveSubmenu(item);
        } else {
            setActiveSubmenu(null);
        }
    };

    const renderActivePopup = () => {
        if (!activeSubmenu) return null;

        const config = propertyFormSchema[activeSubmenu.menuCode];
        if (!config) return null;

        return (
            <PropertyForm
                open
                activePopupMenu={activeSubmenu}
                onClose={() => setActiveSubmenu(null)}
                config={config}
            />
        );
    };

    return (
        <div style={styles.sidebar}>
            <div style={styles.header}>
                <h3>{activeDropdownMenu.nameKor}</h3>
                <button style={styles.closeButton} onClick={() => setActiveDropdownMenu(null)}>
                    ×
                </button>
            </div>
            <div>
                {submenuData.map((item) => (
                    <p
                        key={item.menuId}
                        onClick={() => handleClickSubmenu(item)}
                        style={styles.menuItem}
                    >
                        {item.nameKor}
                    </p>
                ))}
            </div>
            {renderActivePopup()}
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
    closeButton: {
        background: "none",
        border: "none",
        color: "#fff",
        fontSize: "20px",
        cursor: "pointer",
    },
    menuItem: {
        cursor: "pointer",
        margin: "4px 0",
    },
};

export default LeftPanel;
