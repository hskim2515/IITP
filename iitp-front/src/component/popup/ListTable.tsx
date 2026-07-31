import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ColDef, ModuleRegistry } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import ColorCellRenderer from "../util/ColorCellRenderer";
import FileCellRenderer from "../util/FileCellRenderer";
import { fieldType } from "./PropertyPopup";
import { PropertyFormSchemaProps } from "@schema/propertyFormSchema";
import './ListTable.css';

ModuleRegistry.registerModules([AllCommunityModule]);

/** 부모 높이를 측정하기 전(첫 페인트) 사용할 기본 높이 — 기존 고정값과 동일 */
const LIST_TABLE_FALLBACK_HEIGHT = 240;

export interface ListTableRef {
    getSelectedRows: () => any[];
}

export interface PropertyFormProps {
    config: PropertyFormSchemaProps;
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
        case 'color': return ColorCellRenderer;
        case 'file':  return FileCellRenderer;
        default:      return undefined;
    }
};

const ListTable = forwardRef<ListTableRef, PropertyFormProps>((props, ref) => {
    const { config, data, onEditMode } = props;
    const gridRef = useRef<AgGridReact>(null);

    // AG Grid 는 픽셀 높이가 필요하다. 고정 240px 대신 부모(팝업 .body)의 가용 높이를 실측해
    // 그 안에서만 스크롤되게 한다 — 하단 Taskbar 에 그리드가 가려지던 원인.
    // 부모 높이를 알 수 없는 초기 프레임에는 기존 값(240)으로 폴백한다.
    const wrapRef = useRef<HTMLDivElement>(null);
    const [gridHeight, setGridHeight] = useState(LIST_TABLE_FALLBACK_HEIGHT);
    useEffect(() => {
        const parent = wrapRef.current?.parentElement;
        if (!parent || typeof ResizeObserver === "undefined") return;
        // 폴백(240)은 부모를 모를 때만 쓰는 값이다 — 부모가 taskbar 위 상한(.overlay max-height)에
        // 눌려 그보다 작아졌는데도 240 을 유지하면 그 차이만큼 그리드 하단이 taskbar 뒤로 나간다.
        // 부모 높이를 알 수 있으면 항상 그 값을 따르고, 알 수 없을 때만 폴백으로 되돌린다.
        const resolve = () => {
            const own = parent.clientHeight;
            if (own > 0) return own;
            // 부모가 content 기반(.body flex:0 1 auto)이라 0 으로 잡히는 첫 프레임에는
            // 조부모(.panel)의 남은 높이를 상한으로 삼아 폴백이 넘치지 않게 한다.
            const grandparent = parent.parentElement?.clientHeight ?? 0;
            return grandparent > 0
                ? Math.min(LIST_TABLE_FALLBACK_HEIGHT, grandparent)
                : LIST_TABLE_FALLBACK_HEIGHT;
        };
        const ro = new ResizeObserver(() => setGridHeight(Math.max(0, Math.round(resolve()))));
        ro.observe(parent);
        setGridHeight(Math.max(0, Math.round(resolve())));
        return () => ro.disconnect();
    }, []);

    useImperativeHandle(ref, () => ({
        getSelectedRows: () => gridRef.current?.api?.getSelectedRows?.() || []
    }));

    const columnDefs = buildColumnDefs(config.fields);

    const handleRowDoubleClicked = (event: any) => {
        if (onEditMode && event.data?.id !== undefined) {
            onEditMode('view', event.data.id);
        }
    };

    return (
        // minWidth:0 / maxWidth:100% — 컬럼 총 너비가 팝업보다 넓어도 이 래퍼가 늘어나
        // 팝업 바깥에 두 번째 가로 스크롤을 만들지 않게 한다 (GridTable 래퍼와 동일 이유).
        <div
            ref={wrapRef}
            className="ag-theme-alpine ag-dark-custom"
            style={{ height: gridHeight, width: '100%', minWidth: 0, maxWidth: '100%' }}
        >
            <AgGridReact
                theme="legacy"
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
    );
});

export default ListTable;
