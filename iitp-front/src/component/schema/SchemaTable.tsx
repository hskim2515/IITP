import React, { useState, useMemo, useCallback } from "react";
import { Table, Button, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Schema, Field, SchemaColumn, InputType, SchemaColumnOption } from "@type/Schema";
import { EditableCell } from './EditableCell';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";

interface Props {
    schema: Schema;
    schemaColumns: SchemaColumn[];
    onChange: (updatedSchema: Schema) => void;
}

const DEFAULT_CELL_WIDTH = 160;

function setDefaultFieldValue(inputType: InputType, options: SchemaColumnOption[]) {
    switch (inputType) {
        case "text":
        case "textarea": return "";
        case "select": return options[0]?.value ?? "";
        case "number": return 0;
        case "checkbox": return false;
        case "tags": return [];
        default: return "";
    }
}
// 스키마 테이블 컴포넌트
export const SchemaTable = ({
                                schema,
                                schemaColumns,
                                onChange,
                            }: Props) => {
    const [expandedSchema, setExpandedSchema] = useState<boolean>(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

    const handleFieldUpdate = useCallback((fieldId: number, updates: Partial<Field>) => {
        const updatedFields = schema.fields.map(field =>
            field.id === fieldId ? { ...field, ...updates } : field
        );
        onChange({ ...schema, fields: updatedFields });
    }, [schema, onChange]);

    const handleAddField = useCallback(() => {
        const defaultFields: Partial<Field> = {};
        for (const column of schemaColumns) {
            const fieldName = column.configKey as keyof Omit<Field, 'id'>;
            (defaultFields as any)[fieldName] = setDefaultFieldValue(column.inputType, column.options);
        }

        const newField: Field = {
            id: Date.now(),
            ...defaultFields as Omit<Field, 'id'>,
        };

        const updatedFields = [...schema.fields, newField];
        onChange({ ...schema, fields: updatedFields });
    }, [schema, schemaColumns, onChange]);

    const handleDeleteFields = useCallback(() => {
        if (selectedRowKeys.length === 0) return;
        const updatedFields = schema.fields.filter(field => !selectedRowKeys.includes(field.id));
        onChange({ ...schema, fields: updatedFields });
        setSelectedRowKeys([]);
    }, [schema, onChange, selectedRowKeys]);

    const columns = useMemo((): ColumnsType<Field> => {
        return schemaColumns.map(column => ({
            title: column.configKey.charAt(0).toUpperCase() + column.configKey.slice(1),
            dataIndex: column.configKey,
            key: column.configKey,
            width: DEFAULT_CELL_WIDTH,
            render: (value, field) => (
                <EditableCell
                    field={field}
                    column={column}
                    value={value}
                    onUpdate={(updates) => handleFieldUpdate(field.id, updates)}
                />
            ),
        }));
    }, [schemaColumns, handleFieldUpdate]);

    const rowSelection = useMemo(() => ({
        type: "checkbox" as const,
        selectedRowKeys,
        onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    }), [selectedRowKeys]);

    return (
        <div style={{ paddingLeft: 24, marginBottom: 24 }}>
            <Space style={{marginBottom: 16}}>
                <h3 style={{margin: 0}}>{schema.name}</h3>
                <button onClick={handleAddField} className="grid-btn add-btn">+</button>
                <button onClick={handleDeleteFields} className="grid-btn delete-btn"
                        disabled={selectedRowKeys.length === 0}>-
                </button>
                <div className="grid-header">
                    <FontAwesomeIcon onClick={() => setExpandedSchema(!expandedSchema)}
                                     icon={expandedSchema ? faChevronDown : faChevronUp}/>
                </div>
            </Space>
            {expandedSchema &&
                <Table<Field>
                    tableLayout="fixed"
                    className="transparent-table"
                    columns={columns}
                    dataSource={schema.fields}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    rowSelection={rowSelection}
                />
            }
        </div>
    );
};