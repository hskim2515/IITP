import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
    AllCommunityModule,
    CellMouseDownEvent,
    ColDef,
    ModuleRegistry,
    RowSelectionOptions,
    ICellRendererParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

import { useNavigationStore } from "@stores/useNavigationStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useSchemaStore } from "@stores/useSchemaStore";
import type { DrillFrame } from "@stores/useNavigationStore";

import style from "@css/GridTable.module.css";
import {
    buildColumnsFromDefinition,
    getChildrenStructure,
    getStructureByFeatureType,
} from "@utils/gridUtils";

ModuleRegistry.registerModules([AllCommunityModule]);

type GridTableProps = {
    layerName: string;
    layerGroupName: string;
    frame: DrillFrame;
    containerHeight?: number;
    onCellUpdate: (record: any, partial: Partial<Record<string, any>>) => void;
};

export const GridTable = ({
    layerName,
    layerGroupName,
    frame,
    containerHeight = 600,
    onCellUpdate,
}: GridTableProps) => {
    const gridRef = useRef<AgGridReact>(null);
    const selectionFromStoreRef = useRef(false);
    const [gridReady, setGridReady] = useState(false);
    const push = useNavigationStore((s) => s.push);
    const navigateByPath = useNavigationStore((s) => s.navigateByPath);

    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const setSelectedGuid = useSelectionStore((s) => s.setSelectedGuid);

    const getSchemaDefinitionByNames = useSchemaStore((s) => s.getSchemaDefinitionByNames);
    const getSchemaColumnSpecByLayerName = useSchemaStore((s) => s.getSchemaColumnSpecByLayerName);
    const getStructureByLayerName = useSchemaStore((s) => s.getStructureByLayerName);

    const definition = useMemo(
        () => getSchemaDefinitionByNames(layerName, frame.levelName),
        [getSchemaDefinitionByNames, layerName, frame.levelName]
    );
    const columnSpec = useMemo(
        () => getSchemaColumnSpecByLayerName(layerName),
        [getSchemaColumnSpecByLayerName, layerName]
    );
    const layerStructure = useMemo(
        () => getStructureByLayerName(layerName),
        [getStructureByLayerName, layerName]
    );

    const currentStructure = useMemo(
        () => getStructureByFeatureType(layerStructure, frame.levelName),
        [layerStructure, frame.levelName]
    );
    const childrenStructure = useMemo(
        () => getChildrenStructure(currentStructure),
        [currentStructure]
    );

    const getChildrenFields = useCallback(
        (levelName: string) => {
            const struct = getStructureByLayerName(layerName);
            const targetStruct = getStructureByFeatureType(struct, levelName);
            return getChildrenStructure(targetStruct);
        },
        [getStructureByLayerName, layerName]
    );

    const handleDrillDown = useCallback(
        (record: any, fieldName: string) => {
            const childRows = Array.isArray(record[fieldName]) ? record[fieldName] : [];
            const nextFields = getChildrenFields(fieldName);
            const idValue = record.id ?? record.__guid?.slice(-4) ?? "?";
            push({
                levelName: fieldName,
                rows: childRows,
                parentRecord: record,
                parentGuid: record.__guid,
                breadLabel: `${frame.levelName} #${idValue}`,
                hasChildren: nextFields.length > 0,
            });
        },
        [frame.levelName, getChildrenFields, push]
    );

    // 드릴다운 버튼 컬럼
    const drillColumn = useMemo<ColDef[]>(() => {
        if (!frame.hasChildren || childrenStructure.length === 0) return [];
        return [{
            headerName: "",
            colId: "__drill",
            width: childrenStructure.length * 110 + 10,
            pinned: "left" as const,
            resizable: false,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const record = params.data;
                const available = childrenStructure.filter(
                    (f) => Array.isArray(record?.[f])
                );
                if (!available.length) return null;
                return (
                    <div className={style.drillColumnCell}>
                        {available.map((field) => (
                            <span
                                key={field}
                                className={style.drillHint}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDrillDown(record, field);
                                }}
                            >
                                › {field} ({record[field].length})
                            </span>
                        ))}
                    </div>
                );
            },
        }];
    }, [frame.hasChildren, childrenStructure, handleDrillDown]);

    const dataCols = useMemo(
        () => buildColumnsFromDefinition(definition, columnSpec, onCellUpdate),
        [definition, columnSpec, onCellUpdate]
    );

    const columnDefs = useMemo<ColDef[]>(() => [
        {
            headerName: "",
            colId: "__no",
            width: 50,
            pinned: "left" as const,
            resizable: false,
            sortable: false,
            valueGetter: "node.rowIndex + 1",
        },
        ...drillColumn,
        ...dataCols,
    ], [drillColumn, dataCols]);

    const onGridReady = useCallback(() => {
        setGridReady(true);
    }, []);

    // 선택 동기화: selectedGuid → AG Grid
    useEffect(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const guidSet = new Set(selectedGuid);
        let firstSelectedNode: any = null;
        selectionFromStoreRef.current = true;
        api.forEachNode((node) => {
            const selected = guidSet.has(node.data?.__guid);
            if (node.isSelected() !== selected) node.setSelected(selected, false, "api");
            if (selected && !firstSelectedNode) firstSelectedNode = node;
        });
        selectionFromStoreRef.current = false;
        if (firstSelectedNode) {
            api.ensureNodeVisible(firstSelectedNode, "middle");
        }
    }, [selectedGuid, frame.rows, gridReady]);

    // 드릴다운 네비게이션: selectedGuid가 다른 레벨에 있을 때
    useEffect(() => {
        if (!selectedGuid || selectedGuid.length === 0) return;
        const targetGuid = selectedGuid[0] as string;

        const match = frame.rows.find(
            (row) => targetGuid === row.__guid || targetGuid.startsWith(`${row.__guid}.`)
        );

        if (!match) {
            const stack = useNavigationStore.getState().stack;
            const rootFrame = stack[0];
            if (rootFrame && stack.length > 1) {
                navigateByPath(targetGuid, rootFrame, getChildrenFields);
            }
            return;
        }

        if (targetGuid !== match.__guid) {
            const fields = getChildrenFields(frame.levelName);
            const nextFieldName = fields.find(
                (f) =>
                    Array.isArray(match[f]) &&
                    match[f].some(
                        (child: any) =>
                            targetGuid === child.__guid ||
                            targetGuid.startsWith(`${child.__guid}.`)
                    )
            );
            if (nextFieldName) {
                const idValue = match.id ?? match.__guid?.split("-").pop() ?? "?";
                const nextFields = getChildrenFields(nextFieldName);
                push({
                    levelName: nextFieldName,
                    rows: match[nextFieldName],
                    parentRecord: match,
                    parentGuid: match.__guid,
                    breadLabel: `${frame.levelName} #${idValue}`,
                    hasChildren: nextFields.length > 0,
                });
            }
        }
    }, [selectedGuid, frame.rows, frame.levelName, navigateByPath, getChildrenFields, push]);

    const rowSelection = useMemo<RowSelectionOptions>(() => ({
        mode: "multiRow",
        checkboxes: true,
        headerCheckbox: true,
        enableClickSelection: false,
        enableSelectionWithoutKeys: false,
    }), []);

    const onSelectionChanged = useCallback(() => {
        if (selectionFromStoreRef.current) return;
        const selected = gridRef.current?.api?.getSelectedRows() ?? [];
        setSelectedGuid(selected.map((r: any) => r.__guid).filter(Boolean));
    }, [setSelectedGuid]);

    const onCellMouseDown = useCallback((event: CellMouseDownEvent) => {
        const mouseEvent = event.event as MouseEvent | undefined;
        const target = mouseEvent?.target as HTMLElement | null;
        const guid = event.data?.__guid;
        if (!mouseEvent || mouseEvent.button !== 0 || !event.node || !guid) return;
        if (event.column.getColId() === "__drill") return;
        if (target?.closest(".ag-selection-checkbox")) return;

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
            const current = useSelectionStore.getState().selectedGuid.filter(
                (id): id is string => typeof id === "string"
            );
            const nextSelected = !current.includes(guid);
            const nextGuids = nextSelected
                ? [...current, guid]
                : current.filter((id) => id !== guid);

            selectionFromStoreRef.current = true;
            event.node.setSelected(nextSelected, false, "uiSelect");
            selectionFromStoreRef.current = false;
            setSelectedGuid(nextGuids);
            return;
        }

        selectionFromStoreRef.current = true;
        event.api.deselectAll();
        event.node.setSelected(true, false, "uiSelect");
        selectionFromStoreRef.current = false;
        setSelectedGuid([guid]);
    }, [setSelectedGuid]);

    return (
        <div
            className={`ag-theme-alpine ag-dark-custom ${style.gridWrap}`}
            style={{ height: containerHeight, width: "100%" }}
        >
            <AgGridReact
                theme="legacy"
                ref={gridRef}
                rowData={frame.rows}
                columnDefs={columnDefs}
                rowSelection={rowSelection}
                onGridReady={onGridReady}
                onSelectionChanged={onSelectionChanged}
                onCellMouseDown={onCellMouseDown}
                getRowId={(params) => params.data.__guid}
                defaultColDef={{
                    resizable: true,
                    sortable: true,
                    filter: false,
                }}
                suppressMovableColumns
                suppressCellFocus
                rowHeight={32}
                headerHeight={34}
            />
        </div>
    );
};

export default GridTable;
