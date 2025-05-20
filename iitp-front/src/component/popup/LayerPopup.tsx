// components/LayerPopup.tsx
import React, { useEffect, useState } from 'react';
import '/static/css/styles.css';

import BaseMap from '../layer/BaseMap';
import Analysis from '../layer/Analysis';
import Facility from '../layer/Facility';

import { useLayerStore } from '@stores/useLayerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLayerSchemaStore } from '@stores/useLayerSchemaStore';

interface LayerPopupProps {
    isOpen: boolean;
}

const tabComponentMap: Record<string, React.FC<{ fields: any[] }>> = {
    baseMap: BaseMap,
    layer: Analysis,
    facility: Facility,
};

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    const [activeTab, setActiveTab] = useState(0);
    const { setActiveLayerGroupName } = useLayerStore(useShallow(state => ({
        setActiveLayerGroupName: state.setActiveLayerGroupName,
    })));

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();

    useEffect(() => {
        if (isOpen) fetchLayerSchema();
    }, [isOpen]);

    const handleTabClick = (idx: number) => {
        setActiveTab(idx);
        setActiveLayerGroupName(groups[idx].key); // 그룹명 설정
    };

    if (!isOpen || loading || groups.length === 0) return null;

    const current = groups[activeTab];
    const ActiveComponent = tabComponentMap[current.key];

    return (
        <div className="layer-popup">
            <div className="tabs">
                {groups.map((group, idx) => (
                    <button
                        key={group.key}
                        className={`tab ${activeTab === idx ? 'active' : ''}`}
                        onClick={() => handleTabClick(idx)}
                    >
                        {group.label}
                    </button>
                ))}
            </div>
            {ActiveComponent && <ActiveComponent fields={current.fields} />}
        </div>
    );
};

export default LayerPopup;
