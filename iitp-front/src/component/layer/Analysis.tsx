import React, { useEffect, useState } from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { faCog } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import LayerSettingPopup from "../popup/LayerSettingPopup";
import { LayerField } from "@stores/useLayerSchemaStore";
import styles from "@css/Analysis.module.css"

export interface Props {
    fields: LayerField[];
}

const Analysis = ({fields}: Props) => {
    const [selectedLayerType, setSelectedLayerType] = useState<string | undefined>(undefined);
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
    } = useLayerStore();
    const handleSettingClick = (type: string) => {
        setSelectedLayerType(type);
    };

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
            {activeLayerName && fields.map(field => (
                <label key={field.key} className={styles['field']}>
                    <input
                        type={field.formType}
                        value={field.key}
                        checked={activeLayerName.includes(field.key)}
                        onChange={e => handleToggle(field.key, e.target.checked)}
                    />
                    {field.label}
                    <button
                        onClick={() => handleSettingClick(field.key)}
                        className={styles['button-setting']}
                        title="설정"
                    >
                        <FontAwesomeIcon icon={faCog} size="lg"/>
                    </button>
                </label>
            ))}
                <div style={{position: 'relative'}}>
            <LayerSettingPopup
                layerType={selectedLayerType}
            />
                </div>
        </div>
    );
};

export default Analysis;
