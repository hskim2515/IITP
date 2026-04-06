import React, { useCallback, useEffect, useMemo } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

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
    const navigateByPath = useNavigationStore((s) => s.navigateByPath);

    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const setSelectedGuid = useSelectionStore((s) => s.setSelectedGuid);

    const getSchemaDefinitionByNames = useSchemaStore((s) => s.getSchemaDefinitionByNames);
    const getSchemaColumnSpecByLayerName = useSchemaStore((s) => s.getSchemaColumnSpecByLayerName);
    const getStructureByLayerName = useSchemaStore((s) => s.getStructureByLayerName);

    const definition = useMemo(() => getSchemaDefinitionByNames(layerName, frame.levelName), [getSchemaDefinitionByNames, layerName, frame.levelName]);
    const columnSpec = useMemo(() => getSchemaColumnSpecByLayerName(layerName), [getSchemaColumnSpecByLayerName, layerName]);
    const layerStructure = useMemo(() => getStructureByLayerName(layerName), [getStructureByLayerName, layerName]);

    const currentStructure = useMemo(() => getStructureByFeatureType(layerStructure, frame.levelName), [layerStructure, frame.levelName]);
    const childrenStructure = useMemo(() => getChildrenStructure(currentStructure), [currentStructure]);

    const getChildrenFields = useCallback((levelName: string) => {
        const struct = getStructureByLayerName(layerName);
        const targetStruct = getStructureByFeatureType(struct, levelName);
        return getChildrenStructure(targetStruct);
    }, [getStructureByLayerName, layerName]);

    const handleDrillDown = useCallback((record: any, fieldName: string) => {
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
    }, [frame.levelName, getChildrenFields, push]);

    const drillColumn = useMemo(() => {
        if (!frame.hasChildren || childrenStructure.length === 0) return [];
        return [{
            title: "",
            key: "__drill",
            width: 160,
            fixed: "left" as const,
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
        return [...drillColumn, ...baseCols];
    }, [definition, columnSpec, onCellUpdate, drillColumn]);


    const computedSelectedRowKeys = useMemo(() => {
        if (!selectedGuid?.length) return [];
        const guidSet = new Set(selectedGuid);
        return frame.rows
            .filter(row => guidSet.has(row.__guid))
            .map(row => row.__guid);
    }, [selectedGuid, frame.rows]);

    useEffect(() => {
        if (!selectedGuid || selectedGuid.length === 0) return;
        const targetGuid = selectedGuid[0];

        const match = frame.rows.find((row) =>
            targetGuid === row.__guid || targetGuid.startsWith(`${row.__guid}.`)
        );

        if (!match) {
            const stack = useNavigationStore.getState().stack;
            const rootFrame = stack[0];
            if (rootFrame && stack.length > 1) {
                navigateByPath(targetGuid, rootFrame, getChildrenFields);
            }
            return;
        }

        if (targetGuid === match.__guid) {
            const timer = setTimeout(() => {
                const rowElement = document.querySelector(`tr[data-row-key="${match.__guid}"]`);
                rowElement?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 150);
            return () => clearTimeout(timer);
        }

        else {
            const fields = getChildrenFields(frame.levelName);
            const nextFieldName = fields.find((f) =>
                Array.isArray(match[f]) &&
                match[f].some((child: any) =>
                    targetGuid === child.__guid || targetGuid.startsWith(`${child.__guid}.`)
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

    const handleSelect = useCallback((keys: React.Key[]) => {
        setSelectedGuid(keys as string[]);
    }, [setSelectedGuid]);

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
            onRow={(record) => ({
                className: (frame.hasChildren && childrenStructure.some(f => Array.isArray(record[f]) && record[f].length > 0))
                    ? style.drillRow
                    : ""
            })}
        />
    );
};

export default GridTable;