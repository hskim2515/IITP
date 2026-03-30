import React, { useCallback, useMemo } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useNavigationStore } from "@stores/useNavigationStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useSchemaStore } from "@stores/useSchemaStore";

import type { DrillFrame } from "@stores/useNavigationStore";
import type { SchemaColumn, SchemaDefinition, SchemaStructure } from "@type/openapi.gen";

import style from "@css/GridTable.module.css";
import { buildColumnsFromDefinition, getChildrenStructure, getStructureByFeatureType } from "@component/util/JsonGrid";

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
    const push = useNavigationStore((s) => s.push);
    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const setSelectedGuid = useSelectionStore((s) => s.setSelectedGuid);
    const {
        getSchemaDefinitionByNames,
        getSchemaColumnSpecByLayerName,
        getStructureByLayerName,
    } = useSchemaStore();

    // ── 데이터 및 구조 정의 ──────────────────────────────────────
    const definition = useMemo<SchemaDefinition | null>(
        () => getSchemaDefinitionByNames(layerName, frame.levelName),
        [layerName, frame.levelName]
    );

    const columnSpec = useMemo<SchemaColumn[] | null>(
        () => getSchemaColumnSpecByLayerName(layerName),
        [layerName]
    );

    const layerStructure = useMemo<SchemaStructure[] | null>(
        () => getStructureByLayerName(layerName),
        [layerName]
    );

    const currentStructure = useMemo(
        () => getStructureByFeatureType(layerStructure, frame.levelName),
        [layerStructure, frame.levelName]
    );

    const childrenStructure = useMemo<string[]>(
        () => getChildrenStructure(currentStructure),
        [currentStructure]
    );

    // ── 2. 드릴다운 힌트 컬럼 정의 ────────────────────────────────
    const drillColumn = useMemo(() => {
        if (!frame.hasChildren || childrenStructure.length === 0) return [];

        return [{
            title: "",
            key: "__drill",
            width: 160,
            render: (_: any, record: any) => (
                <div className={style.drillColumnCell}>
                    {childrenStructure
                        .filter((field) => Array.isArray(record[field]))
                        .map((field) => (
                            <span
                                key={field}
                                className={style.drillHint}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const childRows = Array.isArray(record[field]) ? record[field] : [];
                                    const layerStruct = getStructureByLayerName(layerName);
                                    const nextStructure = getStructureByFeatureType(layerStruct, field);
                                    const nextChildren = getChildrenStructure(nextStructure);
                                    const idValue = record.id ?? record.__guid?.slice(-4) ?? "?";

                                    push({
                                        levelName: field,
                                        rows: childRows,
                                        parentRecord: record,
                                        parentGuid: record.__guid,
                                        breadLabel: `${frame.levelName} #${idValue}`,
                                        hasChildren: nextChildren.length > 0,
                                    });
                                }}
                            >
                            › {field} ({record[field].length})
                        </span>
                        ))}
                </div>
            ),
        }];
    }, [frame.hasChildren, frame.levelName, childrenStructure, layerName, push, getStructureByLayerName]);

    // ── 컬럼 합치기 ─────────────────────────────────────────────
    const columns = useMemo<ColumnsType>(() => {
        const baseCols = buildColumnsFromDefinition(definition, columnSpec, onCellUpdate);
        return [ ...baseCols,...drillColumn];
    }, [definition, columnSpec, onCellUpdate, drillColumn]);

    // ── 행 선택 핸들러 ──────────────────────────────────────────
    const handleSelect = useCallback(
        (selectedRowKeys: React.Key[], selectedRows: any[]) => {
            setSelectedGuid(selectedRows.length > 0 ? selectedRowKeys : []);
        },
        [setSelectedGuid]
    );


    return (
        <Table
            className="transparent-table"
            dataSource={frame.rows}
            columns={columns}
            rowKey={(record) => record.__guid}
            size="small"
            pagination={false}
            // virtual
            scroll={{ y: containerHeight, x: "max-content" }}
            locale={{ emptyText: "데이터가 없습니다. [+] 버튼으로 새 항목을 추가하세요." }}
            rowSelection={{
                type: "checkbox",
                onChange: handleSelect,
                selectedRowKeys: selectedGuid ?? [],
            }}
            // onRow={(record) => ({
            //     className: frame.hasChildren ? style.drillRow : undefined,
            // })}
            onRow={(record) => ({
                ...(frame.hasChildren && { className: style.drillRow }),
            })}
        />
    );
};

export default GridTable;