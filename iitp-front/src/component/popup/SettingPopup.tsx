// components/LayerPopup.tsx
import React, { useState } from 'react';
import '/static/css/styles.css';

import TestSetting from '../setting/TestSetting';

interface SettingPopupProps {
    isOpen: boolean;
}

// 탭 구성 정의 (label은 탭 이름, key는 매핑용)
const tabConfig = [
    { label: '테스트 설정', key: 'testSetting' }
];

// key에 매핑되는 컴포넌트 정의
const tabComponentMap: Record<string, React.FC<{ fields: any[] }>> = {
    testSetting: TestSetting
};

const SettingPopup: React.FC<SettingPopupProps> = ({ isOpen }) => {
    const [activeKey, setActiveKey] = useState(tabConfig[0].key);

    if (!isOpen) return null;

    const ActiveComponent = tabComponentMap[activeKey];

    return (
        <div className="layer-popup">
            <div className="tabs">
                {tabConfig.map(tab => (
                    <button
                        key={tab.key}
                        className={`tab ${activeKey === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveKey(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {ActiveComponent && <ActiveComponent fields={[activeKey]} />}
        </div>
    );
};

export default SettingPopup;
