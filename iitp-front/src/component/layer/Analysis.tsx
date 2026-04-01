import React, { useEffect, useState } from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { faCog } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import LayerSettingPopup from "../popup/LayerSettingPopup";
import { LayerField } from "@stores/useLayerSchemaStore";
import styles from "@css/ToolsPanel.module.css"

export interface Props {
    fields: LayerField[];
}

const Analysis = ({fields}: Props) => {
    const [selectedLayerType, setSelectedLayerType] = useState<string | undefined>(undefined);
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
        layerManager,
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
        if (checked) {
            addActiveLayerName(value);
            layerManager?.showLayer("analyze", value);
        } else {
            removeActiveLayerName(value);
            layerManager?.hideLayer("analyze", value);
        }
    };

    return (
        <div>
            {activeLayerName && fields.map(field => (
                <label key={field.key} className={styles.layerItem}>
                    <input
                        type={field.formType}
                        value={field.key}
                        checked={activeLayerName.includes(field.key)}
                        onChange={e => handleToggle(field.key, e.target.checked)}
                    />
                    {field.label}
                    <button
                        onClick={() => handleSettingClick(field.key)}
                        className={styles.layerItemSettingBtn}
                        title="설정"
                    >
                        <FontAwesomeIcon icon={faCog} size="sm"/>
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
