import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore }      from '@stores/useCesiumStore';
import { useMapStore }         from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";

export interface BaseMapProps {
    fields: LayerField[];
}

const BaseMap: React.FC<BaseMapProps> = ({ fields }) => {
    const olMap = useOpenLayersStore.state.map();
    const viewer = useCesiumStore.state.viewer();
    const currentBaseMap = useMapStore.state.currentBaseMap();
    const setCurrentBaseMap = useMapStore.actions.setCurrentBaseMap();

    const layerManager = useLayerStore.state.layerManager()

    const defaultSelected = fields.find(field => field.basic)?.key || null;
    const [selected, setSelected] = useState<string | null>(currentBaseMap);


    useEffect(() => {
        if(!layerManager) return;
    }, [layerManager]);

    useEffect(() => {
        if (defaultSelected) {
            setCurrentBaseMap(defaultSelected);
        }
    }, [defaultSelected, setCurrentBaseMap]);

    useEffect(() => {
        if (currentBaseMap) setSelected(currentBaseMap);
    }, [currentBaseMap]);

    useEffect(() => {
        console.log("fields:::", fields)
    }, [fields]);

    const handleSelect = (value: string) => {
        const layerName = value
        if(viewer && layerManager) {
            layerManager.showLayer("baseMap",layerName) // base, osm, hybrid
        }

        setCurrentBaseMap(value);
        setSelected(value);
    };

    return (
        <div>
            {fields.map(field => (
                <label key={field.key} style={{ color: 'white', display: 'block', margin: '4px 0' }}>
                    <input
                        type={field.formType}
                        name="baseMap"
                        value={field.key}
                        checked={selected === field.key}
                        onChange={() => handleSelect(field.key)}
                    />
                    {field.label}
                </label>
            ))}
        </div>
    );
};

export default BaseMap;
