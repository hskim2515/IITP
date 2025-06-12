import { CellValueChangedEvent, ColDef, SelectionChangedEvent } from "ag-grid-community";

export interface GridProps {
    colDefs: ColDef[],
    rowData: Record<string, unknown>[];
    onCellValueChanged?: (event: CellValueChangedEvent) => void;
    onSelectionChanged?: (event: SelectionChangedEvent) => void;
}

export interface GridHandle {
    addRow: (rowData: Record<string, unknown>) => void;
    removeSelectedRow: () => void;
    getSelectedRow: () => [];
    setSelectRowsWithField: (field: string, value: unknown) => void;
    switchEditable: (active: boolean) => void;
    setRowDataByField:(primaryField: { field: string, value: unknown }, data: Record<string, unknown>) => void
    isGridChanged: () => boolean
    getChangedValue: () => Record<string, unknown>
}