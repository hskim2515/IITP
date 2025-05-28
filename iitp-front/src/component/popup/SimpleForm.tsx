import React from 'react';
import DynamicInput from "./DynamicInput";
import {PropertyFormSchemaProps} from "../form/propertyFormSchema";
import {MenuTree} from "@stores/useMenuStore";

interface Props {
    activePopupMenu:MenuTree;
    config: PropertyFormSchemaProps;
    formData: string[];
    handleSimpleChange: (idx: number, value: string | File | null) => void;
    handleSubmitSimple: (e: React.FormEvent) => void;
    isReadOnly: boolean;
    mode: 'create' | 'edit' | 'view';
    onClose: () => void;
    onEditMode: (mode:string, targetId:number) => void;
    targetId: number;
}

const getTitleByMode = (mode: string) => ({
    create: '새 데이터 추가',
    edit: '데이터 편집',
    view: '상세 데이터 조회'
}[mode] ?? '');

const renderActionButton = (
    mode: string,
    targetId: number,
    onEditMode: (mode: string, targetId: number) => void
) => {
    if (mode === 'view') {
        return (
            <button type="button" className="submit-btn" onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEditMode('edit', targetId);
            }}>편집</button>
        );
    }
    return (
        <button type="submit" className="submit-btn">
            {mode === 'edit' ? '저장' : '등록'}
        </button>
    );
};

export const SimpleForm = ({
                               activePopupMenu, config, formData, handleSimpleChange, handleSubmitSimple, isReadOnly, mode, onClose, onEditMode, targetId
                           }: Props) => (
    <div className="popup-overlay">
        <div className="popup-container" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
                <span>{getTitleByMode(mode)}</span>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>
            <div className="popup-body">
                <form onSubmit={handleSubmitSimple}>
                    {config.inputFields.map(({name, label, type}, idx) => (
                        <div key={name} className="form-field">
                            <label>{label}</label>
                            <DynamicInput
                                activePopupMenu={activePopupMenu}
                                propsOptions={config.fields[idx].options}
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
