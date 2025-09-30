import React, { useEffect } from 'react';
import { BaseMapType, useMapStore } from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import styles from "@css/BaseMap.module.css"

export interface Props {
    fields: LayerField[];
}

const BaseMap = ({fields}: Props) => {

    const currentBaseMap = useMapStore.state.currentBaseMap();
    const setCurrentBaseMap = useMapStore.actions.setCurrentBaseMap();

    const layerManager = useLayerStore.state.layerManager()

    useEffect(() => {
        if (currentBaseMap) return;
        const initialBaseMap = fields.find(field => field.basic)?.key || undefined;
        if (initialBaseMap) setCurrentBaseMap(initialBaseMap);
    }, [setCurrentBaseMap]);

    const handleSelect = (layerName: BaseMapType) => {
        if (layerManager && layerName) {
            layerManager.showLayer("baseMap", layerName)
        }

        setCurrentBaseMap(layerName);
    };

    return (
        <div>
            {fields.map(field => {
                    const value = field.key;
                    return (
                        <label key={field.key} className={styles['item']}>
                            <input
                                type={field.formType}
                                name="baseMap"
                                value={value}
                                checked={currentBaseMap === value}
                                onChange={() => handleSelect(value)}
                            />
                            {field.label}
                        </label>
                    )
                }
            )}
        </div>
    );
};

export default BaseMap;
