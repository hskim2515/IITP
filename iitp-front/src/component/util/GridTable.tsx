import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useNavigationStore } from "@stores/useNavigationStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useSchemaStore } from "@stores/useSchemaStore";

import type { DrillFrame } from "@stores/useNavigationStore";

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
    const clearSelected = useSelectionStore((s) => s.clearSelected);

    const {
        getSchemaDefinitionByNames,
        getSchemaColumnSpecByLayerName,
        getStructureByLayerName,
    } = useSchemaStore();

    const definition = useMemo(() => getSchemaDefinitionByNames(layerName, frame.levelName), [layerName, frame.levelName]);
    const columnSpec = useMemo(() => getSchemaColumnSpecByLayerName(layerName), [layerName]);
    const layerStructure = useMemo(() => getStructureByLayerName(layerName), [layerName]);
    const currentStructure = useMemo(() => getStructureByFeatureType(layerStructure, frame.levelName), [layerStructure, frame.levelName]);
    const childrenStructure = useMemo(() => getChildrenStructure(currentStructure), [currentStructure]);

    const handleDrillDown = useCallback((record: any, fieldName: string) => {
        const childRows = Array.isArray(record[fieldName]) ? record[fieldName] : [];
        const layerStruct = getStructureByLayerName(layerName);
        const nextStructure = getStructureByFeatureType(layerStruct, fieldName);
        const nextChildren = getChildrenStructure(nextStructure);
        const idValue = record.id ?? record.__guid?.slice(-4) ?? "?";

        push({
            levelName: fieldName,
            rows: childRows,
            parentRecord: record,
            parentGuid: record.__guid,
            breadLabel: `${frame.levelName} #${idValue}`,
            hasChildren: nextChildren.length > 0,
        });
    }, [frame.levelName, layerName, push, getStructureByLayerName]);

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
                            <span key={field} className={style.drillHint} onClick={(e) => { e.stopPropagation(); handleDrillDown(record, field); }}>
                                › {field} ({record[field].length})
                            </span>
                        ))}
                </div>
            ),
        }];
    }, [frame.hasChildren, childrenStructure, handleDrillDown]);

    const columns = useMemo<ColumnsType>(() => {
        const baseCols = buildColumnsFromDefinition(definition, columnSpec, onCellUpdate);
        return [ ...baseCols, ...drillColumn];
    }, [definition, columnSpec, onCellUpdate, drillColumn]);

    useEffect(() => {
        if (!selectedGuid || selectedGuid.length === 0) return;
        const targetGuid = selectedGuid[0];

        const match = frame.rows.find(row =>
            targetGuid === row.__guid || targetGuid.startsWith(`${row.__guid}.`)
        );

        if (match) {
            const remainingPath = targetGuid.replace(`${match.__guid}.`, "");
            if (remainingPath === targetGuid) {
                clearSelected();
                const timer = setTimeout(() => {
                    const rowElement = document.querySelector(`tr[data-row-key="${match.__guid}"]`);
                    rowElement?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 100);
                return () => clearTimeout(timer);
            }

            const nextPart = remainingPath.split('.')[0];
            const nextFieldName = childrenStructure.find(f => nextPart.startsWith(f));

            if (nextFieldName && Array.isArray(match[nextFieldName])) {
                const idValue = match.id ?? match.__guid?.split('-').pop() ?? "?";
                push({
                    levelName: nextFieldName,
                    rows: match[nextFieldName],
                    parentRecord: match,
                    parentGuid: match.__guid,
                    breadLabel: `${frame.levelName} #${idValue}`,
                    hasChildren: true,
                });
            }
        }
    }, [selectedGuid, frame.rows, childrenStructure, push, frame.levelName, clearSelected]);

    const handleSelect = useCallback((keys: React.Key[]) => setSelectedGuid(keys), [setSelectedGuid]);

    const computedSelectedRowKeys = useMemo(() => {
        if (!selectedGuid?.length) return [];
        const target = selectedGuid[0];
        return frame.rows
            .filter(row => target === row.__guid || target.startsWith(`${row.__guid}.`))
            .map(row => row.__guid as React.Key);
    }, [selectedGuid, frame.rows]);

    return (
        <Table
            className="transparent-table"
            dataSource={frame.rows}
            columns={columns}
            rowKey={(record) => record.__guid}
            size="small"
            pagination={false}
            scroll={{ y: containerHeight, x: "max-content" }}
            rowSelection={{
                type: "checkbox",
                onChange: handleSelect,
                selectedRowKeys: computedSelectedRowKeys,
            }}
            onRow={(record) => ({ ...(frame.hasChildren && { className: style.drillRow }) })}
        />
    );
};

export default GridTable;