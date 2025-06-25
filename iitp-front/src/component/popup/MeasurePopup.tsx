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

            <div className="measure-popup">

                <div className="tabs">
                    <button className={`${selectedTool === "distance" ? "active" : "inactive"}`}
                            onClick={() => handleToggle('distance')}>거리측정</button>
                </div>
                <div className="tabs">
                    <button
                        className={`${selectedTool === "area" ? "active" : "inactive"}`}
                        onClick={() => handleToggle('area')}
                    >
                        면적측정
                    </button>
                </div>
            </div>
        </>
    );
};

export default MeasurePopup;
