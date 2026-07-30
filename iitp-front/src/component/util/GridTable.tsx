import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// 필드가 이보다 많은 레벨에서는 처음 이 개수만 기본 표시하고 나머지는 "더보기"로 접는다 —
// 스키마에 정의된 필드가 전부 같은 비중으로 평면 나열되면(예: network links 17개 필드) 정작
// 자주 보는 핵심 값을 찾기 어려워 목록이 표 형태 스프레드시트처럼 느껴진다는 피드백에 따른 것.
// 필드별 "중요도" 개념이 스키마(layer_schema_field)에 아직 없으므로, definition 순서(관리자가
// 등록한/도메인 모델 선언 순서)를 그대로 우선순위로 사용한다.
const DEFAULT_VISIBLE_FIELD_COUNT = 6;

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

    // 레벨(frame.levelName)이 바뀌면 GridTable 자체가 새 key로 리마운트되므로(DrilldownGrid 참고)
    // 이 상태는 자연히 초기화된다 — 별도 리셋 로직 불필요.
    const [expanded, setExpanded] = useState(false);
    const hasMoreFields = dataCols.length > DEFAULT_VISIBLE_FIELD_COUNT;
    const visibleDataCols = useMemo(
        () => (expanded || !hasMoreFields) ? dataCols : dataCols.slice(0, DEFAULT_VISIBLE_FIELD_COUNT),
        [dataCols, expanded, hasMoreFields]
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
        ...visibleDataCols,
    ], [drillColumn, visibleDataCols]);

    // 선택 동기화: selectedGuid → AG Grid
    useEffect(() => {
        const api = gridRef.current?.api;
        if (!api || !selectedGuid?.length) return;
        const guidSet = new Set(selectedGuid);
        api.forEachNode((node) => {
            const selected = guidSet.has(node.data?.__guid);
            if (node.isSelected() !== selected) node.setSelected(selected, false, "api");
        });
    }, [selectedGuid, frame.rows]);

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
        enableClickSelection: true,
    }), []);

    const onSelectionChanged = useCallback(() => {
        const selected = gridRef.current?.api?.getSelectedRows() ?? [];
        // 'grid' 소스 — 그리드 행 선택만 지도 fly-to/줌을 동반 (지도 클릭 선택은 카메라 고정)
        setSelectedGuid(selected.map((r: any) => r.__guid).filter(Boolean), 'grid');
    }, [setSelectedGuid]);

    const fieldToggleBarHeight = hasMoreFields ? 28 : 0;

    return (
        <div style={{ height: containerHeight, width: "100%" }}>
            {hasMoreFields && (
                <div className={style.fieldToggleBar}>
                    <span className={style.fieldToggleInfo}>
                        {expanded
                            ? `전체 필드 ${dataCols.length}개 표시 중`
                            : `핵심 필드 ${DEFAULT_VISIBLE_FIELD_COUNT}개만 표시 중 (전체 ${dataCols.length}개)`}
                    </span>
                    <button className={style.fieldToggleBtn} onClick={() => setExpanded(e => !e)}>
                        {expanded ? "간단히 보기" : `+${dataCols.length - DEFAULT_VISIBLE_FIELD_COUNT}개 필드 더보기`}
                    </button>
                </div>
            )}
            <div
                className={`ag-theme-alpine ag-dark-custom ${style.gridWrap}`}
                style={{ height: containerHeight - fieldToggleBarHeight, width: "100%" }}
            >
                <AgGridReact
                    theme="legacy"
                    ref={gridRef}
                    rowData={frame.rows}
                    columnDefs={columnDefs}
                    rowSelection={rowSelection}
                    onSelectionChanged={onSelectionChanged}
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
        </div>
    );
};

export default GridTable;
