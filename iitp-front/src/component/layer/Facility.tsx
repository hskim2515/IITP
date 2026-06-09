import React, { useEffect, useMemo, useState } from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import styles from "@css/ToolsPanel.module.css";

export interface FacilityProps {
    fields: LayerField[];
}

const getNestedArrayFieldsRecursive = (row: any): string[] => {
    if (!row || typeof row !== "object") return [];
    let nestedFields: string[] = [];
    for (const key in row) {
        const value = row[key];
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0].featureType) {
            nestedFields.push(key);
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value[0]));
        } else if (typeof value === "object" && value !== null) {
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value));
        }
    }
    return nestedFields;
};

const Facility = ({ fields }: FacilityProps) => {
    const { activeLayerName, addActiveLayerName, removeActiveLayerName, layerManager } = useLayerStore();
    const nestedArrayFieldsMap: Record<string, string[]> = {};
    const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

    // store의 currentJsonData 변화를 감지해 visibleFields 재계산
    const [, setDataTick] = useState(0);

    useEffect(() => {
        const unsubs: Array<() => void> = [];
        fields.forEach(field => {
            const store = layerNameToStoreMap[field.key];
            if (store) {
                unsubs.push((store as any).subscribe(
                    (state: any) => state.currentJsonData,
                    () => setDataTick(t => t + 1),
                    { equalityFn: (a: any, b: any) => a === b }
                ));
            }
        });
        return () => unsubs.forEach(u => u());
    }, [fields]);

    // 스토어에 데이터가 있는 레이어만 목록에 표시
    // (OL source 피처 수 기준은 꺼진 레이어를 잘못 제외하므로 store 기준으로 판단)
    const visibleFields = useMemo(() => {
        if (!layerManager) return fields;
        return fields.filter((field) => {
            const store = layerNameToStoreMap[field.key];
            if (store) {
                const data = store.getState().currentJsonData;
                if (data == null) return false;
                // 객체인 경우 배열 프로퍼티가 하나라도 있으면 표시
                if (typeof data === 'object' && !Array.isArray(data)) {
                    return Object.values(data).some(v => Array.isArray(v) ? v.length > 0 : v != null);
                }
                return Array.isArray(data) ? data.length > 0 : true;
            }
            // store 없는 레이어는 OL source 피처 수로 판단
            const layer = layerManager.getLayerByName(field.key);
            const featureCount = layer?.getSource?.()?.getFeatures?.()?.length ?? 0;
            return featureCount > 0;
        });
    }, [fields, layerManager]);

    const toggleExpand = (parentKey: string) => {
        setExpandedParents(prev => ({ ...prev, [parentKey]: !prev[parentKey] }));
    };

    const defaultSelected = visibleFields.find(field => field.basic)?.key || null;

    visibleFields.forEach((field) => {
        if (layerManager) {
            const store = layerNameToStoreMap[field.key];
            const currentJsonData = store?.getState().currentJsonData;
            if (currentJsonData) {
                nestedArrayFieldsMap[field.key] = getNestedArrayFieldsRecursive(currentJsonData);
            }
        }
    });

    useEffect(() => {
        if (defaultSelected) {
            addActiveLayerName(defaultSelected);
            (nestedArrayFieldsMap[defaultSelected] || []).forEach(child => {
                addActiveLayerName(`${defaultSelected}.${child}`);
            });
        }
    }, [defaultSelected]);

    const isParentChecked = (key: string) => {
        const children = nestedArrayFieldsMap[key] || [];
        if (children.length === 0) return activeLayerName?.includes(key);
        return children.some(child => activeLayerName?.includes(`${key}.${child}`));
    };

    const isChildChecked = (parentKey: string, childKey: string) =>
        activeLayerName?.includes(`${parentKey}.${childKey}`);

    const toggleParent = (parentKey: string, checked: boolean) => {
        const children = nestedArrayFieldsMap[parentKey] || [];
        if (checked) {
            addActiveLayerName(parentKey);
            children.forEach(child => {
                addActiveLayerName(`${parentKey}.${child}`);
            });
            layerManager?.showLayer('facility', parentKey);
        } else {
            removeActiveLayerName(parentKey);
            children.forEach(child => {
                removeActiveLayerName(`${parentKey}.${child}`);
            });
            layerManager?.hideLayer('facility', parentKey);
        }
    };

    const toggleChild = (parentKey: string, childKey: string, checked: boolean) => {
        const fullKey = `${parentKey}.${childKey}`;
        if (checked) {
            addActiveLayerName(fullKey);
            if (!activeLayerName?.includes(parentKey)) addActiveLayerName(parentKey);
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, true);
        } else {
            removeActiveLayerName(fullKey);
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, false);
            const children = nestedArrayFieldsMap[parentKey] || [];
            const anyChecked = children.some(child => activeLayerName?.includes(`${parentKey}.${child}`));
            if (!anyChecked) removeActiveLayerName(parentKey);
        }
    };

    return (
        <div>
            {visibleFields.map((field) => {
                const parentKey = field.key;
                const nestedFields = nestedArrayFieldsMap[parentKey] || [];
                const isExpanded = expandedParents[parentKey] ?? false;
                const parentChecked = !!isParentChecked(parentKey);

                return (
                    <div key={parentKey}>
                        <div
                            className={`${styles.sectionLabel} ${parentChecked ? styles.layerItemChecked : ''}`}
                            onClick={() => nestedFields.length && toggleExpand(parentKey)}
                        >
                            {nestedFields.length > 0 && (
                                <span className={styles.sectionToggle}>
                                    {isExpanded ? '▼' : '▶'}
                                </span>
                            )}
                            <span style={{ flex: 1 }}>{field.label}</span>
                            <input
                                type="checkbox"
                                checked={parentChecked}
                                onChange={(e) => toggleParent(parentKey, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ accentColor: '#7aa2ff', width: 13, height: 13, cursor: 'pointer' }}
                            />
                        </div>

                        {isExpanded && nestedFields.map(childKey => {
                            const childChecked = !!isChildChecked(parentKey, childKey);
                            return (
                            <label key={`${parentKey}.${childKey}`} className={`${styles.childItem} ${childChecked ? styles.layerItemChecked : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={childChecked}
                                    onChange={(e) => toggleChild(parentKey, childKey, e.target.checked)}
                                />
                                {childKey}
                            </label>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};

export default Facility;
