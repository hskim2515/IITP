import React, { useState } from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { faCog } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import LayerSettingPopup from "../popup/LayerSettingPopup";
import {LayerField} from "@stores/useLayerSchemaStore";

export interface AnalysisProps {
    fields: LayerField[];
}

const Analysis: React.FC<AnalysisProps> = ({ fields }) => {
    const [selectedLayerType, setSelectedLayerType] = useState(null); // <-- 추가
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
    } = useLayerStore();

    const handleSettingClick = (type) => {
        setSelectedLayerType(type);
    };

    const handleToggle = (value: string, checked: boolean) => {
        checked ? addActiveLayerName(value) : removeActiveLayerName(value);
    };

    console.log(fields)

    return (
        <div>
            <LayerSettingPopup layerType={selectedLayerType}></LayerSettingPopup>
            {fields.map(field => (
                <label key={ field.key } style={ { color: 'white', display: 'block', margin: '4px 0' } }>
                    <input
                        type={ field.type }
                        value={ field.key }
                        checked={ activeLayerName.includes(field.key) }
                        onChange={ e => handleToggle(field.key, e.target.checked) }
                    />
                    { field.label }
                    <button
                        onClick={ () => handleSettingClick(field.key) }
                        style={ {
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            alignItems: "center",
                            paddingLeft: "10px"
                        } }
                        title="설정"
                    >
                        <FontAwesomeIcon icon={ faCog } size="lg"/>
                    </button>
                </label>
            )) }
        </div>
    );
};

export default Analysis;
