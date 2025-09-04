import React from 'react';
import {PropertyFormSchemaProps} from "@schema/propertyFormSchema";
import DynamicInput from "./DynamicInput";
import {MenuTree} from "@stores/useMenuStore";

interface Props {
    activePopupMenu:MenuTree;
    config: PropertyFormSchemaProps
    metaData: Record<string, string>;
    formData: string[][];
    handleChange: (row: number, col: number, value: string) => void;
    handleChangeMeta: (key: string, value: string) => void;
    handleSubmitTable: (e: React.FormEvent) => void;
    isReadOnly: boolean;
    mode: 'create' | 'edit' | 'view';
    onClose: () => void;
    onEditMode: (mode: string, targetId: number) => void;
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
    const createButton = (
        label: string,
        onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void,
        type: "submit" | "button" = "submit"
    ) => (
        <button type={type} className="submit-btn" onClick={onClick}>
            {label}
        </button>
    );

    if (mode === 'view') {
        return createButton('편집', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onEditMode('edit', targetId);
        }, 'button');
    }

    if (mode === 'edit') {
        return (
            <>
                {createButton('저장')}
                {createButton('취소', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditMode('view', targetId);
                }, 'button')}
            </>
        );
    }

    return createButton('등록');
};

const renderMetaInputs = (
    activePopupMenu: MenuTree,
    config: PropertyFormSchemaProps,
    metaData: Record<string, string>,
    isReadOnly: boolean,
    handleChangeMeta: (key: string, value: string) => void
) => (
    <div className="meta-inputs">
        {config.fields.map(({ name, label },idx) => (
            <label key={name}>
                {label}:
                <DynamicInput
                    activePopupMenu={activePopupMenu}
                    type={config.fields[idx].type}
                    propsOptions={config.fields[idx].options}
                    value={metaData[name] ?? ''}
                    onChange={(val) => {handleChangeMeta(name, val);}}
                    readOnly={isReadOnly}
                />
            </label>
        ))}
    </div>
);

const renderInputTable = (
    activePopupMenu: MenuTree,
    config: PropertyFormSchemaProps,
    formData: string[][],
    handleChange: (row: number, col: number, value: string) => void,
    isReadOnly: boolean
) => (
    <table className="input-table">
        <thead>
        <tr>
            <th></th>
            {config.inputFields.map(({ label }) => (
                <th key={label}>{label}</th>
            ))}
        </tr>
        </thead>
        <tbody>
        {config.rowFields.map(({ label }, rowIdx) => (
            <tr key={label}>
                <th>{label}</th>
                {config.inputFields.map((_, colIdx) => (
                    <td key={colIdx}>
                        <DynamicInput
                            activePopupMenu={activePopupMenu}
                            type={config.inputFields[colIdx].type}
                            propsOptions={config.inputFields[colIdx].options}
                            value={formData[rowIdx]?.[colIdx] ?? ''}
                            onChange={(val) => handleChange(rowIdx, colIdx, val)}
                            readOnly={isReadOnly}
                        />
                    </td>
                ))}
            </tr>
        ))}
        </tbody>
    </table>
);


export const TableForm: React.FC<Props> = ({
                                               activePopupMenu,
                                               config,
                                               formData,
                                               metaData,
                                               handleChange,
                                               handleChangeMeta,
                                               handleSubmitTable,
                                               isReadOnly,
                                               mode,
                                               onClose,
                                               onEditMode,
                                               targetId
                                           }) => (
    <div className="popup-overlay-input-table">
        <div className="popup-container-input-table" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
                <span>{getTitleByMode(mode)}</span>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>
            <div className="popup-body">
                <form onSubmit={handleSubmitTable}>
                    {renderMetaInputs(activePopupMenu, config, metaData, isReadOnly, handleChangeMeta)}
                    {renderInputTable(activePopupMenu, config, formData, handleChange, isReadOnly)}
                    {renderActionButton(mode, targetId, onEditMode)}
                </form>
            </div>
        </div>
    </div>
);
