import React, { useEffect, useMemo, useState } from "react";
import { Table } from "antd";
import { useSelectionStore } from "@stores/useSelectionStore";
import { Input, InputNumber } from "antd/lib";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { generateGUIDWithType } from "@utils/guid";
// 중첩 배열로 생성하지 않을 필드 지정
const EXCLUDED_NESTED_FIELDS = ["coordinates"];

// 컬럼 자동 추출
function generateColumnsFromData(data: any[]) {
    if (!data?.length) return [];

    const excludedFields = ['shape', '__guid', 'coordinate', 'lat', 'lng', 'featureType', 'from', 'to', 'laneSource', 'laneTarget', 'menuCode'];

    return Object.keys(data[0])
        .filter((key) => !Array.isArray(data[0][key]) && !excludedFields.includes(key))
        .map((key) => {
            const uniqueValues = [...new Set(data.map((item) => item[key]))]
                .filter(v => v !== undefined && v !== null);

            return {
                title: key,
                dataIndex: key,
                key: key,
                sorter: (a, b) => {
                    const va = a[key];
                    const vb = b[key];
                    return typeof va === 'number' && typeof vb === 'number'
                        ? va - vb
                        : String(va).localeCompare(String(vb));
                },
                filters: uniqueValues.map((val) => ({
                    text: String(val),
                    value: val,
                })),
                onFilter: (value, record) => record[key] === value,
            };
        });
}

// 중첩 배열 필드 감지
function getNestedArrayField(row: any): any[] {
    if (!row) return null;

    let nestedFieldList = []

    for (const key in row) {
        const value = row[key];
        if (
            Array.isArray(value) &&
            value.length > 0 &&
            typeof value[0] === "object" &&
            !EXCLUDED_NESTED_FIELDS.includes(key)
        ) {
            nestedFieldList.push(key)
        }
    }

    return nestedFieldList;
}


// JsonGrid 컴포넌트 with 들여쓰기 depth
const JsonGrid = ({
                      rowData,
                      levelName,
                      depth = 0,
                      layerName,
                      layerGroupName,
                  }: {
    rowData: any[];
    levelName?: string;
    depth?: number;
    layerName: string;
    layerGroupName: string;
}) => {
    useEffect(() => {
        console.log("levelName:::", levelName)
    }, [levelName]);
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);
    const clearSelected = useSelectionStore((state) => state.clearSelected);
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
    const [rowEditValues, setRowEditValues] = useState<Record<string, any>>({});

    const store = layerNameToStoreMap[layerName]
    const historyStore = layerNameToHistoryStoreMap[layerName];

    const olMap = useOpenLayersStore.state.map()

    const layer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layer"] === layerName);
    }, [olMap, layerName]);

    const handleSelect = (selectedRowKeys: React.Key[], selectedRows: any[]) => {
        if (selectedRows.length > 0) {
            if (selectedRowKeys) {

                setSelectedGuid(selectedRowKeys);
            }
        } else {
            setSelectedGuid([]); // 선택 해제 시 초기화
        }
    };


    useEffect(() => {
        setRowEditValues({}); // 외부 currentJsonData 변경 시 내부 수정 상태 초기화
    }, [rowData]);

    useEffect(() => {
        console.log("selectedGuid", selectedGuid)
        scrollToGuid(selectedGuid[0])
    }, [selectedGuid]);

    function scrollToGuid(targetGuid: string) {

        const path = findGuidPath(rowData, targetGuid);
        if (!path) return;

        setExpandedRowKeys(path.slice(0, -1)); // 부모들을 펼침

        setTimeout(() => {
            const rowElement = document.querySelector(`tr[data-row-key="${targetGuid}"]`);
            if (rowElement) {
                rowElement.scrollIntoView({behavior: "smooth", block: "center"});
            }
        }, 300); // DOM 렌더링 이후 실행
    }

    function findGuidPath(data: any[], targetGuid: string, path: string[] = []): string[] | null {
        for (const row of data) {
            if (row.__guid === targetGuid) return [...path, row.__guid];

            const nestedFields = getNestedArrayField(row);
            for (const field of nestedFields) {
                const children = row[field];
                if (Array.isArray(children)) {
                    const result = findGuidPath(children, targetGuid, [...path, row.__guid]);
                    if (result) return result;
                }
            }
        }
        return null;
    }

    const handleInputChange = (key: string, field: string, value: any) => {
        setRowEditValues((prev) => ({
            ...prev,
            [key]: {
                ...(prev[key] || {}),
                [field]: value,
            },
        }));
    };
    const columns = generateColumnsFromData(rowData);
    const isEditableRow = (guid: string) =>
        selectedGuid?.includes(guid);
    const enhancedColumns = columns.map((col) => ({
        ...col,
        render: (value, record) => {
            const guid = record.__guid;
            const currentValue = rowEditValues[guid]?.[col.dataIndex] ?? value;

            if (!isEditableRow(guid)) {
                return <span>{String(value)}</span>;
            }

            const handleCommit = () => {
                const merged = {
                    ...record,
                    ...rowEditValues[guid],
                };

                //const historyStore = menuCodeToHistoryStoreMap[layerName];

                // 변경점 병합
                const store = layerNameToStoreMap[layerName]
                const historyStore = layerNameToHistoryStoreMap[layerName];
                store.getState().updateCurrentJsonData(merged, historyStore);
            };

            const numericFieldSet = new Set(['offset', 'linkRef', 'accessTime']);

            const inputType = numericFieldSet.has(col.dataIndex) ? 'number' : 'text';

            return inputType === 'number' ? (
                <InputNumber
                    value={currentValue}
                    onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                    onBlur={handleCommit}
                    onPressEnter={handleCommit}
                    size="small"
                />
            ) : (
                <Input
                    value={currentValue}
                    onChange={(e) => {
                        const raw = e.target.value;
                        const val = inputType === 'number' ? Number(raw) : raw;
                        handleInputChange(guid, col.dataIndex, val);
                    }}
                    onBlur={handleCommit}
                    onPressEnter={handleCommit}
                    size="small"
                />
            );
        },
    }));
    const nestedFields = getNestedArrayField(rowData?.[0]);
    const handleAddBtn = () => {
        console.log("grid addBtn rowData:::", rowData)
        let newRecord;
        const targetFeatureType = levelName;
        console.log("handleAddBtn targetFeatureType:::", targetFeatureType)
        if (!targetFeatureType) {
            if (rowData.length > 0 && rowData[0].featureType) {
                targetFeatureType = rowData[0].featureType;
            } else {
                console.error("새 레코드를 추가할 FeatureType을 알 수 없습니다.");
                alert("새 레코드를 추가할 FeatureType을 알 수 없습니다.");
                return;
            }
        }

        if (typeof layer?.createDto === "function") {
            newRecord = layer.createDto(targetFeatureType);
            newRecord.id = Date.now(); // 임시 ID
            newRecord.__guid = generateGUIDWithType(targetFeatureType); // __guid 생성

            console.log("새로 추가될 DTO:::", newRecord);
            store.getState().updateCurrentJsonData(newRecord, historyStore);
        } else {
            console.error("레이어에 'createDto' 메서드가 정의되어 있지 않습니다.");
            alert("레이어에 'createDto' 메서드가 정의되어 있지 않습니다.");
        }
    }
    const handleDeleteBtn = () => {
        store.getState().removeRecordsByGuid(selectedGuid, historyStore)
    }

    return (
        <div style={{paddingLeft: depth * 24}}>
            {/*<h3 style={{ display: depth > 0 ? "block" : "none" }}>*/}
            {/*</h3>*/}
            <button className="grid-btn add-btn" onClick={() => handleAddBtn()}>+</button>
            <button className="grid-btn delete-btn" onClick={() => handleDeleteBtn()}>-</button>
            <Table
                dataSource={rowData}
                columns={enhancedColumns}
                rowKey={(record) => {
                    if (!record.__guid) {
                        console.warn("🚨 누락된 __guid!", record);
                    }
                    return record.__guid;
                }}
                size="small"
                pagination={false}
                scroll={{y: 200}}
                rowSelection={{
                    type: "checkbox",
                    onChange: handleSelect,
                    selectedRowKeys: selectedGuid,
                }}
                expandable={
                    nestedFields && nestedFields.length > 0
                        ? {
                            expandedRowRender: (record) => (
                                <>
                                    {nestedFields.map((field) => {
                                        console.log("grid nestedFields record:::", record)
                                        console.log("grid nestedFields:::", nestedFields)
                                        console.log("grid nestedFields field:::", field)
                                        return (
                                            Array.isArray(record[field]) && record[field].length > 0 ? (
                                                <div key={field}>
                                                    <h4 style={{marginBottom: 4}}>{field}</h4>
                                                    <JsonGrid
                                                        rowData={record[field]}
                                                        levelName={field}
                                                        depth={depth + 1}
                                                        layerName={layerName}
                                                        layerGroupName={layerGroupName}
                                                    />
                                                </div>
                                            ) : null
                                        )
                                    })}
                                </>
                            ),
                            rowExpandable: (record) =>
                                nestedFields.some(
                                    (field) =>
                                        Array.isArray(record[field]) &&
                                        record[field].length > 0
                                ),
                            expandedRowKeys: expandedRowKeys,  // 👈 추가
                            onExpand: (expanded, record) => {
                                const key = record.__guid;
                                setExpandedRowKeys(prev =>
                                    expanded
                                        ? Array.from(new Set([...prev, key]))
                                        : prev.filter(k => k !== key)
                                );
                            },
                        }
                        : undefined
                }
            />

        </div>
    );
};

export default JsonGrid;
