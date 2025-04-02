import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { Tile as TileLayer } from 'ol/layer';
import { XYZ } from 'ol/source';
import { useCesiumStore } from '@stores/useCesiumStore';
import * as Cesium from "cesium";
import {useMapStore} from "@stores/useMapStore";
import {createCesiumLayer, createOlLayer} from "../../hooks/basemap/useBaseMap";

const BaseMapPopup = () => {
    const BaseMapOptions = [
        { value: 'osm', label: 'OSM 지도' },
        { value: 'base', label: 'VWorld 일반지도' },
        { value: 'satellite', label: 'VWorld 위성지도' },
        { value: 'hybrid', label: 'VWorld Hybrid지도' }
    ];
    /* ol */
    const olMap = useOpenLayersStore((state) => state.map);
    const currentBaseMap = useMapStore((state) => state.currentBaseMap);
    const setCurrentBaseMap = useMapStore((state) => state.setCurrentBaseMap);
    /* cesium */
    const viewer = useCesiumStore((state) => state.viewer);
    const [selectedLayer, setSelectedLayer] = useState<string | null>(currentBaseMap);

    const updateOlLayer = (layerType) => {
        if (!olMap) return;
        olMap.getLayers().clear();
        if (layerType === 'hybrid') {
            const satelliteLayer = createOlLayer('satellite');
            const hybridLayer = createOlLayer('hybrid');
            olMap.addLayer(satelliteLayer);
            olMap.addLayer(hybridLayer);
        } else {
            const newLayer = createOlLayer(layerType);
            olMap.addLayer(newLayer);
        }
        setCurrentBaseMap(layerType);
    };

    let addedCesiumLayers: Cesium.ImageryLayer[] = [];
    const updateCesiumLayer = (layerType) => {
        if (!viewer) return;

        const imageryLayerCollection = viewer.imageryLayers;
        removeAllCustomLayers();

        if (layerType === 'hybrid') {
            const satelliteLayer = imageryLayerCollection.addImageryProvider(createCesiumLayer('satellite'));
            const hybridLayer = imageryLayerCollection.addImageryProvider(createCesiumLayer('hybrid'));

            addedCesiumLayers.push(satelliteLayer, hybridLayer);
        } else {
            const newLayer = imageryLayerCollection.addImageryProvider(createCesiumLayer(layerType));
            addedCesiumLayers.push(newLayer);
        }
    };

    const removeAllCustomLayers = () => {
        addedCesiumLayers.forEach(layer => {
            viewer.imageryLayers.remove(layer);
        });
        addedCesiumLayers = [];
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
