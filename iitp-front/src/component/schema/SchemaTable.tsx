import React, { useState, useMemo, useCallback } from "react";
import { Table, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditableCell } from './EditableCell';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { LayerSchemaFieldResponse, SchemaDefinition, SchemaColumn, ColumnOption } from "@type/openapi.gen";

interface Props {
    schema: SchemaDefinition;
    schemaColumns: SchemaColumn[] | undefined;
    onChange: (updatedSchema: SchemaDefinition) => void;
}

const DEFAULT_CELL_WIDTH = 160;

function setDefaultFieldValue(inputType: string | undefined, options: ColumnOption[] | undefined) {
    switch (inputType) {
        case "text":
        case "textarea":
            return "";
        case "select":
            return (options ?? [])[0]?.value ?? "";
        case "number":
            return 0;
        case "checkbox":
            return false;
        case "tags":
            return [];
        default:
            return "";
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

    const handleFieldUpdate = useCallback((fieldId: number, updates: Partial<LayerSchemaFieldResponse>) => {
        const updatedFields = (schema.fields ?? []).map(field =>
            field.id === fieldId ? {...field, ...updates} : field
        );
        onChange({...schema, fields: updatedFields});
    }, [schema, onChange]);

    const handleAddField = useCallback(() => {

        const defaultFields = schemaColumns?.reduce<Record<string, string | number | boolean | string[]>>(
            (acc, column) => {
                if (column.configKey) {
                    acc[column.configKey] = setDefaultFieldValue(column.inputType, column.options);
                }
                return acc;
            }, {}) ?? {};


        const newField: LayerSchemaFieldResponse = {
            id: Date.now(),
            ...defaultFields as Omit<LayerSchemaFieldResponse, 'id'>,
        };

        const updatedFields = [...(schema.fields ?? []), newField];
        onChange({...schema, fields: updatedFields});
    }, [schema, schemaColumns, onChange]);

    const handleDeleteFields = useCallback(() => {
        if (selectedRowKeys.length === 0) return;
        const updatedFields = (schema.fields ?? []).filter(
            field => field.id !== undefined && !selectedRowKeys.includes(field.id)
        );
        onChange({...schema, fields: updatedFields});
        setSelectedRowKeys([]);
    }, [schema, onChange, selectedRowKeys]);

    const columns = useMemo((): ColumnsType<LayerSchemaFieldResponse> => {
        return (schemaColumns ?? []).map(column => ({
            title: column.configKey ? column.configKey.charAt(0).toUpperCase() + column.configKey.slice(1) : '',
            dataIndex: column.configKey,
            key: column.configKey,
            width: DEFAULT_CELL_WIDTH,
            render: (value, field) => (
                <EditableCell
                    field={field}
                    column={column}
                    value={value}
                    onUpdate={(updates) => {
                        if (field.id !== undefined) {
                            handleFieldUpdate(field.id, updates)
                        }
                    }}
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
        <div style={{paddingLeft: 24, marginBottom: 24}}>
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
                <Table<LayerSchemaFieldResponse>
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