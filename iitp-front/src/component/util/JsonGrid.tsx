import React, { useEffect, useState } from "react";
import { Table } from "antd";
import { useSelectionStore } from "@stores/useSelectionStore";
import { Input, InputNumber } from "antd/lib";
import { layerNameToStoreMap } from "@hooks/useLayerInit";

// 중첩 배열로 생성하지 않을 필드 지정
const EXCLUDED_NESTED_FIELDS = [ "coordinates" ];

// 컬럼 자동 추출
function generateColumnsFromData(data: any[]) {
    if (!data?.length) return [];

    const excludedFields = [ 'shape', '__guid', 'coordinate', 'lat', 'lng', 'featureType', 'from', 'to', 'laneSource', 'laneTarget' ];

    return Object.keys(data[0])
        .filter((key) => !Array.isArray(data[0][key]) && !excludedFields.includes(key))
        .map((key) => {
            const uniqueValues = [ ...new Set(data.map((item) => item[key])) ]
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
                      editable = false,
                  }: {
    rowData: any[];
    levelName?: string;
    depth?: number;
    layerName: string;
    layerGroupName: string;
    editable?: boolean;
}) => {

    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);
    const clearSelected = useSelectionStore((state) => state.clearSelected);

    const handleSelect = (selectedRowKeys: React.Key[], selectedRows: any[]) => {
        if (selectedRows.length > 0) {
            if (selectedRowKeys) {

                setSelectedGuid(selectedRowKeys);
            }
        } else {
            setSelectedGuid([]); // 선택 해제 시 초기화
        }
    };


    const [ rowEditValues, setRowEditValues ] = useState<Record<string, any>>({});
    useEffect(() => {
        setRowEditValues({}); // 외부 currentJsonData 변경 시 내부 수정 상태 초기화
    }, [ rowData ]);
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
        editable && selectedGuid?.includes(guid);
    const enhancedColumns = columns.map((col) => ({
        ...col,
        render: (value, record) => {
            const guid = record.__guid;
            const currentValue = rowEditValues[guid]?.[col.dataIndex] ?? value;

            if (!isEditableRow(guid)) {
                return <span>{ String(value) }</span>;
            }

            const inputType = typeof value === 'number' ? 'number' : 'text';

            const handleCommit = () => {
                const merged = {
                    ...record,
                    ...rowEditValues[guid],
                };
                // 변경점 병합
                const store = layerNameToStoreMap[layerName]
                store.getState().updateCurrentJsonData(merged);
            };

            return inputType === 'number' ? (
                <InputNumber
                    value={ currentValue }
                    onChange={ (val) => handleInputChange(guid, col.dataIndex, val) }
                    onBlur={ handleCommit }
                    onPressEnter={ handleCommit }
                    size="small"
                />
            ) : (
                <Input
                    value={ currentValue }
                    onChange={ (e) =>
                        handleInputChange(guid, col.dataIndex, e.target.value)
                    }
                    onBlur={ handleCommit }
                    onPressEnter={ handleCommit }
                    size="small"
                />
            );
        },
    }));
    const nestedFields = getNestedArrayField(rowData?.[0]);

    return (
        <div style={ { paddingLeft: depth * 24 } }>
            {/*<h3 style={{ display: depth > 0 ? "block" : "none" }}>*/}
            {/*</h3>*/}
            <Table
                dataSource={rowData}
                columns={enhancedColumns}
                rowKey="__guid"
                size="small"
                pagination={false}
                scroll={{ y: 200 }}
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
                                    {nestedFields.map((field) => (
                                        Array.isArray(record[field]) && record[field].length > 0 ? (
                                            <div key={field}>
                                                <h4 style={{ marginBottom: 4 }}>{field}</h4>
                                                <JsonGrid
                                                    rowData={record[field]}
                                                    levelName={field.slice(0, -1)}
                                                    depth={depth + 1}
                                                />
                                            </div>
                                        ) : null
                                    ))}
                                </>
                            ),
                            rowExpandable: (record) =>
                                nestedFields.some(
                                    (field) =>
                                        Array.isArray(record[field]) &&
                                        record[field].length > 0
                                ),
                        }
                        : undefined
                }
            />

        </div>
    );
};

export default JsonGrid;
