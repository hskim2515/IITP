import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore }      from '@stores/useCesiumStore';
import { useMapStore }         from '@stores/useMapStore';
import {
    createCesiumLayer,
    createOlLayer,
    removeAllCesiumLayers
} from '../../hooks/basemap/useBaseMap';
import { LayerField } from './layerSchema';

export interface BaseMapProps {
    fields: LayerField[];
}

const BaseMap: React.FC<BaseMapProps> = ({ fields }) => {
    const olMap  = useOpenLayersStore(state => state.map);
    const viewer = useCesiumStore(state => state.viewer);
    const currentBaseMap = useMapStore(state => state.currentBaseMap);
    const setCurrentBaseMap = useMapStore(state => state.setCurrentBaseMap);

    const [selected, setSelected] = useState<string | null>(currentBaseMap);

    useEffect(() => {
        if (currentBaseMap) setSelected(currentBaseMap);
    }, [currentBaseMap]);

    const handleSelect = (value: string) => {
        // OpenLayers 레이어 갱신
        if (olMap) {
            olMap.getLayers().clear();
            const field = fields.find(field => field.value === value)!;
            const providers = (field as any).providers as string[]|undefined;
            (providers || [value]).forEach(provider => {
                const layers = createOlLayer(provider);
                ([] as any[]).concat(layers).forEach(layer => olMap.addLayer(layer));
            });
        }

        // Cesium 레이어 갱신
        if (viewer) {
            const layers = viewer.imageryLayers;
            removeAllCesiumLayers(viewer);
            const field = fields.find(field => field.value === value)!;
            const providers = (field as any).providers as string[]|undefined;
            (providers || [value]).forEach(provider => {
                const provs = createCesiumLayer(provider);
                ;([] as any[]).concat(provs).forEach(pr => layers.addImageryProvider(pr));
            });
        }

        setCurrentBaseMap(value);
        setSelected(value);
    };

    return (
        <div>
            {fields.map(field => (
                <label key={field.value} style={{ color: 'white', display: 'block', margin: '4px 0' }}>
                    <input
                        type={field.type}
                        name="baseMap"
                        value={field.value}
                        checked={selected === field.value}
                        onChange={() => handleSelect(field.value)}
                    />
                    {field.label}
                </label>
            ))}
        </div>
    );
};

export default BaseMap;
