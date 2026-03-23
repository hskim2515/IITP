import React from 'react';
import DynamicInput from "./DynamicInput";
import { PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/PropertyPopup.module.css";

interface Props {
    activePopupMenu: MenuTreeResponse;
    config: PropertyFormSchemaProps;
    formData: string[];
    handleSimpleChange: (idx: number, value: string | File | null) => void;
    handleSubmitSimple: (e: React.FormEvent) => void;
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

export const SimpleForm = ({
    activePopupMenu, config, formData, handleSimpleChange,
    handleSubmitSimple, isReadOnly, mode, onClose, onEditMode, targetId
}: Props) => (
    <div className={styles.formOverlay}>
        <div className={styles.formPanel} onClick={e => e.stopPropagation()}>
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
                <form id="simple-form" onSubmit={handleSubmitSimple}>
                    {config.inputFields.map(({ name, label, type }, idx) => (
                        <div key={name} className={styles.formField}>
                            <label className={styles.formLabel}>{label}</label>
                            <DynamicInput
                                activePopupMenu={activePopupMenu}
                                propsOptions={config.fields[idx]?.options}
                                type={type}
                                value={formData[idx] ?? ''}
                                onChange={val => handleSimpleChange(idx, val)}
                                readOnly={isReadOnly}
                            />
                        </div>
                    ))}
                </form>
            </div>

            {/* Footer (스크롤 영역 밖 – 항상 표시) */}
            <div className={styles.formFooter}>
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
                        <button type="submit" form="simple-form" className={styles.submitBtn}>저장</button>
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
                    <button type="submit" form="simple-form" className={styles.submitBtn}>등록</button>
                )}
            </div>
        </div>
    </div>
);
