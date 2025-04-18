import React, { useState } from 'react';
import { layerSchema, LayerField } from '../layer/layerSchema';
import '/static/css/styles.css';

import BaseMap  from '../layer/BaseMap';
import Analysis    from '../layer/Analysis';
import Facility from '../layer/Facility';
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow }     from "zustand/react/shallow";

interface LayerPopupProps {
    isOpen: boolean;
}

type LayerGroupKey = keyof typeof layerSchema;
const tabKeys = Object.keys(layerSchema) as LayerGroupKey[];

// key → 컴포넌트 매핑
const tabComponentMap: Record<LayerGroupKey, React.FC<{ fields: LayerField[] }>> = {
    baseMap:  BaseMap,
    layer:    Analysis,
    facility: Facility,
};

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    if (!isOpen) return null;

    const [activeTab, setActiveTab] = useState(0);
    const { setActiveLayerGroupName } = useLayerStore(useShallow(state => ({
        setActiveLayerGroupName: state.setActiveLayerGroupName,
    })));

    const handleTabClick = (idx: number) => {
        setActiveTab(idx);
        setActiveLayerGroupName(tabKeys[idx]); // 그룹명 설정 추가
    };

    const currentKey     = tabKeys[activeTab];
    const ActiveComponent = tabComponentMap[currentKey];
    const fields          = layerSchema[currentKey].fields;

    return (
        <div className="layer-popup">
            <div className="tabs">
                {tabKeys.map((key, idx) => (
                    <button
                        key={key}
                        className={`tab ${activeTab === idx ? 'active' : ''}`}
                        onClick={() => handleTabClick(idx)}
                    >
                        {layerSchema[key].label}
                    </button>
                ))}
            </div>
            <ActiveComponent fields={fields} />
        </div>
    );
};

export default LayerPopup;
