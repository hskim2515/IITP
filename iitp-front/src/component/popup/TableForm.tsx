import React from 'react';
import { PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import DynamicInput from "./DynamicInput";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/PropertyPopup.module.css";

interface Props {
    activePopupMenu: MenuTreeResponse;
    config: PropertyFormSchemaProps;
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

const MODE_LABELS: Record<string, string> = {
    create: '새 항목 추가',
    edit: '항목 편집',
    view: '상세 정보',
};

const MODE_BADGE: Record<string, string> = {
    create: styles.modeBadgeCreate,
    edit:   styles.modeBadgeEdit,
    view:   styles.modeBadgeView,
};

export const TableForm: React.FC<Props> = ({
    activePopupMenu, config, formData, metaData,
    handleChange, handleChangeMeta, handleSubmitTable,
    isReadOnly, mode, onClose, onEditMode, targetId
}) => (
    <div className={styles.formOverlay}>
        <div
            className={`${styles.formPanel} ${styles.formPanelWide}`}
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div className={styles.formHeader}>
                <span className={styles.formTitle}>{MODE_LABELS[mode] ?? mode}</span>
                <span className={`${styles.modeBadge} ${MODE_BADGE[mode] ?? ''}`}>
                    {mode}
                </span>
                <button className={styles.formCloseBtn} onClick={onClose}>×</button>
            </div>

            {/* Body */}
            <div className={styles.formBody}>
                <form onSubmit={handleSubmitTable}>
                    {/* Meta fields */}
                    {config.fields.length > 0 && (
                        <div className={styles.metaRow}>
                            {config.fields.map(({ name, label }, idx) => (
                                <div key={name} className={styles.metaField}>
                                    <span className={styles.metaLabel}>{label}</span>
                                    <DynamicInput
                                        activePopupMenu={activePopupMenu}
                                        type={config.fields[idx].type}
                                        propsOptions={config.fields[idx].options}
                                        value={metaData[name] ?? ''}
                                        onChange={val => handleChangeMeta(name, val)}
                                        readOnly={isReadOnly}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Input table */}
                    <table className={styles.inputTable}>
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
                                                onChange={val => handleChange(rowIdx, colIdx, val)}
                                                readOnly={isReadOnly}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Footer actions */}
                    <div className={styles.formFooter} style={{ padding: '14px 0 0' }}>
                        {mode === 'view' && (
                            <button
                                type="button"
                                className={styles.editBtn}
                                onClick={e => { e.preventDefault(); onEditMode('edit', targetId); }}
                            >
                                편집
                            </button>
                        )}
                        {mode === 'edit' && (
                            <>
                                <button type="submit" className={styles.submitBtn}>저장</button>
                                <button
                                    type="button"
                                    className={styles.cancelBtn}
                                    onClick={e => { e.preventDefault(); onEditMode('view', targetId); }}
                                >
                                    취소
                                </button>
                            </>
                        )}
                        {mode === 'create' && (
                            <button type="submit" className={styles.submitBtn}>등록</button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    </div>
);
