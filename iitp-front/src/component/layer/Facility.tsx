import React, {useEffect} from 'react';
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

    const defaultSelected = fields.find(field => field.basic)?.key || null;

    useEffect(() => {
        if (defaultSelected) {
            addActiveLayerName(defaultSelected);
        }
    }, [defaultSelected, addActiveLayerName]);

    const handleToggle = (value: string, checked: boolean) => {
        checked ? addActiveLayerName(value) : removeActiveLayerName(value);
    };


    return (
        <div>
            {fields.map(field => (
                <label
                    key={field.key}
                    style={{ color: 'white', display: 'block', margin: '4px 0' }}
                >
                    <input
                        type={field.formType}
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
