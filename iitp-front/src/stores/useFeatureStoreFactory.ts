import { create } from 'zustand';
import { combine, subscribeWithSelector } from 'zustand/middleware';
import { createSelectors } from './createSelectors';
import { FetchFeatureDataType } from "@type/FeatureOptions";
import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import { featureUpdateLogs, getValueAtPath } from "@utils/history";
import { convertFeatureToRecord, createFeature } from "@utils/feature";
import { interpolateAndConvertToRecords, interpolateByOffset } from "@utils/interpolateByOffset";
import { Feature } from "ol";
import { applyDiffs, diffObjects, findParentRecordByFeatureType, findParentObjectOfGuid } from "@utils/json";

export interface FeatureStoreFactoryType {
    getState: () => State & Actions;
    setState: (partial: Partial<State & Actions>, replace?: boolean) => void;
}


export interface State<T = unknown> {
    // fetch 한 data
    originData: FetchFeatureDataType<T> | undefined
    currentJsonData: T
    currentGeojson: unknown

    // fetch data 기반, flatRow로 변환한 데이터
    flatRow: Record<string, unknown>[]
    // 변경 확인
    isChanged: boolean
}

export interface Actions<T = unknown> {
    setOriginData: (data: FetchFeatureDataType<T>) => void;
    setCurrentJsonData: (data: FetchFeatureDataType<T>) => void;
    setCurrentGeojson: (data: unknown) => void;
    updateCurrentJsonData: (data: FetchFeatureDataType<T>, historyStore?: ReturnType<typeof useHistoryStoreFactory>) => void;
    removeRecordsByGuid: (guids: (string | number)[], historyStore?: ReturnType<typeof useHistoryStoreFactory>) => void;
    setFlatRow: (flatRow: Record<string, unknown>[]) => void;
    setChange: () => boolean;
    initCurrentData: () => void;
}

const initialState: State = {
    originData: undefined,
    currentJsonData: undefined,
    flatRow: [],
    isChanged: false
};

const createFeatureStore = <T>() =>
    createSelectors(
        create<State<T> & Actions<T>>(
            subscribeWithSelector(
                combine(initialState, (set, get) => ({
                        setOriginData: (data: FetchFeatureDataType<T>) => set({originData: data}),
                        setCurrentJsonData: (data: FetchFeatureDataType<T>) => {
                            set({currentJsonData: structuredClone(data)});
                        },
                        setCurrentGeojson: (geojson: Record<string, unknown>) => {
                            set({currentGeojson: {...geojson}})
                        },
                        updateCurrentJsonData: (record, historyStore) => {
                            function getValueAtPath(obj: any, path: string[]) {
                                return path.reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
                            }

                            const current = get().currentJsonData;
                            if (!record || typeof record !== "object" || !record.__guid) return;

                            const featureId = record.__guid;
                            const updatedFlag = {updated: false};

                            function deepUpdateByGuid(obj: any, record: any): any {
                                if (Array.isArray(obj)) {
                                    return obj.map(item => deepUpdateByGuid(item, record));
                                } else if (typeof obj === "object" && obj !== null) {
                                    if (obj.__guid === record.__guid) {
                                        const diffs = diffObjects(obj, record);
                                        if (diffs.length === 0) return obj;

                                        const updatedItem = applyDiffs(obj, diffs);
                                        updatedFlag.updated = true;

                                        if (historyStore) {
                                            for (const diff of diffs) {
                                                const field = diff.path.join(".");
                                                const oldValue = getValueAtPath(obj, diff.path);
                                                const newValue = diff.value;

                                                featureUpdateLogs(historyStore, {
                                                    guid: record.__guid,
                                                    updateType: "modified",
                                                    field,
                                                    oldValue,
                                                    newValue,
                                                });
                                            }
                                        }

                                        return updatedItem;
                                    }

                                    const newObj: Record<string, any> = {};
                                    for (const [key, value] of Object.entries(obj)) {
                                        newObj[key] = deepUpdateByGuid(value, record);
                                    }
                                    return newObj;
                                }

                                return obj;
                            }

                            const cloned = structuredClone(current);
                            let updatedJson = deepUpdateByGuid(cloned, record);

                            if (updatedFlag.updated) {
                                set({currentJsonData: updatedJson, isChanged: true});
                                return;
                            }

                            // 구조 기반 부모 찾기
                            const container = findParentRecordByFeatureType(updatedJson, record);
                            if (container) {
                                const {parent, key} = container;
                                parent[key].push(record);

                                set({
                                    currentJsonData: updatedJson,
                                    isChanged: true,
                                });

                                if (historyStore) {
                                    featureUpdateLogs(historyStore, {
                                        guid: record.id,
                                        updateType: "added",
                                        properties: record,
                                    });
                                }

                                return;
                            }
                            // const items = current[key] ?? [];
                            // const index = items.findIndex((item: any) => item.id === record.id);
                            // const featureId = record.id;
                            // // 신규 추가
                            // if (index === -1) {
                            //     const newItems = [ ...items, record ];
                            //     const interpolatedRecords = interpolateAndConvertToRecords(newItems);
                            //
                            //     set({
                            //         currentJsonData: {
                            //             ...current,
                            //             [key]: interpolatedRecords,
                            //         },
                            //         isChanged: true,
                            //     });
                            //
                            //     if (historyStore) {
                            //         featureUpdateLogs(historyStore, {
                            //             featureId,
                            //             updateType: "added",
                            //             properties: record,
                            //         });
                            //     }
                            //     return;
                            // }

                            // fallback: 루트 삽입
                            const key = record.featureType;
                            if (!key || typeof key !== "string") {
                                console.warn("featureType이 유효하지 않음", record);
                                return;
                            }

                            const items = current[key] ?? [];

                            if (items.some(item => item?.__guid === record.__guid)) {
                                console.warn("이미 같은 guid가 존재함. 삽입 생략:", record.__guid);
                                return;
                            }
                            // // 변경 적용
                             const updatedItem = applyDiffs(existing, diffs);
                             console.log("updateCurrentJsonData updatedItem:::", updatedItem)
                            //const newItems = [...items, record];
                             const newItems = [ ...items ];
                            //const interpolatedRecords = interpolateAndConvertToRecords(newItems);



                            set({
                                currentJsonData: {
                                    ...current,
                                    [key]: newItems,
                                },
                                isChanged: true,
                            });

                            if (historyStore) {
                                featureUpdateLogs(historyStore, {
                                    guid: record.__guid,
                                    updateType: "added",
                                    properties: record,
                                });
                            }
                        },

                        removeRecordsByGuid: (guids: (string | number)[], historyStore) => {
                            const current = get().currentJsonData as Record<string, any>;
                            if (!current) return;

                            let hasChanges = false;

                            function deepRemove(obj: any): any {
                                if (Array.isArray(obj)) {
                                    const result = [];
                                    for (const item of obj) {
                                        if (typeof item === "object" && item !== null && "__guid" in item) {
                                            if (guids.includes(item.__guid)) {
                                                hasChanges = true;

                                                const toBeDeleted = obj.filter(item => guids.includes(item.__guid));
                                                const filtered = obj.filter(item => !guids.includes(item.__guid));

                                                if (filtered.length !== obj.length) {
                                                    hasChanges = true;

                                                    // 삭제 이력 기록
                                                    if (historyStore) {
                                                        toBeDeleted.forEach(item => {
                                                            const guid = item.__guid;
                                                            const properties = item;

                                                            if (guid && properties) {
                                                                featureUpdateLogs(historyStore, {
                                                                    guid,
                                                                    updateType: "deleted",
                                                                    properties,
                                                                });
                                                            }
                                                        });
                                                    }
                                                }
                                                continue; // 삭제
                                            }
                                        }
                                        result.push(deepRemove(item));
                                    }
                                    return result;
                                } else if (typeof obj === "object" && obj !== null) {
                                    const newObj: Record<string, any> = {};
                                    for (const [key, value] of Object.entries(obj)) {
                                        newObj[key] = deepRemove(value);
                                    }
                                    return newObj;
                                } else {
                                    return obj; // primitive
                                }
                            }

                            const updated = deepRemove(current);

                            if (hasChanges) {
                                set({
                                    currentJsonData: updated,
                                    isChanged: true,
                                });
                            }
                        },

                        setFlatRow: (flatRow: Record<string, unknown>[]) => set({flatRow: flatRow}),
                        setChange: (changed: boolean) => set({isChanged: changed}),
                        initCurrentData: () => {
                            if (origin) set({
                                currentJsonData: get().originData,
                            });
                        }
                    })
                )
            )
        )
    );

export default createFeatureStore;
