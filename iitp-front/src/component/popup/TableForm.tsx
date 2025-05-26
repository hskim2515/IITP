import React from 'react';
import { fieldType } from './PropertyPopup';

interface Props {
    fields: fieldType[];
    inputFields: fieldType[];
    rowFields: fieldType[];
    metaData: Record<string, string>;
    formData: string[][];
    handleChange: (row: number, col: number, value: string) => void;
    handleChangeMeta: (key: string, value: string) => void;
    handleSubmitTable: (e: React.FormEvent) => void;
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
const getCellValue = (data: string[][], row: number, col: number): string => {
    return data[row]?.[col] ?? '';
};
const getMetaValue = (metaData: Record<string, string>, key: string): string => {
    return metaData[key] || '';
};
const renderActionButton = (mode: string, targetId: number, onEditMode: (mode: string, targetId: number) => void) => {
    switch (mode) {
        case 'create':
            return <button type="submit" className="submit-btn">등록</button>;
        case 'edit':
            return <button type="submit" className="submit-btn">저장</button>;
        case 'view':
            return <button type="button" className="submit-btn"  onClick={(e) => {e.preventDefault();e.stopPropagation();onEditMode('edit', targetId);}}>편집</button>;
        default:
            return null;
    }
};
export const TableForm = ({
                              fields, inputFields, rowFields, formData, metaData, handleChange, handleChangeMeta, handleSubmitTable, isReadOnly, mode, onClose, onEditMode, targetId
                          }: Props) =>{
    return (
        <div className="popup-overlay-input-table">
            <div className="popup-container-input-table" onClick={(e) => e.stopPropagation()}>
                <div className="popup-header">
                    <span>{getTitleByMode(mode)}</span>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="popup-body">
                    <form onSubmit={handleSubmitTable}>
                        <div className="meta-inputs">
                            {fields.map(({ name, label }, idx) => (
                                <label key={idx}>
                                    {label}:
                                    <input
                                        type="text"
                                        value={getMetaValue(metaData, name)}
                                        onChange={(e) => {handleChangeMeta(name, e.target.value)}}
                                        readOnly={isReadOnly}
                                    />
                                </label>
                            ))}
                        </div>
                        <table className="input-table">
                            <thead>
                            <tr>
                                <th></th>
                                {inputFields.map(({label}, colIdx) => (
                                    <th key={colIdx}>{label}</th>
                                ))}
                            </tr>
                            </thead>
                            <tbody>
                            {rowFields.map(({label}, rowIdx) => (
                                <tr key={rowIdx}>
                                    <th>{label}</th>
                                    {inputFields.map((_, colIdx) => (
                                        <td key={colIdx}>
                                            <input
                                                type="text"
                                                value={getCellValue(formData, rowIdx, colIdx)}
                                                onChange={(e) => handleChange(rowIdx, colIdx, e.target.value)}
                                                readOnly={isReadOnly}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        {renderActionButton(mode, targetId, onEditMode)}
                    </form>
                </div>
            </div>
        </div>
    );
};
