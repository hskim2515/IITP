import React, { useEffect, useState } from 'react';
import {useMapStore} from "@stores/useMapStore";

const BaseMapPopup = () => {
    const BaseMapOptions = [
        { value: 'osm', label: 'OSM 지도' },
        { value: 'base', label: 'VWorld 일반지도' },
        { value: 'satellite', label: 'VWorld 위성지도' },
        { value: 'hybrid', label: 'VWorld Hybrid지도' },
        { value: 'midnight', label: 'VWorld 야간지도' },
    ];

    const currentBaseMap = useMapStore((state) => state.currentBaseMap);
    const setCurrentBaseMap = useMapStore((state) => state.setCurrentBaseMap);

    const [selectedLayer, setSelectedLayer] = useState<string | null>(currentBaseMap);


    const handleLayerChange = (e) => {
        const layerType = e.target.value;
        setSelectedLayer(layerType);
        setCurrentBaseMap(layerType);
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
