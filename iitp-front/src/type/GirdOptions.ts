import { CellValueChangedEvent, ColDef } from "ag-grid-community";

export interface GridProps {
    colDefs: ColDef[],
    rowData: Record<string, unknown>[];
    onCellValueChanged?: (event: CellValueChangedEvent) => void;
}

export interface GridHandle {
    addRow: (rowData: Record<string, unknown>) => void;
    removeSelectedRow: () => void;
    getSelectedRow: () => [];
    setSelectRowsWithField: (field: string, value: unknown) => void;
    switchEditable: () => void;
    setRowDataByField:(primaryField: { field: string, value: unknown }, data: Record<string, unknown>) => void
    isGridChanged: () => boolean
    getChangedValue: () => unknown
}