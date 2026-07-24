import React from 'react';
import AppSettings from '../setting/AppSettings';
import styles from "@css/ToolsPanel.module.css";

interface SettingPopupProps {
    isOpen: boolean;
}

const SettingPopup: React.FC<SettingPopupProps> = ({ isOpen }) => {
    if (!isOpen) return null;

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tabActive} style={{ cursor: 'default' }}>설정</span>
            </div>
            <div className={styles.panelBody}>
                <AppSettings />
            </div>
        </>
    );
};

export default SettingPopup;
