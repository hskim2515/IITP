import React, { useEffect, useState } from 'react';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useCesiumStore }      from '@stores/useCesiumStore';
import { useMapStore }         from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import {useVehicleStore} from "@stores/useVehicleStore";

export interface TestSettingProps {
}

const TestSetting: React.FC<TestSettingProps> = ({ }) => {

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const setSpeedFactor = useVehicleStore((state) => state.setSpeedFactor);
    const setNumVehicle = useVehicleStore((state) => state.setNumVehicle);

    return (
        <div>
            <div style={{ padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>속도: {speedFactor.toFixed(0)}km/h</label>
                <input type="range" min="10" max="200" step="10" value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={{ padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>대수: {numVehicle}</label>
                <input type="range" min="50" max="5000" step="50" value={numVehicle} onChange={(e) => setNumVehicle(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
        </div>
    );
};

export default TestSetting;
