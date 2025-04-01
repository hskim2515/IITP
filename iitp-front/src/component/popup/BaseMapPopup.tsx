import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { Tile as TileLayer } from 'ol/layer';
import { XYZ } from 'ol/source';
import { useCesiumStore } from '@stores/useCesiumStore';
import * as Cesium from "cesium";
import {useMapStore} from "@stores/useMapStore";

const BaseMapPopup = () => {
    const BaseMapOptions = [
        { value: 'osm', label: 'OSM 지도' },
        { value: 'base', label: 'VWorld 일반지도' },
        { value: 'satellite', label: 'VWorld 위성지도' },
        { value: 'hybrid', label: 'VWorld Hybrid지도' }
    ];

    const apiKey = 'A6260B9D-ADEA-36CE-8000-4C4C57D4FCF5';

    type SourceMap = {
        [key: string]: string;
    };

    const sourceMap:SourceMap = {
        'osm' : `https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png`,
        'base': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Base/{z}/{y}/{x}.png`,
        'satellite': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`,
        'hybrid': `http://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Hybrid/{z}/{y}/{x}.png`,
    };

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

    const createOlLayer = (layerType:string) => {
        const url = sourceMap[layerType] || '';
        return new TileLayer({ visible: true, source: new XYZ({ url }),});
    };

    let addedCesiumLayers: Cesium.ImageryLayer[] = [];
    const updateCesiumLayer = (layerType:string) => {
        if (!viewer) return;

        const imageryLayerCollection = viewer.imageryLayers;

        removeAllCustomLayers();

         if (layerType === 'hybrid') {
            const satelliteProvider = new Cesium.UrlTemplateImageryProvider({ url: sourceMap['satellite']});
            const hybridProvider = new Cesium.UrlTemplateImageryProvider({ url: sourceMap['hybrid'] });

            const satelliteLayer = imageryLayerCollection.addImageryProvider(satelliteProvider);
            const hybridLayer = imageryLayerCollection.addImageryProvider(hybridProvider);

            addedCesiumLayers.push(satelliteLayer, hybridLayer);
        } else {
            const provider = new Cesium.UrlTemplateImageryProvider({ url: sourceMap[layerType] });
            const newLayer = imageryLayerCollection.addImageryProvider(provider);
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
