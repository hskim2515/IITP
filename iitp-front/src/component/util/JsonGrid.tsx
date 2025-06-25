import React, {useState} from "react";
import { Table } from "antd";
import {useSelectionStore} from "@stores/useSelectionStore";

// 컬럼 자동 추출
function generateColumnsFromData(data: any[]) {
    if (!data?.length) return [];

    const excludedFields = ['__guid', 'shape'];

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
function getNestedArrayField(row: any): string | null {
    if (!row) return null;
    for (const key in row) {
        if (Array.isArray(row[key])) {
            return key;
        }
    }
    return null;
}

// JsonGrid 컴포넌트 with 들여쓰기 depth
const JsonGrid = ({
                      rowData,
                      levelName,
                      depth = 0,
                      layerName,
                      layerGroupName
                  }: {
    rowData: any[];
    levelName?: string;
    depth?: number;
    layerName: string;
    layerGroupName: string;
}) => {

    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);

    const handleSelect = (selectedRowKeys: React.Key[], selectedRows: any[]) => {
        if (selectedRows.length > 0) {
            const guid = selectedRows[0]?.__guid;
            if (guid) {
                setSelectedGuid(guid);
            }
        } else {
            setSelectedGuid(null); // 선택 해제 시 초기화
        }
    };

    const columns = generateColumnsFromData(rowData);
    const nestedField = getNestedArrayField(rowData?.[0]);

    return (
        <div style={{ marginBottom: 16, paddingLeft: depth * 24 }}>
            <h3 style={{ marginBottom: 8 }}>
                {depth > 0 ? `${levelName}` : ""}
            </h3>
            <Table
                dataSource={rowData}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ y: 200 }}
                rowSelection={{
                    type: "checkbox", // or "radio"
                    onChange: handleSelect,
                }}
                expandable={
                    nestedField
                        ? {
                            expandedRowRender: (record) => (
                                <JsonGrid
                                    rowData={record[nestedField] || []}
                                    levelName={nestedField.slice(0, -1)}
                                    depth={depth + 1} // ⬅ 들여쓰기 수준 증가
                                />
                            ),
                            rowExpandable: (record) =>
                                Array.isArray(record[nestedField]) &&
                                record[nestedField].length > 0,
                        }
                        : undefined
                }
            />
        </div>
    );
};

export default JsonGrid;
