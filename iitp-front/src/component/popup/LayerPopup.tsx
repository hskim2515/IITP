import React, { useEffect, useState } from 'react';
import BaseMap from '../layer/BaseMap';
import Analysis from '../layer/Analysis';
import Facility from '../layer/Facility';
import { useLayerStore } from '@stores/useLayerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLayerSchemaStore } from '@stores/useLayerSchemaStore';
import styles from "@css/ToolsPanel.module.css";

interface LayerPopupProps {
    isOpen: boolean;
}

const tabComponentMap: Record<string, React.FC<{ fields: any[] }>> = {
    baseMap: BaseMap,
    analyze: Analysis,
    facility: Facility,
};

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    const [activeTab, setActiveTab] = useState(0);
    const { setActiveLayerGroupName } = useLayerStore(useShallow(state => ({
        setActiveLayerGroupName: state.setActiveLayerGroupName,
    })));

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();

    useEffect(() => {
        if (isOpen && !loading) fetchLayerSchema();
    }, [isOpen]);

    const handleTabClick = (idx: number) => {
        setActiveTab(idx);
        setActiveLayerGroupName(groups[idx].key);
    };

    if (!isOpen || loading || groups.length === 0) return null;

    const current = groups[activeTab];
    const ActiveComponent = tabComponentMap[current.key];

    return (
        <>
            <div className={styles.panelHeader}>
                {groups.map((group, idx) => (
                    <button
                        key={group.key}
                        className={activeTab === idx ? styles.tabActive : styles.tab}
                        onClick={() => handleTabClick(idx)}
                    >
                        {group.label}
                    </button>
                ))}
            </div>
            <div className={styles.panelBody}>
                {ActiveComponent && <ActiveComponent fields={current.fields} />}
            </div>
        </>
    );
};

export default LayerPopup;
