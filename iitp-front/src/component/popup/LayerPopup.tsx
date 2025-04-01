import React, { useState } from 'react';
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow } from "zustand/react/shallow";
import BaseMapPopup from "./BaseMapPopup";

interface LayerPopupProps {
    isOpen: boolean;
}

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    if (!isOpen) return null;

    const [activeTab, setActiveTab] = useState(0);

    const setActiveLayerName = useLayerStore(useShallow((state) => state.setActiveLayerName));
    const setActiveLayerGroupName = useLayerStore(useShallow((state) => state.setActiveLayerGroupName));

    const handleTabClick = (index: number) => {
        setActiveTab(index);
    };

    const handleLayer = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        switch (value) {
            case "heatmap":
                setActiveLayerName("heatmap");
                setActiveLayerGroupName("layer");
                break;
            case "trip":
                setActiveLayerName("trip");
                setActiveLayerGroupName("layer");
                break;
            default:
                setActiveLayerName(null);
                setActiveLayerGroupName("layer");
                break;
        }
    }

    return (
        <>
            <style>
                {`
                .layer-popup {
                    position: absolute;
                    top: 40px;
                    right: 80px;
                    width: 250px;
                    background: black; /* 배경을 검정색으로 변경 */
                    padding: 10px;
                    box-shadow: 0px 4px 6px rgba(0,0,0,0.1);
                    border-radius: 8px;
                    font-family: Arial, sans-serif;
                }

                .layer-popup h3 {
                    background: steelblue;
                    color: white;
                    padding: 8px;
                    text-align: center;
                    border-radius: 4px;
                    margin-bottom: 10px;
                }

                .layer-popup label {
                    color: white; /* 배경이 검정색일 때 글씨를 흰색으로 */
                    display: block;
                    margin-bottom: 10px;
                    font-size: 14px;
                }

                .layer-popup .tabs {
                    display: flex;
                    justify-content: space-between;
                    border-bottom: 2px solid #444;
                    margin-bottom: 10px;
                }

                .layer-popup .tab {
                    cursor: pointer;
                    padding: 8px;
                    font-size: 14px;
                    color: white;
                    background-color: transparent;
                    border: none;
                    outline: none;
                    flex: 1;
                    text-align: center;
                }

                .layer-popup .tab.active {
                    border-bottom: 2px solid steelblue;
                }

                .layer-popup input[type="radio"] {
                    margin-right: 10px;
                    accent-color: steelblue;
                    transition: transform 0.2s ease, border-color 0.2s ease;
                }

                /* 선택되지 않은 라디오버튼은 연한 색상 */
                .layer-popup input[type="radio"]:not(:checked) {
                    background-color: #e0e0e0; /* 연한 회색 배경 */
                    border: 2px solid #cccccc; /* 연한 회색 테두리 */
                }

                /* 선택된 라디오버튼은 파란색으로 강조 */
                .layer-popup input[type="radio"]:checked {
                    background-color: steelblue;
                    border-color: steelblue;
                    transform: scale(1.1);
                }

                /* 포커스 스타일 */
                .layer-popup input[type="radio"]:focus {
                    outline: none;
                    box-shadow: 0px 0px 5px rgba(0, 0, 255, 0.5);
                }
                `}
            </style>

            <div className="layer-popup">
                {/*<h3>레이어 관리</h3>*/}

                <div className="tabs">
                    <button
                        className={`tab ${activeTab === 0 ? 'active' : ''}`}
                        onClick={() => handleTabClick(0)}
                    >
                        배경지도
                    </button>
                    <button
                        className={`tab ${activeTab === 1 ? 'active' : ''}`}
                        onClick={() => handleTabClick(1)}
                    >
                        레이어
                    </button>
                    <button
                        className={`tab ${activeTab === 2 ? 'active' : ''}`}
                        onClick={() => handleTabClick(2)}
                    >
                        시설물
                    </button>
                </div>

                {activeTab === 0 && (
                    <BaseMapPopup/>
                )}

                {activeTab === 1 && (
                    <div>
                        <label>
                            <input type="radio" name="layer" value="" onChange={ handleLayer }/>
                            선택안함
                        </label>
                        <label>
                            <input type="radio" name="layer" value="heatmap" onChange={ handleLayer }/>
                            히트맵 레이어
                        </label>
                        <label>
                            <input type="radio" name="layer" value="trip" onChange={ handleLayer }/>
                            트립 레이어
                        </label>
                    </div>
                ) }

                { activeTab === 2 && (
                    <div>
                        <label>
                            <input type="radio" name="facilityLayer" value="facility1" />
                            시설물 1
                        </label>
                        <label>
                            <input type="radio" name="facilityLayer" value="facility2" />
                            시설물 2
                        </label>
                        <label>
                            <input type="radio" name="facilityLayer" value="facility3" />
                            시설물 3
                        </label>
                    </div>
                )}
            </div>
        </>
    );
};

export default LayerPopup;
