import React from 'react';
import { fieldType } from './PropertyPopup';
import DynamicInput from "./DynamicInput";

interface Props {
    menuCode: string;
    inputFields: fieldType[];
    formData: string[];
    handleSimpleChange: (idx: number, value: string | File | null) => void;
    handleSubmitSimple: (e: React.FormEvent) => void;
    isReadOnly: boolean;
    mode: 'create' | 'edit' | 'view';
    onClose: () => void;
    onEditMode: (mode:string, targetId:number) => void;
    targetId: number;
}

const getTitleByMode = (mode: string) => {
    switch (mode) {
        case 'create': return '새 데이터 추가';
        case 'edit': return '데이터 편집';
        case 'view': return '상세 데이터 조회';
        default: return '';
    }
};

const renderActionButton = (mode: string, targetId: number, onEditMode: (mode: string, targetId: number) => void) => {
    switch (mode) {
        case 'create':
            return <button type="submit" className="submit-btn">등록</button>;
        case 'edit':
            return <button type="submit" className="submit-btn">저장</button>;
        case 'view':
            return <button type="button" className="submit-btn"  onClick={(e) => {e.preventDefault(); e.stopPropagation();onEditMode('edit', targetId);}}>편집</button>;
        default:
            return null;
    }
};

export const SimpleForm = ({
                               menuCode, inputFields, formData, handleSimpleChange, handleSubmitSimple, isReadOnly, mode, onClose, onEditMode, targetId
                           }: Props) => (
    <div className="popup-overlay">
        <div className="popup-container" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
                <span>{getTitleByMode(mode)}</span>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>
            <div className="popup-body">
                <form onSubmit={handleSubmitSimple}>
                    {inputFields.map(({name, label, type}, idx) => (
                        <div key={name} className="form-field">
                            <label>{label}</label>
                            <DynamicInput
                                menuCode={menuCode}
                                type={type}
                                value={formData[idx] ?? ''}
                                onChange={(val) => handleSimpleChange(idx, val)}
                                readOnly={isReadOnly}
                            />
                        </div>
                    ))}
                    {renderActionButton(mode, targetId, onEditMode)}
                </form>
            </div>
        </div>
    </div>
);
