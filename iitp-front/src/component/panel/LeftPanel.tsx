import React, { useState } from "react";
import { useMenuStore, MenuTree } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";

import { propertyFormSchema } from "../form/propertyFormSchema";
import PropertyForm from "../popup/PropertyPopup";
import PropertyPanel from "./PropertyPanel";

const LeftPanel: React.FC = () => {
    const {
        activeDropdownMenu,
        activeSubmenu,
        setActiveDropdownMenu,
        setActiveSubmenu,
    } = useMenuStore();

    if (!activeDropdownMenu) return null;

    // 서브 메뉴 데이터 배열(필드 포함) - 좌측에 서브메뉴 목록 띄우기 위함
    const submenuData: MenuTree[] = activeDropdownMenu.children;

    // 서브메뉴 클릭 시 처리
    const handleClickSubmenu = (item: MenuTree) => {
        if (propertyFormSchema[item.menuCode]) {
            setActiveSubmenu(item);
        } else {
            setActiveSubmenu(null);
        }
    };

    // 팝업 렌더링 함수: activePopupKey에 따라 popupMapping에서 구성정보를 가져와 단일 팝업 컴포넌트를 렌더링합니다.
    const renderActivePopup = () => {
        if (!activeSubmenu) return null;

        const config = propertyFormSchema[activeSubmenu.menuCode];
        if (!config) return null;

        // map과 상호작용이 필요한 컴포넌트 임시로 분리
        if (activeDropdownMenu.menuCode === "FACILITY") return (
            <PropertyPanel
                activeSubmenu={ activeSubmenu }
                onClose={ () => setActiveSubmenu(null) }
            />
        )
        return (
            <PropertyForm
                open
                activePopupMenu={activeSubmenu}
                onClose={ () => setActiveSubmenu(null) }
                config={config}
            />
        );
    };

    return (
        <div style={ styles.sidebar }>
            <div style={ styles.header }>
                <h3>{ activeDropdownMenu.nameKor }</h3>
                <button style={ styles.closeButton } onClick={ () => setActiveDropdownMenu(null) }>
                    ×
                </button>
            </div>
            <div>
                { submenuData.map((item) => (
                    <p
                        key={ item.menuId }
                        onClick={ () => handleClickSubmenu(item) }
                        style={ styles.menuItem }
                    >
                        { item.nameKor }
                    </p>
                )) }
            </div>
            { renderActivePopup() }
        </div>
    );
};

const styles = {
    sidebar: {
        width: "200px",
        backgroundColor: "#222",
        color: "#fff",
        padding: "20px",
        position: "fixed" as const,
        left: 0,
        top: "50px",
        zIndex: 999,
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
