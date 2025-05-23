import React, { useState } from "react";
import { useMenuStore, MenuTree } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";

import { propertyFormSchema } from "../form/propertyFormSchema";
import PropertyForm from "../popup/PropertyPopup";

const LeftPanel: React.FC = () => {
    const { activeDropdownMenu, setActiveDropdownMenu } = useMenuStore(useShallow((state) => ({
        activeDropdownMenu: state.activeDropdownMenu,
        setActiveDropdownMenu : state.setActiveDropdownMenu,
    })));

    // 하나의 상태 변수 activePopupKey로 현재 열려 있는 팝업을 관리합니다.
    const [ activePopupMenu, setActivePopupMenu ] = useState<MenuTree | null>(null);

    if (!activeDropdownMenu) return null;

    // activeMenu의 children (2뎁스 메뉴들)으로 itemsData 배열을 구성합니다.
    const itemsData: MenuTree[] = activeDropdownMenu.children || [];

    // 2뎁스 메뉴 클릭 시 처리하는 함수
    const handleClick = (item: MenuTree) => {
        if (propertyFormSchema[item.menuCode]) {
            setActivePopupMenu(item);
        } else {
            setActivePopupMenu(null);
        }
    };

    // 팝업 렌더링 함수: activePopupKey에 따라 popupMapping에서 구성정보를 가져와 단일 팝업 컴포넌트를 렌더링합니다.
    const renderActivePopup = () => {
        if (!activePopupMenu) return null;
        const config = propertyFormSchema[activePopupMenu.menuCode];
        if (!config) return null;
        return (
            <PropertyForm
                open
                title={ activePopupMenu.nameKor }
                menuCode={activePopupMenu.menuCode}
                fields={ config.fields }
                onClose={ () => setActivePopupMenu(null) }
                type={config.type}
                inputFields={ config.inputFields}
                rowFields={ config.rowFields}
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
                { itemsData.map((item) => (
                    <p
                        key={ item.menuId }
                        onClick={ () => handleClick(item) }
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
