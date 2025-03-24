import React from 'react';

interface MeasurePopupProps {
    isOpen: boolean;
}

const MeasurePopup: React.FC<MeasurePopupProps> = ({ isOpen }) => {
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
                    background: black; /* 배경을 검정색으로 설정 */
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
                    color: white; /* 글씨를 흰색으로 변경 */
                    display: block;
                    margin-bottom: 10px;
                    font-size: 14px;
                }

                .measure-popup input[type="radio"] {
                    margin-right: 10px;
                    accent-color: steelblue;
                    transition: transform 0.2s ease, border-color 0.2s ease;
                }

                /* 선택되지 않은 라디오버튼은 연한 색상 */
                .measure-popup input[type="radio"]:not(:checked) {
                    background-color: #e0e0e0; /* 연한 회색 배경 */
                    border: 2px solid #cccccc; /* 연한 회색 테두리 */
                }

                /* 선택된 라디오버튼은 파란색으로 강조 */
                .measure-popup input[type="radio"]:checked {
                    background-color: steelblue;
                    border-color: steelblue;
                    transform: scale(1.1);
                }

                /* 포커스 스타일 */
                .measure-popup input[type="radio"]:focus {
                    outline: none;
                    box-shadow: 0px 0px 5px rgba(0, 0, 255, 0.5);
                }
                `}
            </style>

            <div className="measure-popup">
                <h3>측정도구</h3>
                <div>
                    <label>
                        <input type="radio" name="measureTool" value="distance" />
                        거리측정
                    </label>
                </div>
                <div>
                    <label>
                        <input type="radio" name="measureTool" value="area" />
                        면적측정
                    </label>
                </div>
            </div>
        </>
    );
};

export default MeasurePopup;
