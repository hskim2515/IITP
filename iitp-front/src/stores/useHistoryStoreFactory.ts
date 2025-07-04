import {create} from 'zustand';
import {combine, subscribeWithSelector} from 'zustand/middleware';
import {createSelectors} from './createSelectors';

export type UpdateType = 'added' | 'modified' | 'deleted';

export interface FieldChange {
    featureId: string | number;
    field: string;
    oldValue: any;
    newValue: any;
}

interface UpdateLogItem {
    versionId: string;
    timestamp: string;
    json: UpdateLogEntry;
}

export type UpdateLogEntry = {
    [key in UpdateType]?: FieldChange[];
};

export interface HistoryStoreFactoryType {
    getState: () => State & Actions;
    setState: (partial: Partial<State & Actions>, replace?: boolean) => void;
}

export interface FetchHistoryDataType {
    id: string | number;
    json: Record<string, unknown>
    name: string;
}

export interface State {
    originHistoryData: FetchHistoryDataType | undefined
    currentIndex: number;

    updateLogs: [],
}

export interface Actions {
    setOriginHistoryData: (data: FetchHistoryDataType) => void;
    initCurrentHistoryData: () => void;

    applyStep: (index: number) => UpdateLogEntry | null;
    undo: () => UpdateLogEntry | null;
    redo: () => UpdateLogEntry | null;

    addFieldUpdate: (updateLogs: string, updateJson: JSON) => void;
    resetAllUpdates: () => void;
}

const initialState: State = {
    originHistoryData: undefined,
    currentIndex: 0
};

const createHistoryStore = () =>
    createSelectors(
        create<State & Actions>(
            subscribeWithSelector(
                combine(initialState, (set, get) => ({
                    setOriginHistoryData: (data: FetchHistoryDataType) => set({ originHistoryData: data }),

                    undo: () => {
                        const logs = get().updateLogs;
                        const idx = get().currentIndex;

                        if (!logs || idx >= logs.length) {
                            alert("되돌릴 수 있는 작업이 없습니다.");
                            return null;
                        }

                        const logIndex = logs.length - 1 - idx;

                        set({ currentIndex: idx + 1 });
                        return logs[logIndex];
                    },
                    redo: () => {
                        const logs = get().updateLogs;
                        const idx = get().currentIndex;

                        if (!logs || idx <= 0) {
                            alert("앞으로 돌릴 수 있는 작업이 없습니다.");
                            return null;
                        }

                        const newIndex = idx - 1;
                        const logIndex = logs.length - 1 - newIndex;

                        set({ currentIndex: newIndex });
                        return logs[logIndex];
                    },

                    // addFieldUpdate: (versionId: string, updateJson: UpdateLogEntry ) => {
                    //     const prev = get().updateLogs ?? [];
                    //     const newLog: updateLogs = {
                    //         versionId,
                    //         timestamp: new Date().toISOString(),
                    //         json: updateJson,
                    //     };
                    //     //set({ updateLogs: [...prev, newLog] });
                    //     set({ updateLogs: [...prev, newLog] });
                    // },
                    addFieldUpdate: (versionId, updateJson) => {
                        let prevLogs = get().updateLogs;
                        if (!Array.isArray(prevLogs)) prevLogs = [];

                        let idx = get().currentIndex;

                        // Undo 상태라면 redo 로그 삭제
                        if (idx > 0) {
                            prevLogs = prevLogs.slice(0, prevLogs.length - idx);
                            idx = 0;
                            set({ currentIndex: 0 });
                        }

                        const newLog: UpdateLogItem = {
                            versionId,
                            timestamp: new Date().toISOString(),
                            json: updateJson,
                        };

                        set({
                            updateLogs: [...prevLogs, newLog],
                            currentIndex: idx,
                        });
                    },
                    resetAllUpdates: () => set({ updateLogs: [] }),

                }))
            ))
    );

export default createHistoryStore;
