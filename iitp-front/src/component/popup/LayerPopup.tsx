import React, { useState } from 'react';

interface LayerPopupProps {
    isOpen: boolean;
}

const LayerPopup: React.FC<LayerPopupProps> = ({ isOpen }) => {
    if (!isOpen) return null;

    const [activeTab, setActiveTab] = useState(0); // 기본적으로 첫 번째 탭 활성화

    // 각 탭을 클릭할 때 활성화하는 함수
    const handleTabClick = (index: number) => {
        setActiveTab(index);
    };

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
                <h3>레이어 관리</h3>

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
                        주제도
                    </button>
                    <button
                        className={`tab ${activeTab === 2 ? 'active' : ''}`}
                        onClick={() => handleTabClick(2)}
                    >
                        시설물
                    </button>
                </div>

                {activeTab === 0 && (
                    <div>
                        <label>
                            <input type="radio" name="wmtsLayer" value="vworldBase" />
                            브이월드 일반
                        </label>
                        <label>
                            <input type="radio" name="wmtsLayer" value="vworldSatellite" />
                            브이월드 위성
                        </label>
                        <label>
                            <input type="radio" name="wmtsLayer" value="vworldHybrid" />
                            브이월드 하이브리드
                        </label>
                    </div>
                )}

                {activeTab === 1 && (
                    <div>
                        <label>
                            <input type="radio" name="themeLayer" value="themeLayer1" />
                            주제도 1
                        </label>
                        <label>
                            <input type="radio" name="themeLayer" value="themeLayer2" />
                            주제도 2
                        </label>
                        <label>
                            <input type="radio" name="themeLayer" value="themeLayer3" />
                            주제도 3
                        </label>
                    </div>
                )}

                {activeTab === 2 && (
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
