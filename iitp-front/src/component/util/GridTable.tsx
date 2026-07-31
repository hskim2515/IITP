import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
    AllCommunityModule,
    ColDef,
    ModuleRegistry,
    RowSelectionOptions,
    ICellRendererParams,
    IRowNode,
    SelectionChangedEvent,
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
import { isGuidSelfOrDescendant } from "@utils/guid";

ModuleRegistry.registerModules([AllCommunityModule]);

// 필드가 이보다 많은 레벨에서는 처음 이 개수만 기본 표시하고 나머지는 "더보기"로 접는다 —
// 스키마에 정의된 필드가 전부 같은 비중으로 평면 나열되면(예: network links 17개 필드) 정작
// 자주 보는 핵심 값을 찾기 어려워 목록이 표 형태 스프레드시트처럼 느껴진다는 피드백에 따른 것.
// 필드별 "중요도" 개념이 스키마(layer_schema_field)에 아직 없으므로, definition 순서(관리자가
// 등록한/도메인 모델 선언 순서)를 그대로 우선순위로 사용한다.
const DEFAULT_VISIBLE_FIELD_COUNT = 6;

// AG Grid 행 높이(px) — 부드러운 스크롤 시 목표 스크롤 위치(행 인덱스 × 행 높이) 계산에 사용.
const ROW_HEIGHT = 32;

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
    const gridWrapRef = useRef<HTMLDivElement>(null);
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

    // 선택 동기화: selectedGuid → AG Grid (+ 선택 행을 뷰 안으로 스크롤)
    //   드릴다운으로 GridTable 이 새 key 로 리마운트되면 이 함수는 마운트 직후 effect 에서 한 번,
    //   그리고 그리드 api/행노드가 준비되는 onGridReady·onFirstDataRendered 에서 다시 호출된다 —
    //   effect 만 있으면 마운트 시점엔 api(또는 행노드)가 아직 없어 체크가 건너뛰어지고
    //   "한 번 더 클릭해야 체크되는" 증상이 남는다. 최신 selectedGuid 는 store 에서 직접 읽는다.
    const applySelectionToGrid = useCallback(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const guids = useSelectionStore.getState().selectedGuid;
        if (!guids?.length) return;
        const guidSet = new Set(guids);
        let firstSelectedNode: IRowNode | null = null;
        api.forEachNode((node) => {
            const selected = guidSet.has(node.data?.__guid);
            if (selected && !firstSelectedNode) firstSelectedNode = node;
            if (node.isSelected() !== selected) node.setSelected(selected, false, "api");
        });
        // 지도 클릭 등 외부 선택 시 대상 행을 화면 최상단으로 스크롤.
        //   ensureNodeVisible 은 즉시 점프라 여러 트리거(effect/onGridReady/onFirstDataRendered)와
        //   맞물리면 화면이 튀어 보인다 → 뷰포트 네이티브 스무스 스크롤로 자연스럽게 이동한다.
        const node = firstSelectedNode as IRowNode | null;
        if (node && node.rowIndex != null) {
            const viewport = gridWrapRef.current?.querySelector<HTMLElement>(".ag-body-viewport");
            const targetTop = node.rowIndex * ROW_HEIGHT;
            if (viewport && Math.abs(viewport.scrollTop - targetTop) > 1) {
                viewport.scrollTo({ top: targetTop, behavior: "smooth" });
            } else if (!viewport) {
                api.ensureNodeVisible(node, "top"); // 폴백(뷰포트 DOM 미탐색 시)
            }
        }
    }, []);

    useEffect(() => {
        applySelectionToGrid();
    }, [selectedGuid, frame.rows, applySelectionToGrid]);

    // 드릴다운 네비게이션: selectedGuid가 다른 레벨에 있을 때
    useEffect(() => {
        if (!selectedGuid || selectedGuid.length === 0) return;
        const targetGuid = selectedGuid[0] as string;

        const match = frame.rows.find(
            (row) => isGuidSelfOrDescendant(targetGuid, row.__guid)
        );

        if (!match) {
            // 선택된 객체가 현재 프레임의 조상이면(= 사용자가 그 하위로 직접 드릴다운한 상태),
            // 자동 네비게이션으로 상위 레벨로 되돌리지 않는다 — 드릴 컬럼으로 하위 진입 시
            // 부모가 선택된 채라 navigateByPath 가 매번 부모 레벨로 되돌려 "뎁스가 안 바뀌고
            // 같은 체크로 재렌더/스크롤" 되던 문제 방지. (다른 브랜치 선택이면 그대로 이동)
            if (frame.parentGuid && isGuidSelfOrDescendant(frame.parentGuid, targetGuid)) return;
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
                        (child: any) => isGuidSelfOrDescendant(targetGuid, child.__guid)
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
    }, [selectedGuid, frame.rows, frame.levelName, frame.parentGuid, navigateByPath, getChildrenFields, push]);

    const rowSelection = useMemo<RowSelectionOptions>(() => ({
        mode: "multiRow",
        checkboxes: true,
        headerCheckbox: true,
        enableClickSelection: true,
    }), []);

    const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
        // 지도 클릭 등 외부 동기화(source: "api")로 인한 선택 변경은 되쓰지 않는다 —
        // 다시 'grid' 소스로 기록되면 의도치 않은 카메라 fly-to 와 갱신 루프가 생긴다.
        if (event?.source === 'api') return;
        const selected = gridRef.current?.api?.getSelectedRows() ?? [];
        const guids = selected.map((r: any) => r.__guid).filter(Boolean);
        // 'grid' 소스 — 그리드 행 선택만 지도 fly-to/줌을 동반 (지도 클릭 선택은 카메라 고정).
        //   단 2개 이상이 한꺼번에 선택되면(헤더 전체 체크, shift/ctrl 다중 체크, 개별 체크 누적)
        //   이동할 목적지가 하나로 정해지지 않아 guid 마다 fly-to 가 연쇄로 돌며 화면이 튄다 →
        //   'grid-bulk' 로 기록해 하이라이트만 적용하고 카메라는 고정한다.
        //   AG Grid 의 event.source 문자열(헤더 체크박스/셀 클릭 등)에 의존하지 않고 "최종 선택
        //   개수"로 판단해야 세 경로가 모두 같은 정책을 탄다.
        setSelectedGuid(guids, guids.length > 1 ? 'grid-bulk' : 'grid');
    }, [setSelectedGuid]);

    // 상위 측정값이 NaN/음수로 들어오면 인라인 height 로 그대로 쓰지 않는다 — 잘못된 값은
    // 그리드가 부모 박스를 넘어서게 만들어 하단 row·스크롤바가 taskbar 뒤로 나가는 원인이 된다.
    const safeHeight = Number.isFinite(containerHeight) ? Math.max(0, containerHeight as number) : 0;

    return (
        // 토글바 높이를 TS 에서 빼지 않는다 — CSS 의 실제 높이(border 포함)와 어긋나면
        // AG Grid 가 그만큼 커져 마지막 row/스크롤바가 잘린다. flex column 으로 두고
        // 남은 높이 배분을 CSS(.fieldToggleBar flex-shrink:0, .gridWrap flex:1)에 맡긴다.
        // minWidth:0 / maxWidth:100% — 컬럼 총 너비가 패널보다 넓어도 이 래퍼가 그만큼 늘어나
        // 바깥(패널/페이지)에 두 번째 가로 스크롤을 만들지 않게 한다. 가로 스크롤은 AG Grid
        // 내부(.ag-body-horizontal-scroll-viewport) 하나만 남아야 한다.
        <div style={{ height: safeHeight, maxHeight: "100%", width: "100%", minWidth: 0, maxWidth: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
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
                ref={gridWrapRef}
                className={`ag-theme-alpine ag-dark-custom ${style.gridWrap}`}
            >
                <AgGridReact
                    theme="legacy"
                    ref={gridRef}
                    rowData={frame.rows}
                    columnDefs={columnDefs}
                    rowSelection={rowSelection}
                    onSelectionChanged={onSelectionChanged}
                    onGridReady={applySelectionToGrid}
                    onFirstDataRendered={applySelectionToGrid}
                    getRowId={(params) => params.data.__guid}
                    defaultColDef={{
                        resizable: true,
                        sortable: true,
                        filter: false,
                    }}
                    suppressMovableColumns
                    suppressCellFocus
                    rowHeight={ROW_HEIGHT}
                    headerHeight={34}
                />
            </div>
        </div>
    );
};

export default GridTable;
