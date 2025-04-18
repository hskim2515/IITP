import React from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from './layerSchema';

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
                    key={field.value}
                    style={{ color: 'white', display: 'block', margin: '4px 0' }}
                >
                    <input
                        type={field.type}
                        value={field.value}
                        checked={activeLayerName.includes(field.value)}
                        onChange={e => handleToggle(field.value, e.target.checked)}
                    />
                    {field.label}
                </label>
            ))}
        </div>
    );
};

export default Facility;
