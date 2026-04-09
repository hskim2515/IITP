import React, { useEffect, useState } from 'react';
import BaseMap from '../layer/BaseMap';
import Analysis from '../layer/Analysis';
import Facility from '../layer/Facility';
import ThreeDTiles from '../layer/ThreeDTiles';
import { useLayerStore } from '@stores/useLayerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLayerSchemaStore, LayerField } from '@stores/useLayerSchemaStore';
import styles from "@css/ToolsPanel.module.css";

interface LayerPopupProps {
    isOpen: boolean;
}

const SCHEMA_TAB_MAP: Record<string, React.FC<{ fields: LayerField[] }>> = {
    baseMap: BaseMap,
    facility: Facility,
    analyze: Analysis,
};

/** schema와 무관한 고정 탭 — baseMap 다음에 삽입 */
const FIXED_TABS = [
    { key: '3dTiles', label: '3D Tiles', component: ThreeDTiles },
];

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    const [activeTab, setActiveTab] = useState(0);
    const { setActiveLayerGroupName } = useLayerStore(useShallow(state => ({
        setActiveLayerGroupName: state.setActiveLayerGroupName,
    })));

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();

    useEffect(() => {
        if (isOpen && !loading) fetchLayerSchema();
    }, [isOpen]);

    if (!isOpen || loading || groups.length === 0) return null;

    // baseMap 탭 다음에 3D Tiles 고정 탭 삽입
    const baseMapIdx = groups.findIndex(g => g.key === 'baseMap');
    const allTabs: Array<{ key: string; label: string; isFixed: boolean }> = [];
    groups.forEach((g, i) => {
        allTabs.push({ key: g.key, label: g.label, isFixed: false });
        if (i === baseMapIdx) {
            FIXED_TABS.forEach(ft => allTabs.push({ key: ft.key, label: ft.label, isFixed: true }));
        }
    });

    const current = allTabs[activeTab] ?? allTabs[0];

    const handleTabClick = (idx: number) => {
        setActiveTab(idx);
        const tab = allTabs[idx];
        if (tab && !tab.isFixed) setActiveLayerGroupName([tab.key]);
    };

    const renderContent = () => {
        if (!current) return null;
        if (current.isFixed) {
            const fixed = FIXED_TABS.find(ft => ft.key === current.key);
            if (!fixed) return null;
            const Comp = fixed.component;
            return <Comp fields={[]} />;
        }
        const schemaGroup = groups.find(g => g.key === current.key);
        const Comp = SCHEMA_TAB_MAP[current.key];
        if (!Comp || !schemaGroup) return null;
        return <Comp fields={schemaGroup.layers} />;
    };

    return (
        <>
            <div className={styles.panelHeader}>
                {allTabs.map((tab, idx) => (
                    <button
                        key={tab.key}
                        className={activeTab === idx ? styles.tabActive : styles.tab}
                        onClick={() => handleTabClick(idx)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className={styles.panelBody}>
                {renderContent()}
            </div>
        </>
    );
};

export default LayerPopup;
