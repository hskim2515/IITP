import { create, StoreApi, UseBoundStore } from 'zustand';
import { combine, subscribeWithSelector } from 'zustand/middleware';
import { createSelectors } from './createSelectors';

import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import { featureUpdateLogs } from "@utils/history";
import {findParentRecordByFeatureType, findParentRecordByGuid} from "@utils/json";
import { diff, applyChange } from 'deep-diff';
import {UpdateLogEntry} from "@type/HistoryTypes";

export type FeatureStoreFactoryType<T> = UseBoundStore<StoreApi<State<T>&Actions<T>>>

export interface State<T> {
    // fetch 한 data
    originData: T | undefined
    currentJsonData: T | undefined
    originHistoryData: T | undefined
    // 변경 확인
    isChanged: boolean
}

export interface Actions<T> {
    setOriginData: (data: T) => void;
    setOriginHistoryData: (data: T) => void;
    setCurrentJsonData: (data: T) => void;
    updateCurrentJsonData: (data: T, historyStore?: ReturnType<typeof useHistoryStoreFactory>) => void;
    removeRecordsByGuid: (guids: (string | number)[], historyStore?: ReturnType<typeof useHistoryStoreFactory>) => void;
    setChange: (changed: boolean) => void;
    initCurrentData: () => void;
}



const createFeatureStore = <T>() => {
    const initialState: State<T> = {
        originData: undefined,
        originHistoryData: undefined,
        currentJsonData: undefined,
        isChanged: false
    };
    return createSelectors(
        create(
            subscribeWithSelector(
                combine(initialState, (set, get) => ({
                        setOriginData: (data: T) => set({originData: data}),
                        setOriginHistoryData: (data: T) => set({originHistoryData: data}),
                        setCurrentJsonData: (data: T) => {
                            set({
                                currentJsonData: structuredClone(data)
                            });
                        },
                        updateCurrentJsonData: (record, historyStore) => {

                            const current = get().currentJsonData;
                            if (!record || typeof record !== "object" || !record.__guid) return;

                            const updatedFlag = {updated: false};

                            function deepUpdateByGuid(obj: any, record: any): any {
                                if (Array.isArray(obj)) {
                                    return obj.map(item => deepUpdateByGuid(item, record));
                                } else if (typeof obj === "object" && obj !== null) {
                                    if (obj.__guid === record.__guid) {
                                        // 객체 간 차이 계산
                                        const differences = diff(obj, record);
                                        if (!differences || differences.length === 0) return obj;

                                        // diff 적용
                                        const updatedItem = { ...obj };
                                        differences.forEach(change => {
                                            applyChange(updatedItem, record, change);
                                        });

                                        updatedFlag.updated = true;

                                        // 변경 로그 기록
                                        if (historyStore) {
                                            for (const change of differences) {
                                                const field = change.path?.join(".") ?? "";
                                                const oldValue = change.lhs;
                                                const newValue = change.rhs;

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

                                    const newObj: Record<string, unknown> = {};
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
                            let container = null;
                            if(record.parentGuid?.length > 0){
                                container = findParentRecordByGuid(updatedJson, record);
                            }else{
                                container = findParentRecordByFeatureType(updatedJson, record);
                            }
                            if (container) {
                                const {parent} = container;
                                parent[record.featureType].push(record);

                                set({
                                    currentJsonData: updatedJson,
                                    isChanged: true,
                                });

                                if (historyStore) {
                                    featureUpdateLogs(historyStore, {
                                        guid: record.__guid,
                                        updateType: "added",
                                        properties: record,
                                    });
                                }

                                return;
                            }

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
                            //const newItems = [...items, record];
                            const newItems = [...items];
                            //const interpolatedRecords = interpolateAndConvertToRecords(newItems);

                            set({
                                currentJsonData: {
                                    ...current,
                                    [key]: newItems,
                                } as T,
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
                        const deletedItems: any[] = [];

                        function deepRemove(obj: any): any {
                            if (Array.isArray(obj)) {
                                const toBeDeleted = obj.filter(
                                    item => typeof item === "object" && item !== null && guids.includes(item.__guid)
                                );
                                const filtered = obj.filter(
                                    item => !(typeof item === "object" && item !== null && guids.includes(item.__guid))
                                );

                                if (toBeDeleted.length > 0) {
                                    hasChanges = true;
                                    deletedItems.push(...toBeDeleted);
                                }

                                return filtered.map(item => deepRemove(item));
                            } else if (typeof obj === "object" && obj !== null) {
                                const newObj: Record<string, any> = {};
                                for (const [key, value] of Object.entries(obj)) {
                                    newObj[key] = deepRemove(value);
                                }
                                return newObj;
                            } else {
                                return obj;
                            }
                        }

                        const updated = deepRemove(current);

                        if (hasChanges) {
                            set({
                                currentJsonData: updated,
                                isChanged: true,
                            });

                            if (historyStore && deletedItems.length > 0) {
                                const timestamp = new Date().toISOString();

                                const batchUpdates: UpdateLogEntry = {
                                    deleted: deletedItems.flatMap(item =>
                                        Object.entries(item).map(([key, value]) => ({
                                            guid: item.__guid,
                                            field: key,
                                            oldValue: value,
                                            newValue: null,
                                            timestamp,
                                        }))
                                    )
                                };

                                historyStore.getState().setUpdateLogs(batchUpdates);
                            }
                        }
                    },
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
}
export default createFeatureStore;
