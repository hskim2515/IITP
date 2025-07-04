import { create } from 'zustand';
import { combine, subscribeWithSelector } from 'zustand/middleware';
import { createSelectors } from './createSelectors';
import { FetchFeatureDataType } from "@type/FeatureOptions";
import { applyDiffs, diffObjects } from "@utils/json";

export interface FeatureStoreFactoryType {
    getState: () => State & Actions;
    setState: (partial: Partial<State & Actions>, replace?: boolean) => void;
}


export interface State {
    // fetch 한 data
    originData: FetchFeatureDataType | undefined
    currentJsonData: unknown
    currentGeojson: unknown

    // fetch data 기반, flatRow로 변환한 데이터
    flatRow: Record<string, unknown>[]
    // 변경 확인
    isChanged: boolean
}

export interface Actions {
    setOriginData: (data: FetchFeatureDataType) => void;
    setCurrentJsonData: (data: unknown) => void;
    setCurrentGeojson: (data: unknown) => void;
    updateCurrentJsonData: (data: Record<string, unknown>) => void,
    removeRecordsByGuid: (guids: (string | number)[]) => void;
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

const createFeatureStore = () =>
    createSelectors(
        create<State & Actions>(
            subscribeWithSelector(
                combine(initialState, (set, get) => ({
                        setOriginData: (data: FetchFeatureDataType) => set({ originData: data }),
                        setCurrentJsonData: (data: unknown) => {
                            set({ currentJsonData: structuredClone(data) });
                        },
                        setCurrentGeojson: (geojson: Record<string, unknown>) => {
                            set({ currentGeojson: { ...geojson } })
                        },
                        updateCurrentJsonData: (record) => {
                            const current = get().currentJsonData as Record<string, any>;
                            const key = record.featureType;

                            if (!key || typeof key !== "string") {
                                console.warn("featureType이 유효하지 않습니다.");
                                console.warn(record)
                                console.warn(key)
                                return;
                            }

                            const items = current[key] ?? [];
                            const index = items.findIndex((item: any) => item.id === record.id);

                            // 신규 추가
                            if (index === -1) {
                                const newItems = [ ...items, record ];
                                set({
                                    currentJsonData: {
                                        ...current,
                                        [key]: newItems,
                                    },
                                    isChanged: true,
                                });
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

                            set({
                                currentJsonData: {
                                    ...current,
                                    [key]: newItems,
                                },
                                isChanged: true,
                            });
                        },
                        removeRecordsByGuid: (guids: (string | number)[]) => {
                            const current = get().currentJsonData as Record<string, any>;
                            if (!current) return;

                            const updated: Record<string, any[]> = {};
                            let hasChanges = false;

                            for (const [ objectName, items ] of Object.entries(current)) {
                                if (!Array.isArray(items)) continue;

                                const filtered = items.filter(item => !guids.includes(item.__guid));
                                if (filtered.length !== items.length) {
                                    hasChanges = true;
                                }
                                updated[objectName] = filtered;
                            }

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
