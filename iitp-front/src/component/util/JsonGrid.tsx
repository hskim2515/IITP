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
import {useSchemaStore} from "@stores/useSchemaStore";
import debounce from "lodash.debounce";
import {featureTypeEventHandlers} from "@handler/featureTypeEventHandlers";
import { matchesCustomKeyValue } from "@utils/olLayer";
import { useMessageStore } from "@stores/useMessageStore";
import { Field, Schema } from "@type/Schema";
import { useShallow } from "zustand/react/shallow";
import { generateTemplate } from "@utils/schema";


// 중첩 배열로 생성하지 않을 필드 지정
const EXCLUDED_NESTED_FIELDS = ["coordinates"];

function generateColumnsFromSchema(
    data: any[],
    schema: Schema | null,
) {
    if(!schema) return [];
    return schema.fields
        .filter(field => field.status === 'ACTIVE')
        .map(field => {
            // 데이터에서 해당 필드의 고유값 추출 (필터용)
            const uniqueValues = data.length > 0
                ? [...new Set(data.map(item => item[field.name]))]
                    .filter(v => v !== undefined && v !== null)
                : [];

            return {
                title: field.name.charAt(0).toUpperCase() + field.name.slice(1),
                dataIndex: field.name,
                key: field.name,
                filters: getFilters(field, uniqueValues), // 필드 타입에 따른 필터
                onFilter: (value, record) => record[field.name] === value,
                fieldSchema: field,
            };
        });
}

// 필드 타입에 따른 필터 생성
function getFilters(field: Field, uniqueValues: any[]) {
    if (field.inputType === 'checkbox') {
        return [
            { text: 'True', value: true },
            { text: 'False', value: false }
        ];
    }

    if (field.inputType === 'select' && field.options) {
        return field.options.map(option => ({
            text: option.value,
            value: option.value
        }));
    }

    // 기본적으로 데이터의 고유값을 필터로 사용
    return uniqueValues.slice(0, 10).map(val => ({ // 최대 10개로 제한
        text: String(val),
        value: val
    }));
}

// 중첩 배열 필드 감지
function getNestedArrayField(row: any): any[] | null {
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

    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid);
    const selectedGuid = useSelectionStore((state) => state.selectedGuid);
    const clearSelected = useSelectionStore((state) => state.clearSelected);
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
    const [rowEditValues, setRowEditValues] = useState<Record<string, any>>({});
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    const setMessage = useMessageStore.getState().setMessage;
    const store = layerNameToStoreMap[layerName]
    const historyStore = layerNameToHistoryStoreMap[layerName];

    const {
        currentSchema,
        isLoading,
        fetchSchema,
        getSchemaByNames,
    } = useSchemaStore(useShallow((s) => ({
        currentSchema: s.currentSchema,
        isLoading: s.isLoading,
        fetchSchema: s.fetchSchema,
        getSchemaByNames: s.getSchemaByNames,
        getLayerSchemaByLayerName: s.getLayerSchemaByLayerName,
    })));

    useEffect(() => {
        if (!currentSchema && !isLoading) {
            void fetchSchema();
        }
    }, [currentSchema, isLoading, fetchSchema]);

    const olMap = useOpenLayersStore.state.map()

    const layer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => matchesCustomKeyValue(layer, 'layer', layerName));
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


    /** const columns = generateColumnsFromData(rowData);
     const enhancedColumns = columns.map((col) => ({
     ...col,
     render: (value, record) => {

     const guid = record.__guid;
     const currentValue = rowEditValues[guid]?.[col.dataIndex] ?? value;

     const field = useSchemaStore.getState().getFieldByNames(layerName ,levelName, col.key);
     // const field = ''

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

     if(!field){
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

     if (field?.readOnly) {
     return <span>{String(value)}</span>;
     }

     if(field.inputType === 'select') {
     console.log("field:::", field)
     }


     return field?.inputType === 'number' ? (
     <InputNumber
     value={currentValue}
     onChange={(val) =>handleInputChange(guid, col.dataIndex, val)}
     onBlur={handleCommit}
     onPressEnter={handleCommit}
     size="small"
     />
     ) : field?.inputType === 'select' ? (
     <Select
     value={currentValue}
     onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
     onBlur={handleCommit}
     size="small"
     style={{ width: '100%' }}
     options={field.options}
     >
     </Select>
     ) : field?.inputType === 'checkbox' ? (
     <Checkbox
     checked={Boolean(currentValue)}
     value={currentValue}
     onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
     />
     ) : (
     <Input
     value={currentValue}
     onChange={(e) => {
     const raw = e.target.value;
     const val = field?.inputType === 'number' ? Number(raw) : raw;
     handleInputChange(guid, col.dataIndex, val);
     }}
     onBlur={handleCommit}
     onPressEnter={handleCommit}
     size="small"
     />
     );

     },
     }));
     **/
        // 스키마에서 필드 정보 가져오기
    const schema = getSchemaByNames(layerName, levelName);

    const columns = generateColumnsFromSchema(rowData, schema);

    const enhancedColumns = columns.map((col) => ({
        ...col,
        render: (value, record) => {
            const guid = record.__guid;
            const currentValue = rowEditValues[guid]?.[col.dataIndex] ?? value;
            const field = col.fieldSchema; // 스키마에서 가져온 필드 정보 사용

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

            // 스키마가 없는 경우 기존 로직 유지
            if (!field) {
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

            // readonly 처리
            if (field.readOnly) {
                return <span style={{ opacity: 0.6 }}>{String(value)}</span>;
            }

            // nullable 체크 및 렌더링
            const isNullable = field.nullable;
            const displayValue = (!isNullable && (currentValue === null || currentValue === undefined))
                ? ''
                : currentValue;

            // 입력 타입에 따른 렌더링
            switch (field.inputType) {
                case 'number':
                    return (
                        <InputNumber
                            value={displayValue}
                            onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                            onBlur={handleCommit}
                            onPressEnter={handleCommit}
                            size="small"
                            placeholder={!isNullable ? "Required" : ""}
                        />
                    );

                case 'select':
                    return (
                        <Select
                            value={displayValue}
                            onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                            onBlur={handleCommit}
                            size="small"
                            style={{ width: '100%' }}
                            placeholder={!isNullable ? "Required" : "Select..."}
                            allowClear={isNullable}
                            options={field.options?.map(opt => ({
                                label: opt.value,
                                value: opt.value
                            }))}
                        />
                    );

                case 'checkbox':
                    return (
                        <Checkbox
                            checked={Boolean(displayValue)}
                            onChange={(e) => handleInputChange(guid, col.dataIndex, e.target.checked)}
                        />
                    );

                case 'textarea':
                    return (
                        <Input.TextArea
                            value={displayValue}
                            onChange={(e) => handleInputChange(guid, col.dataIndex, e.target.value)}
                            onBlur={handleCommit}
                            size="small"
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            placeholder={!isNullable ? "Required" : ""}
                        />
                    );

                case 'tags':
                    return (
                        <Select
                            mode="tags"
                            value={Array.isArray(displayValue) ? displayValue : []}
                            onChange={(val) => handleInputChange(guid, col.dataIndex, val)}
                            onBlur={handleCommit}
                            size="small"
                            style={{ width: '100%' }}
                            placeholder={!isNullable ? "Required" : "Add tags..."}
                            allowClear={isNullable}
                        />
                    );

                case 'text':
                default:
                    return (
                        <Input
                            value={displayValue}
                            onChange={(e) => handleInputChange(guid, col.dataIndex, e.target.value)}
                            onBlur={handleCommit}
                            onPressEnter={handleCommit}
                            size="small"
                            placeholder={!isNullable ? "Required" : ""}
                        />
                    );
            }
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
                setMessage({
                    type: 'error',
                    text: '새 레코드를 추가할 FeatureType을 알 수 없습니다.',
                });
                return;
            }
        }
        const schema = useSchemaStore.getState().getSchemaByNames(layerName ,levelName);

        const template = generateTemplate(schema)

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
            setMessage({
                type: 'error',
                text: '레이어에 createDto 메서드가 정의되어 있지 않습니다.',
            });
        }
    }
    const handleDeleteBtn = () => {
        store.getState().removeRecordsByGuid(selectedGuid, historyStore)
    }

    const toggleGrid = (key: string | undefined) => {
        if (!key) return;
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
