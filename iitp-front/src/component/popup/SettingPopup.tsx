import React, { useState } from 'react';
import TestSetting from '../setting/TestSetting';
import styles from "@css/ToolsPanel.module.css";

interface SettingPopupProps {
    isOpen: boolean;
}

const tabConfig = [
    { label: '테스트 설정', key: 'testSetting' }
];

const tabComponentMap: Record<string, React.FC<{ fields: any[] }>> = {
    testSetting: TestSetting
};

const SettingPopup: React.FC<SettingPopupProps> = ({ isOpen }) => {
    const [activeKey, setActiveKey] = useState(tabConfig[0].key);

    if (!isOpen) return null;

    const ActiveComponent = tabComponentMap[activeKey];

    return (
        <>
            <div className={styles.panelHeader}>
                {tabConfig.map(tab => (
                    <button
                        key={tab.key}
                        className={activeKey === tab.key ? styles.tabActive : styles.tab}
                        onClick={() => setActiveKey(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className={styles.panelBody}>
                {ActiveComponent && <ActiveComponent fields={[activeKey]} />}
            </div>
        </>
    );
};

export default SettingPopup;
