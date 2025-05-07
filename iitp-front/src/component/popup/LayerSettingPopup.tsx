import React, { useState } from 'react';

interface LayerSettingPopupProps {
    layerType: string;
}

import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import ColorBar from "../util/ColorBar";

const LayerSettingPopup: React.FC<LayerSettingPopupProps> = ({ layerType }) => {

    const {
        colors,
        exaggeration,
        setColors,
        setExaggeration
    } = useHeatmapSettingStore();

    const [tempExaggeration, setTempExaggeration] = useState(exaggeration);

    if (!layerType) return null;

    const handleExaggerationChange = (value: number) => {
        setTempExaggeration(value);
    };

    const handleExaggerationCommit = () => {
        setExaggeration(tempExaggeration);
    };

    const colorMaps = {
        'default' : ["#0000FF", "#00FF00", "#FFFF00", "#FF0000"],
        'viridis' : ["#440154", "#3B528B", "#21908C", "#5DC863"],
        'inferno' : ["#000004", "#420A68", "#932667", "#FDE725"],
        'hot' : ["#000000", "#FF0000", "#FFFF00", "#FFFFFF"],
        'autumn' : ["#FF0000", "#FF8000", "#FFFF00", "#FFFFFF"],
        'coolToWarm' : ["#3B4CC0", "#6699FF", "#FFCC33", "#B40426"],
        'rainbow' : ["#9400D3", "#0000FF", "#00FF00", "#FFFF00"],
        'grayscale' : ["#000000", "#555555", "#AAAAAA", "#FFFFFF"],

    }

    return (
        <>
            <style>
                {`
                .layer-setting-popup {
                    position : absolute;
                    top: 130px;
                    right: 0px;
                    background: linear-gradient(45deg, black, transparent);
                    padding: 10px;
                    box-shadow: 0px 4px 6px rgba(0,0,0,0.1);
                    border-radius: 8px;
                    font-family: Arial, sans-serif;
                    width: 250px;
                }

                .layer-setting-popup h3 {
                    background: steelblue;
                    color: white;
                    padding: 8px;
                    text-align: center;
                    border-radius: 4px;
                    margin-bottom: 10px;
                }

                .layer-setting-popup label {
                    color: white; /* 배경이 검정색일 때 글씨를 흰색으로 */
                    display: block;
                    margin-bottom: 10px;
                    font-size: 14px;
                }
                `}
            </style>

            <div className="layer-setting-popup">

                {layerType === 'heatmap' && (
                    <div>
                        <label>
                            Color
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>

                            {Object.entries(colorMaps).map(([name, colors]) => (
                                <div key={name}  onClick={() => setColors(colors)} style={{ width: "25px"}}>
                                    <ColorBar colormap={colors} />
                                </div>

                            ))}
                            {/*<input*/}
                            {/*    type="color"*/}
                            {/*    value={minColor}*/}
                            {/*    onChange={(e) => setMinColor(e.target.value)}*/}
                            {/*    title="Min Color"*/}
                            {/*/>*/}
                            {/*<span>→</span>*/}
                            {/*<input*/}
                            {/*    type="color"*/}
                            {/*    value={maxColor}*/}
                            {/*    onChange={(e) => setMaxColor(e.target.value)}*/}
                            {/*    title="Max Color"*/}
                            {/*/>*/}
                        </div>
                        <br/>
                        <label>
                            Exaggeration
                        </label>
                        <input
                            type="range"
                            min={0.1}
                            max={2}
                            step={0.1}
                            value={tempExaggeration}
                            onChange={(e) => handleExaggerationChange(parseFloat(e.target.value))}
                            onMouseUp={handleExaggerationCommit}
                            onTouchEnd={handleExaggerationCommit}
                        />
                        <span style={{ marginLeft: '10px' }}>{tempExaggeration.toFixed(1)}</span>

                    </div>
                ) }

                { layerType === 'trip' && (
                    <div>
                        {/*<label>*/}
                        {/*    <input type="radio" name="facilityLayer" value="facility1" />*/}
                        {/*    시설물 1*/}
                        {/*</label>*/}
                        {/*<label>*/}
                        {/*    <input type="radio" name="facilityLayer" value="facility2" />*/}
                        {/*    시설물 2*/}
                        {/*</label>*/}
                        {/*<label>*/}
                        {/*    <input type="radio" name="facilityLayer" value="facility3" />*/}
                        {/*    시설물 3*/}
                        {/*</label>*/}
                    </div>
                )}
            </div>
        </>
    );
};

export default LayerSettingPopup;
