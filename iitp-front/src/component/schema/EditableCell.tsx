import React, { useCallback, memo } from 'react';
import type { Field, SchemaColumn } from "@type/Schema";
import {
    TextEditor,
    NumberEditor,
    SelectEditor,
    CheckboxEditor,
    TextareaEditor,
    TagsEditor
} from './CellEditors';
import { useMessageStore } from "@stores/useMessageStore";
import { useEditableCellLogic } from "@hooks/useEditableCellLogic";

interface EditableCellProps {
    field: Field;
    column: SchemaColumn;
    value: any;
    onUpdate: (updates: Partial<Field>) => void;
}

export const EditableCell = memo<EditableCellProps>(function EditableCell({
                                                                              field,
                                                                              column,
                                                                              value,
                                                                              onUpdate
                                                                          }) {
    const setMessage = useMessageStore.getState().setMessage;
    const dataKey = column.configKey as keyof Field;

    const isOptionsColumn =
        (column.configKey as string) === 'options' || column.inputType === 'tags';

    const canEditOptions = !isOptionsColumn || field.inputType === 'select';

    const handleCommitWithValue = useCallback((newValue: any) => {
        if (isOptionsColumn && field.inputType === 'select') {
            const normalized = Array.isArray(newValue)
                ? newValue
                    .filter((x) => x && typeof x.value === 'string')
                    .map((x) => ({
                        ...(x.id !== undefined ? { id: x.id } : {}),
                        value: String(x.value),
                    }))
                : [];
            onUpdate({ options: normalized });
        } else {
            onUpdate({ [dataKey]: newValue });
        }
    }, [dataKey, onUpdate, isOptionsColumn, field.inputType]);

    // 훅을 사용하여 상태 관리 및 커밋 로직 분리
    const {
        tempValue,
        handleChange,
        handleCommit
    } = useEditableCellLogic({value: value, onCommit: handleCommitWithValue});


    // 1. 편집 가능한 경우
    if (canEditOptions) {
        const selectOptions =
            column.inputType === 'select'
                ? (column.options ?? []).map((option) => ({
                    label: option.value ?? String(option.value),
                    value: option.value,
                }))
                : [];

        const editorProps = {
            value: tempValue,
            onChange: handleChange,
            onBlur: handleCommit,
            autoFocus: false,
        };

        switch (column.inputType) {
            case 'select':
                return <SelectEditor {...editorProps} options={selectOptions} />;
            case 'tags':
                return <TagsEditor {...editorProps} />;
            case 'number':
                return <NumberEditor {...editorProps} />;
            case 'checkbox':
                return <CheckboxEditor {...editorProps}/>;
            case 'textarea':
                return <TextareaEditor {...editorProps} />;
            case 'text':
            default:
                return <TextEditor {...editorProps} />;
        }
    }

    // 2. 편집 불가능한 경우 (읽기 전용)
    const displayValue: string = (() => {
        if (column.inputType === 'checkbox') {
            return value ? '✓' : '✗';
        }
        if (column.inputType === 'select') {
            const options = column.options ?? [];
            const matched = options.find(
                (option) =>
                    Object.is(option.value, value) || String(option.value) === String(value)
            );
            return String(matched?.value ?? (value ?? ''));
        }
        if (column.inputType === 'tags') {
            if (Array.isArray(value)) {
                return value.map((x: any) => x?.value).filter(Boolean).join(', ');
            }
        }
        return String(value ?? '');
    })();

    return (
        <div
            style={{
                cursor: 'not-allowed',
                minHeight: '24px',
                padding: '4px 8px',
                opacity: 0.6,
            }}
            title='inputType이 select가 아닐 때는 options를 편집할 수 없습니다.'
            onClick={() => {
                setMessage({
                    type: 'warn',
                    text: 'input type 이 select 일 때만 편집할 수 있습니다',
                });
            }}
        >
            {displayValue}
        </div>
    );
});