import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore }      from '@stores/useCesiumStore';
import { useMapStore }         from '@stores/useMapStore';
import {
    createCesiumLayer,
    removeAllCesiumLayers
} from '../../hooks/basemap/useBaseMap';
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

    const olLayerManager = useLayerStore.state.olLayerManager()
    const cesiumPrimitiveLayerManager = useLayerStore.state.cesiumPrimitiveLayerManager()

    const [selected, setSelected] = useState<string | null>(currentBaseMap);

    useEffect(() => {
        if(!olLayerManager) return;
    }, [olLayerManager]);

    useEffect(() => {
        if (currentBaseMap) setSelected(currentBaseMap);
    }, [currentBaseMap]);

    const handleSelect = (value: string) => {
        const layerName = value
        if(olMap && olLayerManager) {
            olLayerManager.showBaseLayer("baseMap",layerName) // base, osm, hybrid
            cesiumPrimitiveLayerManager?.show("baseMap",layerName)
        }

        // Cesium 레이어 갱신
        if (viewer) {
            const layers = viewer.imageryLayers;
            removeAllCesiumLayers(viewer);
            const field = fields.find(field => field.key === value)!;
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
                <label key={field.key} style={{ color: 'white', display: 'block', margin: '4px 0' }}>
                    <input
                        type={field.type}
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
