import React, { useState } from "react";
import {typeOptionsMap} from "../../config/menuDrawConfig";

interface Props {
    typeKey: string;
    onConfirm: (selected: string) => void;
    onCancel: () => void;
}

const TypeSelectModal = ({ typeKey, onConfirm, onCancel }: Props) => {
    const options = typeOptionsMap[typeKey] || [];
    const [selected, setSelected] = useState(options[0] ?? "");

    return (
        <div className="modal-overlay">
            <div className="modal-container">
                <div className="modal-header">
                    <h2>타입 선택</h2>
                </div>
                <div className="modal-content">
                    <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                        {options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
                <div className="modal-actions">
                    <button onClick={() => onConfirm(selected)}>확인</button>
                    <button onClick={onCancel}>취소</button>
                </div>
            </div>
        </div>
    );
};

export default TypeSelectModal;
