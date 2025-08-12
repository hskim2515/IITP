import React, {useEffect, useState} from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

export interface FacilityProps {
    fields: LayerField[];
}

const getNestedArrayFieldsRecursive = (row: any): string[] => {
    if (!row || typeof row !== "object") return [];

    let nestedFields: string[] = [];

    for (const key in row) {
        const value = row[key];
        const fullKey = key;

        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0].featureType) {
            nestedFields.push(fullKey);
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value[0], fullKey));
        } else if (typeof value === "object" && value !== null) {
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value, fullKey));
        }
    }

    return nestedFields;
};

const Facility = ({ fields }:FacilityProps) => {
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
        layerManager,
    } = useLayerStore();

    const nestedArrayFieldsMap: Record<string, string[]> = {};
    const [expandedParents, setExpandedParents] = useState<{ [key: string]: boolean }>({});

    const toggleExpand = (parentKey: string) => {
        setExpandedParents((prev) => ({
            ...prev,
            [parentKey]: !prev[parentKey],
        }));
    };

    const defaultSelected = fields.find(field => field.basic)?.key || null;

    fields.forEach((field) => {
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
            const children = nestedArrayFieldsMap[defaultSelected] || [];
            children.forEach(child => {
                addActiveLayerName(`${defaultSelected}.${child}`);
            });
        }
    }, [defaultSelected]);

    const isParentChecked = (key: string) => {
        const children = nestedArrayFieldsMap[key] || [];
        if (children.length === 0) return activeLayerName?.includes(key);
        // 상위는 자식이 하나라도 있으면 체크된 것으로 본다
        return children.some((child) => activeLayerName?.includes(`${key}.${child}`));
    };

    const isChildChecked = (parentKey: string, childKey: string) => {
        return activeLayerName?.includes(`${parentKey}.${childKey}`);
    };

    const toggleParent = (parentKey: string, checked: boolean) => {
        const children = nestedArrayFieldsMap[parentKey] || [];
        if (checked) {
            addActiveLayerName(parentKey);
            children.forEach((child) => {
                addActiveLayerName(`${parentKey}.${child}`)
                layerManager?.toggleByFeatureType('facility', parentKey, child, checked);
            });
        } else {
            removeActiveLayerName(parentKey);
            children.forEach((child) => {
                removeActiveLayerName(`${parentKey}.${child}`)
                layerManager?.toggleByFeatureType('facility', parentKey, child, checked);
            });
        }
    };

    const toggleChild = (parentKey: string, childKey: string, checked: boolean) => {
        const fullKey = `${parentKey}.${childKey}`;

        if (checked) {
            // child 활성화
            addActiveLayerName(fullKey);
            // parent도 강제로 활성화
            if (!activeLayerName?.includes(parentKey)) {
                addActiveLayerName(parentKey);
            }
            // layer도 토글
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, true);
        } else {
            // child 비활성화
            removeActiveLayerName(fullKey);
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, false);

            // 하위 중 하나라도 켜져 있으면 parent 유지
            const children = nestedArrayFieldsMap[parentKey] || [];
            const anyChecked = children.some(child =>
                activeLayerName?.includes(`${parentKey}.${child}`)
            );

            if (!anyChecked) {
                removeActiveLayerName(parentKey);
            }
        }
    };


    return (
        <div>
            {fields.map((field) => {
                const parentKey = field.key;
                const nestedFields = nestedArrayFieldsMap[parentKey] || [];
                const isExpanded = expandedParents[parentKey] ?? false; // 기본은 펼침 상태

                return (
                    <div key={parentKey}>
                        <div style={{ display: 'flex' }}>
                            {nestedFields.length > 0 && (
                                <span onClick={() => {
                                    if (nestedFields.length) toggleExpand(parentKey);
                                }}>{isExpanded ? '▼' : '▶'}</span> // 접힘/펼침 표시
                            )}
                            <label
                                style={{
                                    color: 'white',
                                    fontWeight: 'bold',
                                    cursor: nestedFields.length ? 'pointer' : 'default',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5em',
                                }}
                            >
                                {field.label}
                                <input
                                    type="checkbox"
                                    checked={isParentChecked(parentKey)}
                                    onChange={(e) => toggleParent(parentKey, e.target.checked)}
                                    onClick={(e) => e.stopPropagation()} // 체크박스 클릭 시 펼침 방지
                                />

                            </label>
                        </div>


                        {isExpanded && nestedFields.map((childKey) => (
                            <label key={`${parentKey}.${childKey}`} style={{ marginLeft: '1em', color: 'lightgray' }}>
                                <input
                                    type="checkbox"
                                    checked={isChildChecked(parentKey, childKey)}
                                    onChange={(e) => toggleChild(parentKey, childKey, e.target.checked)}
                                />
                                {childKey}
                            </label>
                        ))}
                    </div>
                );
            })}
        </div>
    );
};


export default Facility;
