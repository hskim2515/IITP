import {create} from 'zustand';
import {combine, subscribeWithSelector} from 'zustand/middleware';
import {createSelectors} from './createSelectors';
import {UpdateLogEntry, UpdateLogItem} from "@type/HistoryTypes";
import {useMessageStore} from "@stores/useMessageStore";
const setMessage = useMessageStore.getState().setMessage;



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

    undo: () => UpdateLogEntry | null;
    redo: () => UpdateLogEntry | null;

    addFieldUpdate: (updateJson: JSON) => void;
    resetAllUpdates: () => void;
}

const initialState: State = {
    originHistoryData: undefined,
    currentIndex: 0,
    updateLogs: [],
};

const createHistoryStore = () =>
        create<State & Actions>()(
            subscribeWithSelector(
                (set, get) => ({
                    ...initialState,
                    setOriginHistoryData: (data: FetchHistoryDataType) => set({ originHistoryData: data }),

                    undo: () => {
                        const logs = get().updateLogs;
                        const idx = get().currentIndex;

                        if (!logs || idx >= logs.length) {
                            setMessage({
                                type: 'warn',
                                text: "되돌릴 수 있는 작업이 없습니다.",
                            });
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
                            setMessage({
                                type: 'warn',
                                text: "앞으로 돌릴 수 있는 작업이 없습니다.",
                            });
                            return null;
                        }

                        const newIndex = idx - 1;
                        const logIndex = logs.length - 1 - newIndex;

                        set({ currentIndex: newIndex });
                        return logs[logIndex];
                    },

                    addFieldUpdate: (updateJson) => {
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
                            timestamp: new Date().toISOString(),
                            json: updateJson,
                        };

                        set({
                            updateLogs: [...prevLogs, newLog],
                            currentIndex: idx,
                        });
                    },
                    resetAllUpdates: () => set({ updateLogs: [] }),

                })
            )
    );

export default createHistoryStore;
