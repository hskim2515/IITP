import { create } from 'zustand';
import { combine, subscribeWithSelector } from 'zustand/middleware';
import { createSelectors } from './createSelectors';
import { FetchFeatureDataType } from "@type/FeatureOptions";
import { applyDiffs, diffObjects } from "@utils/json";
import useHistoryStoreFactory from "@stores/useHistoryStoreFactory";
import {featureUpdateLogs, getValueAtPath} from "@utils/history";
import {convertFeatureToRecord, createFeature} from "@utils/feature";
import {interpolateAndConvertToRecords, interpolateByOffset} from "@utils/interpolateByOffset";
import {Feature} from "ol";

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
                        setOriginData: (data: FetchFeatureDataType<T>) => set({ originData: data }),
                        setCurrentJsonData: (data: FetchFeatureDataType<T>) => {
                            set({ currentJsonData: structuredClone(data) });
                        },
                        setCurrentGeojson: (geojson: Record<string, unknown>) => {
                            set({ currentGeojson: { ...geojson } })
                        },
                        updateCurrentJsonData: (record, historyStore) => {
                            const current = get().currentJsonData;
                            const key = record.featureType;

                            if (!key || typeof key !== "string") {
                                console.warn("featureType이 유효하지 않습니다.");
                                console.warn(record)
                                console.warn(key)
                                return;
                            }

                            const items = current[key] ?? [];
                            const index = items.findIndex((item: any) => item.id === record.id);
                            const featureId = record.id;

                            // 신규 추가
                            if (index === -1) {
                                const newItems = [ ...items, record ];
                                const interpolatedRecords = interpolateAndConvertToRecords(newItems);

                                set({
                                    currentJsonData: {
                                        ...current,
                                        [key]: interpolatedRecords,
                                    },
                                    isChanged: true,
                                });

                                if (historyStore) {
                                    featureUpdateLogs(historyStore, {
                                        featureId,
                                        updateType: "added",
                                        properties: record,
                                    });
                                }
                                return;
                            }

                            const existing = items[index];
                            console.log("updateCurrentJsonData existing:::", existing)
                            // 변경된 속성 추출
                            const diffs = diffObjects(existing, record);
                            console.log("updateCurrentJsonData diffs:::", diffs)
                            if (diffs.length === 0) {
                                console.log("변경된 속성이 없음. 상태 업데이트 생략");
                                return;
                            }

                            // 변경 적용
                            const updatedItem = applyDiffs(existing, diffs);
                            console.log("updateCurrentJsonData updatedItem:::", updatedItem)
                            const newItems = [ ...items ];
                            console.log("updateCurrentJsonData newItems:::", newItems)
                            newItems[index] = updatedItem;

                            const interpolatedRecords = interpolateAndConvertToRecords(newItems);

                            set({
                                currentJsonData: {
                                    ...current,
                                    [key]: interpolatedRecords,
                                },
                                isChanged: true,
                            });
                            if (historyStore) {
                                for (const diff of diffs) {
                                    const field = diff.path.join(".");
                                    const oldValue = getValueAtPath(existing, diff.path);
                                    const newValue = diff.value;

                                    featureUpdateLogs(historyStore, {
                                        featureId,
                                        updateType: "modified",
                                        field,
                                        oldValue,
                                        newValue,
                                    });
                                }
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
                                                        const featureId = item.id;
                                                        const properties = item;

                                                        if (featureId && properties) {
                                                            featureUpdateLogs(historyStore, {
                                                                featureId,
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


                        setFlatRow: (flatRow: Record<string, unknown>[]) => set({ flatRow: flatRow }),
                        setChange: (changed: boolean) => set({ isChanged: changed }),
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
