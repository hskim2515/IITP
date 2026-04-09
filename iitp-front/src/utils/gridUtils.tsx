import React, { memo, useCallback } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { LayerSchemaFieldResponse, SchemaColumn, SchemaDefinition, SchemaStructure } from "@type/openapi.gen";
import { EditableCell } from "@component/schema/EditableCell";

export const DEFAULT_CELL_WIDTH = 160;

/** 현재 레벨의 structure 찾기 */
export function getStructureByFeatureType(
    structures: SchemaStructure[] | null,
    targetName?: string
): SchemaStructure | null {
    if (!structures || !targetName) return null;

    const findStructure = (structures: SchemaStructure[]): SchemaStructure | null => {
        for (const structure of structures) {
            if (structure.name === targetName) return structure;
            const children = structure.children;
            if (children && children.length > 0) {
                const found = findStructure(children);
                if (found) return found;
            }
        }
        return null;
    };

    return findStructure(structures);
}

/** structure 기반 하위 필드 목록 추출 */
export function getChildrenStructure(structure: SchemaStructure | null): string[] {
    if (!structure) return [];
    const children = structure.children;
    return (children ?? [])
        .map((child) => child.name ?? "")
        .filter((name) => name.length > 0);
}

interface AgCellRendererProps {
    data: any;
    field: LayerSchemaFieldResponse;
    column: SchemaColumn;
    onCellUpdate: (record: any, partial: Partial<Record<string, any>>) => void;
}

export const AgCellRenderer = memo(function AgCellRenderer({
    data: record,
    field,
    column,
    onCellUpdate,
}: AgCellRendererProps) {
    const handleUpdate = useCallback(
        (partial: Partial<LayerSchemaFieldResponse>) => {
            const entries = Object.entries(partial ?? {});
            if (entries.length !== 1) return;
            const [k, v] = entries[0];
            if (k === "options") return;
            if (k === field.name || Object.prototype.hasOwnProperty.call(record, k)) {
                onCellUpdate(record, { [k]: v } as Partial<Record<string, any>>);
            }
        },
        [record, onCellUpdate, field.name]
    );

    const fieldName = field.name ?? "";
    return (
        <EditableCell
            field={field}
            column={column}
            value={record?.[fieldName]}
            onUpdate={handleUpdate}
        />
    );
});

/** definition 기반 AG Grid ColDef 생성 */
export function buildColumnsFromDefinition(
    definition: SchemaDefinition | null,
    columnSpecList: SchemaColumn[] | null,
    onCellUpdate: (record: any, updates: Partial<Record<string, any>>) => void
): ColDef[] {
    if (!definition?.fields) return [];
    return definition.fields
        .filter((f: LayerSchemaFieldResponse) => f?.status === "ACTIVE")
        .map((field: LayerSchemaFieldResponse) => {
            const colSpec: any =
                (columnSpecList ?? []).find((c) => c.configKey === field.name);

            const columnForCell: SchemaColumn = {
                ...(colSpec ?? ({} as SchemaColumn)),
                configKey: field.name as any,
                inputType: (colSpec?.inputType ?? (field as any).inputType) as any,
                options: (colSpec?.options ?? (field as any).options) as any,
            };

            return {
                headerName: field.name,
                field: field.name,
                width: colSpec?.width ?? DEFAULT_CELL_WIDTH,
                resizable: true,
                sortable: true,
                cellRenderer: (params: ICellRendererParams) => (
                    <AgCellRenderer
                        data={params.data}
                        field={field}
                        column={columnForCell}
                        onCellUpdate={onCellUpdate}
                    />
                ),
            } as ColDef;
        });
}
