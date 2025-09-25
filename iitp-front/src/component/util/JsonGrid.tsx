import React, { memo, useCallback, useEffect, useMemo, useRef, useState, } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";

import { useSelectionStore } from "@stores/useSelectionStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useSchemaStore } from "@stores/useSchemaStore";

import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";

import { generateGUIDWithType } from "@utils/guid";
import { generateTemplate } from "@utils/schema";
import { createEventHandlers } from "@handler/createEventHandlers";
import { findGuidPath } from "@utils/jsonGrid";

import { LayerSchemaFieldResponse, SchemaColumn, SchemaDefinition, SchemaStructure, } from "@type/openapi.gen";
import { EditableCell } from "@component/schema/EditableCell";

const DEFAULT_CELL_WIDTH = 160;

/** 현재 레벨의 structure 찾기 */
function getStructureByFeatureType(
    structures: SchemaStructure[] | null,
    targetName?: string
): SchemaStructure | null {
    if (!structures || !targetName) return null;

    const findStructure = (structures: SchemaStructure[]): SchemaStructure | null => {
        for (const structure of structures) {
            if (structure.name === targetName) return structure;
            const children = structure.children;
            if (children && children.length > 0) {
                const found = findStructure(children);
                if (found) return found;
            }
        }
        return null;
    };

    return findStructure(structures);
}

/** structure 기반 하위 필드 목록 추출 */
function getChildrenStructure(structure: SchemaStructure | null): string[] {
    if (!structure) return [];
    const children = structure.children
    return (children ?? [])
        .map((child) => child.name ?? "")
        .filter((name) => name.length > 0);
}

/** definition 기반 컬럼 생성 */
function buildColumnsFromDefinition(
    definition: SchemaDefinition | null,
    columnSpecList: SchemaColumn[] | null,
    onCellUpdate: (record: any, updates: Partial<Record<string, any>>) => void
): ColumnsType<any> {
    if (!definition?.fields) return [];
    const cols: ColumnsType<any> = definition.fields
        .filter((f: LayerSchemaFieldResponse) => f?.status === "ACTIVE")
        .map((field: LayerSchemaFieldResponse) => {
            const colSpec: any =
                (columnSpecList ?? []).find((c) => c.configKey === field.name);

            return {
                title: field.name,
                dataIndex: field.name,
                key: field.name,
                width: DEFAULT_CELL_WIDTH,
                render: (_: any, record: any) => {
                    // EditableCell에 전달할 column 최소 사양을 안전하게 구성
                    const columnForCell: SchemaColumn = {
                        ...(colSpec ?? ({} as SchemaColumn)),
                        // EditableCell이 dataKey로 사용할 키(= 레코드의 속성명)
                        configKey: field.name as any,
                        // 컬럼 사양이 inputType/옵션을 오버라이드하면 따르고, 없으면 스키마 그대로
                        inputType: (colSpec?.inputType ?? (field as any).inputType) as any,
                        options: (colSpec?.options ?? (field as any).options) as any,
                    };

                    return (
                        <EditableCell
                            field={field}
                            column={columnForCell}
                            value={record[field.name]}
                            onUpdate={(partial) => {
                                const entries = Object.entries(partial ?? {});
                                if (entries.length !== 1) return;

                                const [k, v] = entries[0];

                                if (k === "options") return;

                                if (k === field.name) {
                                    onCellUpdate(record, { [k]: v } as Partial<Record<string, any>>);
                                    return;
                                }

                                if (Object.prototype.hasOwnProperty.call(record, k)) {
                                    onCellUpdate(record, { [k]: v } as Partial<Record<string, any>>);
                                }
                            }}
                        />
                    );
                },
                ...colSpec,
            };
        });

    return cols;
}

type JsonGridProps = {
    layerName: string;
    layerGroupName: string;
    rowData?: any[] | undefined;
    levelName?: string;
    parentGuid?: (string | React.Key)[];
    depth?: number;
};

const JsonGrid = ({
                      layerName,
                      layerGroupName,
                      rowData,
                      levelName,
                      parentGuid,
                      depth = 0,
                  }: JsonGridProps) => {
    const setMessage = useMessageStore.getState().setMessage;

    // 도메인별 공통 스토어 매핑
    const dataStore = layerNameToStoreMap[layerName];
    const historyStore = layerNameToHistoryStoreMap[layerName];

    // select 스토어
    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const setSelectedGuid = useSelectionStore((s) => s.setSelectedGuid);
    const clearSelected = useSelectionStore((s) => s.clearSelected);

    const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
    const lastScrollGuidRef = useRef<string | React.Key | undefined>(undefined);
    const [topToggled, setTopToggled] = useState<boolean>(false);

    useEffect(() => {
        if (depth === 0) {
            clearSelected();
            setExpandedRowKeys([])
        }
    }, []);

    // 스키마 스토어
    const {
        getSchemaDefinitionByNames,
        getSchemaColumnSpecByLayerName,
        getStructureByLayerName,
    } = useSchemaStore();

    // 현재 레벨의 schema/structure 조회
    const definition = useMemo<SchemaDefinition | null>(() => {
        if (!levelName) return null;
        return getSchemaDefinitionByNames(layerName, levelName);
    }, [layerName, levelName]);

    const columnSpec = useMemo<SchemaColumn[] | null>(() => {
        if (!levelName) return null;
        return getSchemaColumnSpecByLayerName(layerName);
    }, [layerName]);

    const layerStructure = useMemo<SchemaStructure[] | null>(() => {
        return getStructureByLayerName(layerName);
    }, [layerName]);

    const currentStructure = useMemo<SchemaStructure | null>(() => {
        return getStructureByFeatureType(layerStructure, levelName);
    }, [layerStructure, levelName]);

    const childrenStructure = useMemo<string[]>(() => {
        return getChildrenStructure(currentStructure);
    }, [currentStructure]);

    // 셀 업데이트 → 스토어 반영(편집용)
    const handleCellUpdate = useCallback(
        (record: any, partial: Partial<Record<string, any>>) => {
            const merged = {...record, ...partial};
            dataStore.getState().updateCurrentJsonData(merged, historyStore);
        },
        [layerName]
    );

    // 컬럼 생성 (structure → definition 기반)
    const columns = useMemo<ColumnsType>(() => {
        return buildColumnsFromDefinition(definition, columnSpec, handleCellUpdate);
    }, [definition, columnSpec, handleCellUpdate]);

    // 행 선택
    const handleSelect = useCallback(
        (selectedRowKeys: React.Key[], selectedRows: any[]) => {
            if (selectedRows.length > 0) {
                setSelectedGuid(selectedRowKeys);
            } else {
                setSelectedGuid([]);
            }
        },
        [setSelectedGuid]
    );

    const handleAddBtn = useCallback(() => {
        const targetFeatureType = levelName;
        if (!targetFeatureType) {
            setMessage({type: "error", text: "새 레코드를 추가할 FeatureType을 알 수 없습니다."});
            return;
        }

        const targetSchema = useSchemaStore
            .getState()
            .getSchemaDefinitionByNames(layerName, targetFeatureType);
        const template = generateTemplate(targetSchema);

        if (!template) {
            setMessage({type: "error", text: "레이어에 스키마가 정의되어 있지 않습니다."});
            return;
        }

        const tempRecord: Record<string, any> = {
            ...template,
            featureType: targetFeatureType,
            id: Date.now(),
            __guid: generateGUIDWithType(targetFeatureType),
            parentGuid: parentGuid || null,
        };

        const cleanup = createEventHandlers(tempRecord);
        return () => {
            if (cleanup) cleanup()
        }
    }, [levelName, parentGuid, layerName, setMessage]);

    const handleDeleteBtn = useCallback(() => {
        if (!selectedGuid || selectedGuid.length === 0) {
            setMessage({type: "warn", text: "삭제할 항목을 선택해주세요."});
            return;
        }
        dataStore.getState().removeRecordsByGuid(selectedGuid, historyStore);
        setMessage({type: "info", text: `${selectedGuid.length}개 항목이 삭제되었습니다.`});
        clearSelected();
    }, [selectedGuid, dataStore, historyStore, clearSelected, setMessage]);

    const scrollToGuid = useCallback(

        (targetGuid: string | React.Key | undefined) => {
            if (!targetGuid) return;

            // 동일 GUID 중복 스크롤 방지
            if (lastScrollGuidRef.current === targetGuid) return;
            lastScrollGuidRef.current = targetGuid;

            // 현재 그리드 rowData에서 경로 찾기
            if(!rowData) return;
            const path = findGuidPath(rowData, targetGuid);
            if (!path) return;

            // 부모들을 펼침
            setExpandedRowKeys(path.slice(0, -1));

            // 스크롤
            requestAnimationFrame(() => {
                const rowElement = document.querySelector(
                    `tr[data-row-key="${String(targetGuid)}"]`
                );
                if (rowElement) {
                    rowElement.scrollIntoView({behavior: "smooth", block: "center"});
                }
            });
        },
        [rowData]
    );

    // 선택 변경 시 자동 스크롤
    useEffect(() => {
        if (selectedGuid && selectedGuid.length > 0) {
            scrollToGuid(selectedGuid[0]);
        }
    }, [selectedGuid, scrollToGuid]);

    return (
        <div style={{paddingLeft: depth * 24}}>
            <div style={{display: "flex", alignItems: "center"}}>
                <h4 style={{margin: 0}}>{levelName}</h4>
                <button className="grid-btn add-btn" onClick={() => handleAddBtn()}>+</button>
                <button className="grid-btn delete-btn" onClick={() => handleDeleteBtn()}>-</button>

                {/* 상단 토글 (루트에서만) */}
                <h3 style={{display: depth === 0 ? "block" : "none"}}>
                    <div className="grid-header">
                        <FontAwesomeIcon
                            onClick={() => setTopToggled((v) => !v)}
                            icon={topToggled ? faChevronUp : faChevronDown}
                        />
                    </div>
                </h3>
            </div>

            {(depth > 0 || topToggled) && (
                <Table
                    className="transparent-table"
                    dataSource={rowData ?? []}
                    columns={columns}
                    rowKey={(record) => {
                        if (!record.__guid) {
                            console.warn("🚨 누락된 __guid!", record);
                        }
                        return record.__guid;
                    }}
                    size="small"
                    pagination={false}
                    scroll={{y: 600}}
                    locale={{
                        emptyText: "데이터가 없습니다. [+] 버튼으로 새 항목 추가를 시작하세요.",
                    }}
                    rowSelection={{
                        type: "checkbox",
                        onChange: (keys, rows) => handleSelect(keys, rows),
                        selectedRowKeys: selectedGuid ?? [],
                    }}
                    expandable={
                        // 자식 구조가 정의되어 있으면, 데이터 유무와 무관하게 확장 허용
                        (childrenStructure.length > 0)
                            ? {
                                expandedRowRender: (record) => (
                                    <>
                                        {childrenStructure.map((field) => (
                                            <div key={`${record.__guid}-${field}`}>
                                                <JsonGrid
                                                    rowData={Array.isArray(record[field]) ? record[field] : []}
                                                    levelName={field}
                                                    parentGuid={record["__guid"]}
                                                    depth={depth + 1}
                                                    layerName={layerName}
                                                    layerGroupName={layerGroupName}
                                                />
                                            </div>
                                        ))}
                                    </>
                                ),
                                rowExpandable: () => true,
                                expandedRowKeys: expandedRowKeys,
                                onExpand: (expanded, record) => {
                                    const key = record.__guid;
                                    setExpandedRowKeys((prev) =>
                                        expanded
                                            ? Array.from(new Set([...prev, key]))
                                            : prev.filter((k) => k !== key)
                                    );
                                },
                            }
                            : undefined
                    }
                />
            )}
        </div>
    );
};

export default memo(JsonGrid);
