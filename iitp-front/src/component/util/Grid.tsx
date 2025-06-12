import { AgGridReact } from "ag-grid-react";
import React, { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CellValueChangedEvent, RowClickedEvent, RowDoubleClickedEvent } from "ag-grid-community";
import { AllCommunityModule, ColDef, IRowNode, ModuleRegistry } from "ag-grid-community";
import { GridHandle, GridProps } from "@type/GirdOptions";

const DEFAULT_GRID_OPTIONS = {
    defaultColDef: {
        flex: 1,
        resizable: true,
        sortable: true,
        filter: true,
    },
    rowSelection: {
        mode: 'multiRow',
        enableClickSelection: true,
    }
};

const Grid = forwardRef<GridHandle, GridProps>(({ colDefs, rowData, onCellValueChanged, onSelectionChanged }, ref: ForwardedRef<GridHandle>) => {
    ModuleRegistry.registerModules([ AllCommunityModule ]);

    const gridRef = useRef<AgGridReact>(null);
    const [ clickedRow, setClickedRow ] = useState<unknown | undefined>(undefined)

    const [ columnDefsState, setColumnDefsState ] = useState<ColDef[]>([]);
    const [ editable, setEditable ] = useState<boolean>(false);

    const [ isChanged, setIsChanged ] = useState<boolean>(false)
    const [ changedCellValue, setChangedCellValue ] = useState<undefined | unknown>(undefined)

    useEffect(() => {
        const updatedDefs = colDefs.map((col) => ({
            ...col,
            editable: editable,
        }));
        setColumnDefsState(updatedDefs);
    }, [ colDefs, editable ]);

    useEffect(() => {
        console.log("rowData:::", rowData)
    }, [rowData]);

    const addRow = (rawData: Record<string, unknown>): void => {
        if (!gridRef) return;

        const rowCount = gridRef.current.api.getDisplayedRowCount();
        console.log("size:::",rowCount)
        gridRef.current.api.applyTransaction({ add: [ rawData ], addIndex: rowCount })
        gridRef.current.api.ensureIndexVisible(rowCount, 'bottom');
        gridRef.current.api.deselectAll();

        const newRow = gridRef.current.api.getDisplayedRowAtIndex(rowCount);
        console.log("size:::::",newRow)
        if (newRow) newRow.setSelected(true);

        requestAnimationFrame(() => {
            const editableCol = columnDefsState.find(
                (col) => col.editable && col.field
            );
            if (editableCol?.field) {
                gridRef.current.api.startEditingCell({
                    rowIndex: rowCount,
                    colKey: editableCol.field,
                });
            }
        });
        setIsChanged(true)
    };

    const removeSelectedRow = () => {
        const rows = gridRef.current.api.getSelectedRows();
        if (rows.length === 0) return;
        removeRow(rows)
        setIsChanged(true)
    };

    const removeRow = (rows: []) => {
        gridRef.current.api.applyTransaction({ remove: rows })
        gridRef.current.api.deselectAll()
    }
    const getRowNodesByField = (field: string, value: unknown): IRowNode[] => {
        const foundNode: IRowNode[] = []
        gridRef.current.api.forEachNode((node: IRowNode) => {

            if ((node.data)[field] == value) {
                foundNode.push(node);

            }
        });
        return foundNode;
    }

    const deleteRowsByField = (field: string, value: unknown): void => {
        const rowsToRemove: unknown[] = getRowNodesByField(field, value);
        if (rowsToRemove.length > 0) gridRef.current.api.applyTransaction({ remove: rowsToRemove });
        gridRef.current.api.deselectAll();
    }

    const getSelectedRow = () => {
        return gridRef.current.api.getSelectedRows();
    }

    const setSelectRow = (node: IRowNode | IRowNode[]): void => {
        gridRef.current.api.deselectAll();
        const nodes: IRowNode[] = Array.isArray(node)
            ? node
            : [ node ];
        if (nodes.length === 0) {
            return;
        }
        nodes.forEach((node) => node.setSelected(true));

        const firstNode = nodes[0];
        if (firstNode.rowIndex !== undefined && firstNode.rowIndex !== null) {
            gridRef.current.api.ensureIndexVisible(firstNode.rowIndex, 'top');
        }
    }

    const setSelectRowsWithField = (field: string, value: unknown): void => {
        gridRef.current.api.deselectAll();
        const nodes = getRowNodesByField(field, value);
        setSelectRow(nodes)
    }

    const getRowNodeByRowIndex = (rowIndex: number): IRowNode => {
        return gridRef.current.api.getDisplayedRowAtIndex(rowIndex);
    }

    const getClickedRow = () => {
        return clickedRow;
    }

    const setRowDataByField = (
        primaryField: { field: string, value: unknown }, // id
        data: Record<string, unknown> // new row / updated row
    ) => {
        getRowNodesByField(primaryField.field, primaryField.value)
            .map(node => node.updateData(data))
        setIsChanged(true)
    }
    const switchEditable = (active: boolean) => {
        if (!gridRef.current) return;

        // 활성화 해제 시 편집 중단
        if (!active) {
            gridRef.current.api?.stopEditing(true);
        }

        setEditable(active);

        const updatedDefs = columnDefsState.map((col) => ({
            ...col,
            editable: col.field !== 'selected' ? active : false, // selected 직접 편집 X
        }));

        setColumnDefsState(updatedDefs);
    };

    const isGridChanged = (): boolean => {
        return isChanged;
    }

    const handleRowDoubleClick = (event: RowDoubleClickedEvent) => {
        console.log("[Grid] handleRowDoubleClick:::",event.data)
    };

    const handleRowClick = (event: RowClickedEvent) => {
        setClickedRow(event.data);
    };

    const handleCellValueChange = (event: CellValueChangedEvent) => {
        setChangedCellValue(event.data)
        onCellValueChanged?.(event)
    }

    const getChangedValue = () => {
        return changedCellValue;
    }

    useImperativeHandle(ref, () => ({
        addRow: addRow,
        removeSelectedRow: removeSelectedRow,
        getSelectedRow: getSelectedRow,
        setSelectRowsWithField: setSelectRowsWithField,
        switchEditable: switchEditable,
        setRowDataByField: setRowDataByField,
        isGridChanged: isGridChanged,
        getChangedValue: getChangedValue,
    }));
    return (
        <div>
            <div className="ag-theme-alpine" style={ { height: 180, width: '99%' } }>
                <AgGridReact
                    theme={ "legacy" }
                    ref={ gridRef }
                    rowData={ rowData }
                    columnDefs={ columnDefsState }
                    rowSelection={ DEFAULT_GRID_OPTIONS.rowSelection }
                    onRowClicked={ handleRowClick }
                    onRowDoubleClicked={ handleRowDoubleClick }
                    defaultColDef={ DEFAULT_GRID_OPTIONS.defaultColDef }
                    onCellValueChanged={ handleCellValueChange }
                    onRowValueChanged={ () => setIsChanged(true) }
                    onSelectionChanged={ onSelectionChanged }
                />
            </div>
        </div>
    );
});

export default Grid;
