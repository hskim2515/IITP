import React from "react";
import { useMenuStore } from "@stores/useMenuStore";
import Submenu from "@component/panel/Submenu";
import styles from "@css/LeftPanel.module.css";

const LeftPanel = () => {

    const {
        activeDropdownMenu,
        setActiveDropdownMenu,
    } = useMenuStore();

    const sidebarWidth = activeDropdownMenu ? 'clamp(180px, 13vw, 230px)' : '0px';

    return (
        <aside className={styles['sidebar']} style={{ ["--sidebar-width" as any]: sidebarWidth }}>
            <div className={styles['header']}>
                <h3>{activeDropdownMenu?.nameKor}</h3>
                <button className="close-btn" onClick={() => {
                    setActiveDropdownMenu(null)
                }}>
                    ×
                </button>
            </div>
            <Submenu/>
        </aside>
    );
};

export default LeftPanel;
