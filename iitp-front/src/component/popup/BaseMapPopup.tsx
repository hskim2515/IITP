import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import {useMapStore} from "@stores/useMapStore";
import {createCesiumLayer, removeAllCesiumLayers} from "../../hooks/basemap/useBaseMap";

const BaseMapPopup = () => {
    const BaseMapOptions = [
        { value: 'osm', label: 'OSM 지도' },
        { value: 'base', label: 'VWorld 일반지도' },
        { value: 'satellite', label: 'VWorld 위성지도' },
        { value: 'hybrid', label: 'VWorld Hybrid지도' }
    ];
    /* ol */
    const currentBaseMap = useMapStore((state) => state.currentBaseMap);
    const setCurrentBaseMap = useMapStore((state) => state.setCurrentBaseMap);
    /* cesium */
    const viewer = useCesiumStore((state) => state.viewer);
    const [selectedLayer, setSelectedLayer] = useState<string | null>(currentBaseMap);

    const updateOlLayer = (layerType:string) => {
        setCurrentBaseMap(layerType);
    };

    const updateCesiumLayer = (layerType:string) => {
        if (!viewer) return;

        const imageryLayerCollection = viewer.imageryLayers;
        removeAllCesiumLayers(viewer);

        if (layerType === 'hybrid') {
            imageryLayerCollection.addImageryProvider(createCesiumLayer('satellite'));
            imageryLayerCollection.addImageryProvider(createCesiumLayer('hybrid'));

        } else {
            imageryLayerCollection.addImageryProvider(createCesiumLayer(layerType));
        }
    };

    const handleLayerChange = (e) => {
        const layerType = e.target.value;
        setSelectedLayer(layerType);
        updateOlLayer(layerType);
        updateCesiumLayer(layerType);
    };

    useEffect(() => {
        if (currentBaseMap) {
            setSelectedLayer(currentBaseMap);
        }
    }, [currentBaseMap]);

    return (
        <>
            <div>
                {BaseMapOptions.map(({value, label}) => (
                    <label key={value}>
                        <input
                            type="radio"
                            value={value}
                            checked={selectedLayer === value}
                            onChange={handleLayerChange}
                        />
                        {label}
                    </label>
                ))}
            </div>
        </>
    );
};

export default BaseMapPopup;
