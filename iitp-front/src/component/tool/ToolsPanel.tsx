import React, {useState} from 'react';
import { useToolStore } from '@stores/useToolStore';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRuler, faLayerGroup, faCog } from '@fortawesome/free-solid-svg-icons';
import LayerPopup from "../popup/LayerPopup";
import MeasurePopup from "../popup/MeasurePopup";
import SettingPopup from "../popup/SettingPopup";

const ToolsPanel = () => {
    const { showTools } = useToolStore();

    const [activePopup, setActivePopup] = useState<number | null>(null);

    const togglePopup = (index: number) => {
        setActivePopup(activePopup === index ? null : index);
    };

    return (
        <div
            style={{
                position: 'fixed',
                right: '0px',
                top: '100px',
                borderRadius: '8px',
                padding: '15px',
                zIndex: 999,
                transform: showTools ? 'translateY(0)' : 'translateY(0)', // Slide in/out
                opacity: showTools ? 1 : 0, // Fade in/out
                transition: 'transform 0.3s ease, opacity 0.3s ease', // Smooth slide and fade animation
            }}
        >
            {/* 레이어 */}
            <button
                style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '20px',
                    display: 'flex',
                    alignItems: 'center'
                }}
                onClick={() => togglePopup(0)}
            >
                <FontAwesomeIcon icon={faLayerGroup} />
            </button>
            <button
                style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '20px',
                    display: 'flex',
                    alignItems: 'center',
                }}
                onClick={() => togglePopup(1)}
            >
                <FontAwesomeIcon icon={faRuler} />
            </button>
            <button
                style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '20px',
                    display: 'flex',
                    alignItems: 'center',
                }}
                onClick={() => togglePopup(2)}
            >
                <FontAwesomeIcon icon={faCog} />
            </button>
            {activePopup === 0 && <LayerPopup isOpen={true} />}
            {activePopup === 1 && <MeasurePopup isOpen={true} />}
            {activePopup === 2 && <SettingPopup isOpen={true} />}
        </div>
    );
};

export default ToolsPanel;
