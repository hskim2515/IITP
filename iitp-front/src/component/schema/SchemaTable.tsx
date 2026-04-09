import React, { useState, useMemo, useCallback, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
    AllCommunityModule,
    ColDef,
    ModuleRegistry,
    RowSelectionOptions,
    ICellRendererParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

import { EditableCell } from './EditableCell';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { LayerSchemaFieldResponse, SchemaDefinition, SchemaColumn, ColumnOption } from "@type/openapi.gen";
import gridStyle from "@css/GridTable.module.css";
import styles from "@css/SchemaSetting.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);

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

export const SchemaTable = ({ schema, schemaColumns, onChange }: Props) => {
    const gridRef = useRef<AgGridReact>(null);
    const [expanded, setExpanded] = useState<boolean>(false);
    const [selectedKeys, setSelectedKeys] = useState<number[]>([]);

    const handleFieldUpdate = useCallback((fieldId: number, updates: Partial<LayerSchemaFieldResponse>) => {
        const updatedFields = (schema.fields ?? []).map(field =>
            field.id === fieldId ? { ...field, ...updates } : field
        );
        onChange({ ...schema, fields: updatedFields });
    }, [schema, onChange]);

    const handleAddField = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
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
        onChange({ ...schema, fields: [...(schema.fields ?? []), newField] });
        setExpanded(true);
    }, [schema, schemaColumns, onChange]);

    const handleDeleteFields = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectedKeys.length === 0) return;
        const updatedFields = (schema.fields ?? []).filter(
            field => field.id !== undefined && !selectedKeys.includes(field.id as number)
        );
        onChange({ ...schema, fields: updatedFields });
        setSelectedKeys([]);
    }, [schema, onChange, selectedKeys]);

    const columnDefs = useMemo((): ColDef[] => {
        return (schemaColumns ?? []).map(column => ({
            headerName: column.configKey
                ? column.configKey.charAt(0).toUpperCase() + column.configKey.slice(1)
                : '',
            field: column.configKey as string,
            width: DEFAULT_CELL_WIDTH,
            resizable: true,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const field = params.data as LayerSchemaFieldResponse;
                return (
                    <EditableCell
                        field={field}
                        column={column}
                        value={params.value}
                        onUpdate={(updates) => {
                            if (field.id !== undefined) {
                                handleFieldUpdate(field.id as number, updates);
                            }
                        }}
                    />
                );
            },
        }));
    }, [schemaColumns, handleFieldUpdate]);

    const rowSelection = useMemo<RowSelectionOptions>(() => ({
        mode: "multiRow",
        checkboxes: true,
        headerCheckbox: true,
        enableClickSelection: true,
    }), []);

    const onSelectionChanged = useCallback(() => {
        const selected = gridRef.current?.api?.getSelectedRows() ?? [];
        setSelectedKeys(selected.map((r: any) => r.id).filter(Boolean));
    }, []);

    const fieldCount = schema.fields?.length ?? 0;
    const rowHeight = 32;
    const headerHeight = 34;
    const gridHeight = headerHeight + fieldCount * rowHeight + 2;

    return (
        <div className={styles.schemaCard}>
            {/* 카드 헤더 — 클릭으로 접기/펼치기 */}
            <div
                className={styles.schemaCardHeader}
                onClick={() => setExpanded(v => !v)}
            >
                <div className={styles.schemaCardTitleGroup}>
                    <span className={styles.schemaCardName}>{schema.name}</span>
                    <span className={styles.schemaCardCount}>{fieldCount}개 필드</span>
                </div>
                <div className={styles.schemaCardActions}>
                    <button className={styles.addBtn} onClick={handleAddField} title="필드 추가">
                        +
                    </button>
                    <button
                        className={styles.deleteBtn}
                        onClick={handleDeleteFields}
                        disabled={selectedKeys.length === 0}
                        title="선택 필드 삭제"
                    >
                        −
                    </button>
                    <FontAwesomeIcon
                        icon={faChevronDown}
                        className={`${styles.schemaCardChevron} ${expanded ? styles.schemaCardChevronOpen : ''}`}
                    />
                </div>
            </div>

            {/* 카드 바디 — AG Grid */}
            {expanded && (
                <div className={styles.schemaCardBody}>
                    <div
                        className={`ag-theme-alpine ag-dark-custom ${gridStyle.gridWrap}`}
                        style={{ height: gridHeight, width: "100%" }}
                    >
                        <AgGridReact
                            theme="legacy"
                            ref={gridRef}
                            rowData={schema.fields ?? []}
                            columnDefs={columnDefs}
                            rowSelection={rowSelection}
                            onSelectionChanged={onSelectionChanged}
                            getRowId={(params) => String(params.data.id)}
                            defaultColDef={{ resizable: true, sortable: false, filter: false }}
                            suppressMovableColumns
                            suppressCellFocus
                            rowHeight={rowHeight}
                            headerHeight={headerHeight}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
