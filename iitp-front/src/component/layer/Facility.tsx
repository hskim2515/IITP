import React from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import {LayerField} from "@stores/useLayerSchemaStore";

export interface FacilityProps {
    fields: LayerField[];
}

const Facility: React.FC<FacilityProps> = ({ fields }) => {
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
    } = useLayerStore();

    const handleToggle = (value: string, checked: boolean) => {

        if (checked) {
            addActiveLayerName(value);
        } else {
            removeActiveLayerName(value);
        }
    };

    return (
        <div>
            {fields.map(field => (
                <label
                    key={field.key}
                    style={{ color: 'white', display: 'block', margin: '4px 0' }}
                >
                    <input
                        type={field.type}
                        value={field.key}
                        checked={activeLayerName.includes(field.key)}
                        onChange={e => handleToggle(field.key, e.target.checked)}
                    />
                    {field.label}
                </label>
            ))}
        </div>
    );
};

export default Facility;
