import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Checkbox, Select, Table} from "antd";
import { useSelectionStore } from "@stores/useSelectionStore";
import { Input, InputNumber } from "antd/lib";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { generateGUIDWithType } from "@utils/guid";
import {faChevronDown, faChevronUp} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useSchemeStore} from "@stores/useSchemeStore";
import debounce from "lodash.debounce";
import {featureTypeEventHandlers} from "../../handler/featureTypeEventHandlers";


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
                      parentGuid,
                      depth = 0,
                      layerName,
                      layerGroupName,
                  }: {
    rowData: any[];
    levelName?: string;
    parentGuid?: string;
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
    const [expandedKey, setExpandedKey] = useState<string | null>(null);


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
        scrollToGuid(selectedGuid[0])
    }, [selectedGuid]);

    function scrollToGuid(targetGuid: string) {

        const path = findGuidPath(rowData, targetGuid);
        if (!path) return;

        setExpandedRowKeys(path.slice(0, -1)); // 부모들을 펼침

        const rowElement = document.querySelector(`tr[data-row-key="${targetGuid}"]`);
        if (rowElement) {
            rowElement.scrollIntoView({behavior: "smooth", block: "center"});
        }

        // setTimeout(() => {
        //
        // }, 300); // DOM 렌더링 이후 실행
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

    const debouncedSetRowEditValues = useRef(
        debounce((key: string, field: string, value: any) => {
            setRowEditValues(prev => ({
                ...prev,
                [key]: {
                    ...(prev[key] || {}),
                    [field]: value,
                },
            }));
        }, 300) // 300ms 지연
    ).current;

    const handleInputChange = useCallback((key: string, field: string, value: any) => {
        debouncedSetRowEditValues(key, field, value);
    }, []);

    React.useEffect(() => {
        return () => debouncedSetRowEditValues.cancel();
    }, [debouncedSetRowEditValues]);


    const columns = generateColumnsFromData(rowData);
    // const isEditableRow = (guid: string) =>
    //     selectedGuid?.includes(guid);
    const enhancedColumns = columns.map((col) => ({
        ...col,
        render: (value, record) => {

            const guid = record.__guid;
            const currentValue = rowEditValues[guid]?.[col.dataIndex] ?? value;

            const schemes = useSchemeStore.getState().getByRowKeyAndKey(levelName, col.key);

            const handleCommit = (e) => {

                debouncedSetRowEditValues.flush();

                if(rowEditValues[guid]){
                    const merged = {
                        ...record,
                        ...rowEditValues[guid],
                    };

                    const store = layerNameToStoreMap[layerName]
                    const historyStore = layerNameToHistoryStoreMap[layerName];
                    store.getState().updateCurrentJsonData(merged, historyStore);

                    setRowEditValues({})
                }
            };

            if(!schemes){
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
            }

            if (schemes?.readonly) {
                return <span>{String(value)}</span>;
            }


            return schemes?.type === 'number' ? (
                <InputNumber
                    value={currentValue}
                    onChange={(val) =>handleInputChange(guid, col.dataIndex, val)}
                    onBlur={handleCommit}
                    onPressEnter={handleCommit}
                    size="small"
                />
            ) : schemes?.type === 'select' ? (
                <Select
                    value={currentValue}
                    onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                    onBlur={handleCommit}
                    size="small"
                    style={{ width: '100%' }}
                >
                    {schemes?.options?.map((opt) => (
                        <Select.Option key={opt.value ?? opt} value={opt.value ?? opt}>
                            {opt.label ?? opt}
                        </Select.Option>
                    ))}
                </Select>
            ) : schemes?.type === 'boolean' ? (
                    <Checkbox
                        checked={Boolean(currentValue)}
                        value={currentValue}
                        onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                    />
                // <Select
                //     value={currentValue}
                //     onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                //     onBlur={handleCommit}
                //     size="small"
                //     style={{ width: '100%' }}
                // >
                //     {schemes?.options?.map((opt) => (
                //         <Select.Option key={opt.value ?? opt} value={opt.value ?? opt}>
                //             {opt.label ?? opt}
                //         </Select.Option>
                //     ))}
                // </Select>
            ) : (
                <Input
                    value={currentValue}
                    onChange={(e) => {
                        const raw = e.target.value;
                        const val = schemes?.type === 'number' ? Number(raw) : raw;
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
        console.log(parentGuid)
        let newRecord;
        let targetFeatureType = levelName;
        if (!targetFeatureType) {
            if (rowData.length > 0 && rowData[0].featureType) {
                targetFeatureType = rowData[0].featureType;
            } else {
                console.error("새 레코드를 추가할 FeatureType을 알 수 없습니다.");
                alert("새 레코드를 추가할 FeatureType을 알 수 없습니다.");
                return;
            }
        }
        const schemes = useSchemeStore.getState().getByRowKey(levelName);

        const template = schemes.reduce((acc, cur) => {
            acc[cur.key] = "";
            return acc;
        }, {} as Record<string, any>);

        if (typeof layer?.createDto === "function" || template) {
            console.log(template)

            if (template) {
                newRecord = {
                    ...template,
                    featureType: targetFeatureType,
                    id : Date.now(),
                    __guid: generateGUIDWithType(targetFeatureType), // __guid 생성
                    parentGuid : parentGuid
                };
            }else{
                newRecord = layer.createDto(targetFeatureType);
                newRecord.id = Date.now(); // 임시 ID
                newRecord.featureType = targetFeatureType;
                newRecord.__guid = generateGUIDWithType(targetFeatureType); // __guid 생성
                newRecord.parentGuid = parentGuid; // __guid 생성
            }
            store.getState().updateCurrentJsonData(newRecord, historyStore);
            setSelectedGuid([newRecord.__guid]);
            featureTypeEventHandlers(newRecord)
        } else {
            console.error("레이어에 'createDto' 메서드가 정의되어 있지 않습니다.");
            alert("레이어에 'createDto' 메서드가 정의되어 있지 않습니다.");
        }
    }
    const handleDeleteBtn = () => {
        store.getState().removeRecordsByGuid(selectedGuid, historyStore)
    }

    const toggleGrid = (key: string) => {
        setExpandedKey((prevKey) => (prevKey === key ? null : key)); // 같은 key면 닫기
    };

    return (
        <div style={{paddingLeft: depth * 24}}>
            <div style={{ display: "flex", alignItems: "center" }}>
                <h4>{levelName}</h4>
                <button className="grid-btn add-btn" onClick={() => handleAddBtn()}>+</button>
                <button className="grid-btn delete-btn" onClick={() => handleDeleteBtn()}>-</button>
                <h3 style={{ display: depth === 0 ? "block" : "none" }}>
                    <div className="grid-header">
                        <FontAwesomeIcon onClick={() => toggleGrid(levelName)}
                                         icon={expandedKey === levelName ? faChevronDown : faChevronUp}/>
                    </div>
                </h3>
            </div>

            {((expandedKey === levelName) || depth > 0) && (<Table
                className="transparent-table"
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
                scroll={{y: 600}}
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
                                        return (
                                            Array.isArray(record[field]) && record[field].length > 0 ? (
                                                <div key={field}>
                                                    <JsonGrid
                                                        rowData={record[field]}
                                                        levelName={field}
                                                        parentGuid={record['__guid']}
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
            />)}

        </div>
    );
};

export default JsonGrid;
