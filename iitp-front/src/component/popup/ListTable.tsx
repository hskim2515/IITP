import React, {useState, useRef, forwardRef, useImperativeHandle} from 'react';
import { AgGridReact } from 'ag-grid-react';
import {AllCommunityModule, ColDef, ModuleRegistry} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import ColorCellRenderer from "../util/ColorCellRenderer";
import FileCellRenderer from "../util/FileCellRenderer";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface ListTableRef {
    getSelectedRows: () => any[];
}
export interface fieldType {
    name: string;
    label: string;
    type?: string;
}

export interface PropertyFormProps {
    fields: fieldType[];
    onClose: () => void;
    data: { [key: string]: any }[];
    onEditMode?: (mode: string, id: string | number) => void;
}
const buildColumnDefs = (fields: fieldType[]): ColDef[] => [
    {
        headerName: '',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        width: 40,
        pinned: 'left',
    },
    {
        headerName: 'No',
        valueGetter: 'node.rowIndex + 1',
        width: 60,
    },
    ...fields.map((field) => ({
        headerName: field.label,
        field: field.name,
        editable: false,
        cellRenderer: getCellRenderer(field.type),
    }))
];

const getCellRenderer = (type?: string) => {
    switch (type) {
        case 'color':
            return ColorCellRenderer;
        case 'file':
            return FileCellRenderer;
        default:
            return undefined;
    }
};

const ListTable = forwardRef<ListTableRef, PropertyFormProps>((props, ref) => {
    const { fields, data, onEditMode } = props;
    const gridRef = useRef<AgGridReact>(null);
    useImperativeHandle(ref, () => ({
        getSelectedRows: () => {
            return gridRef.current?.api?.getSelectedRows?.() || [];
        }
    }));

    const columnDefs = buildColumnDefs(fields);

    const handleRowDoubleClicked = (event: any) => {
        if (onEditMode && event.data?.id !== undefined) {
            onEditMode('view', event.data.id);
        }
    };

    return (
        <div>
            <div className="ag-theme-alpine" style={{ height: 190, width: '100%' }}>
                <AgGridReact
                    theme={"legacy"}
                    ref={gridRef}
                    rowData={data}
                    columnDefs={columnDefs}
                    rowSelection="multiple"
                    onRowDoubleClicked={handleRowDoubleClicked}
                    defaultColDef={{
                        flex: 1,
                        resizable: true,
                        sortable: true,
                        filter: true,
                    }}
                />
            </div>
        </div>
    );
});

export default ListTable;
