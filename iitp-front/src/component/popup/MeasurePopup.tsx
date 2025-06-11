import React, {useState} from "react";
import { useCesiumMeasure } from "@hooks/sync/measure/useCesiumMeasure";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {useOlMeasure} from "@hooks/sync/measure/useOlMeasure";

interface MeasurePopupProps {
    isOpen: boolean;
}

const MeasurePopup: React.FC<MeasurePopupProps> = ({ isOpen }) => {
    const [selectedTool, setSelectedTool] = useState<string | null>(null);
    const cesiumViewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map);

    useCesiumMeasure(selectedTool,cesiumViewer);
    useOlMeasure(selectedTool, olMap);

    const handleToggle = (tool: string) => {
        setSelectedTool(selectedTool === tool ? null : tool);
    };

    if (!isOpen) return null;

    return (
        <>
            <style>
                {`
                    .measure-popup {
                        position: absolute;
                        top: 40px;
                        right: 80px;
                        width: 200px;
                        background: black;
                        padding: 10px;
                        box-shadow: 0px 4px 6px rgba(0,0,0,0.1);
                        border-radius: 8px;
                        font-family: Arial, sans-serif;
                    }

                    .measure-popup h3 {
                        background: steelblue;
                        color: white;
                        padding: 8px;
                        text-align: center;
                        border-radius: 4px;
                        margin-bottom: 10px;
                    }

                    .measure-popup label {
                        color: white;
                        display: block;
                        margin-bottom: 10px;
                        font-size: 14px;
                        cursor: pointer;
                        padding: 8px;
                        border-radius: 4px;
                        transition: all 0.3s ease;
                    }

                    .measure-popup label:hover {
                        background: #444;
                    }

                    .measure-popup .active {
                        border: 2px solid steelblue;
                        background: #333;
                    }

                    .measure-popup .inactive {
                        border: 2px solid #555;
                    }
                `}
            </style>
            <div className="measure-popup">
                <h3>측정도구</h3>
                <div>
                    <label
                        className={`${selectedTool === "distance" ? "active" : "inactive"}`}
                        onClick={() => handleToggle('distance')}
                    >
                        거리측정
                    </label>
                </div>
                <div>
                    <label
                        className={`${selectedTool === "area" ? "active" : "inactive"}`}
                        onClick={() => handleToggle('area')}
                    >
                        면적측정
                    </label>
                </div>
            </div>
        </>
    );
};

export default MeasurePopup;
