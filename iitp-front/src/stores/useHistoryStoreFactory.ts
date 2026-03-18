import {create} from 'zustand';
import {subscribeWithSelector} from 'zustand/middleware';
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
    currentIndex: number | null;
    currentSnapshotIndex: number | null;
    snapshotUpdateLogs: UpdateLogItem[],
    updateLogs: UpdateLogItem[],
    undoStack: UpdateLogItem[],
    redoStack: UpdateLogItem[],
}

export interface Actions {
    setOriginHistoryData: (data: FetchHistoryDataType) => void;
    undo: () => UpdateLogEntry | null;
    redo: () => UpdateLogEntry | null;
    setUpdateLogs: (updateJson: UpdateLogEntry) => void;
    setSnapshotUpdateLogs: (updateJson: UpdateLogEntry) => void;
    resetUpdateLogs: () => void;
    resetUndoStack: () => void;
    resetRedoStack: () => void;
    resetAllHistoryStack: () => void;
    resetSnapshotUpdateLogs: () => void;
    setCurrentIndex: (index:number) => void;
    setCurrentSnapshotIndex: (index:number) => void;
}

const initialState: State = {
    originHistoryData: undefined,
    currentIndex: null,
    currentSnapshotIndex: null,
    snapshotUpdateLogs: [],
    updateLogs: [],
    undoStack: [],
    redoStack: [],
};

const createHistoryStore = () =>
        create<State & Actions>()(
            subscribeWithSelector(
                (set, get) => ({
                    ...initialState,
                    setOriginHistoryData: (data: FetchHistoryDataType) => set({ originHistoryData: data }),

                    undo: () => {
                        const undoStack = [...get().undoStack];
                        if (!undoStack.length) {
                            setMessage({
                                type: 'warn',
                                text: "되돌릴 수 있는 작업이 없습니다.",
                            });
                            return null;
                        }

                        const last = undoStack.pop()!;

                        // updateLogs에서 제거
                        const newUpdateLogs = get().updateLogs.filter(log => log.timestamp !== last.timestamp);

                        set({
                            undoStack,
                            redoStack: [...get().redoStack, last],
                            updateLogs: newUpdateLogs,
                        });

                        console.log("[UNDO] undoStack:", get().undoStack);
                        console.log("[UNDO] redoStack:", get().redoStack);
                        console.log("[UNDO] updateLogs:", get().updateLogs);

                        return last.json;
                    },

                    redo: () => {
                        const redoStack = [...get().redoStack];
                        if (!redoStack.length) {
                            setMessage({
                                type: 'warn',
                                text: "앞으로 되돌릴 수 있는 작업이 없습니다.",
                            });
                            return null;
                        }

                        const last = redoStack.pop()!;

                        // updateLogs에 다시 추가
                        const newUpdateLogs = [...get().updateLogs, last];

                        set({
                            redoStack,
                            undoStack: [...get().undoStack, last],
                            updateLogs: newUpdateLogs,
                        });

                        console.log("[REDO] undoStack:", get().undoStack);
                        console.log("[REDO] redoStack:", get().redoStack);
                        console.log("[REDO] updateLogs:", get().updateLogs);

                        return last.json;
                    },

                    // setUpdateLogs: (updateJson) => {
                    //     const newLog: UpdateLogItem = { timestamp: new Date().toISOString(), json: updateJson };
                    //     set({
                    //         updateLogs: [...get().updateLogs, newLog],
                    //         undoStack: [...get().undoStack, newLog],
                    //         redoStack: [],
                    //     });
                    // },

                    setUpdateLogs: (updateJsonOrArray) => {
                        const timestamp = new Date().toISOString();

                        const newLog: UpdateLogItem = {
                            timestamp,
                            json: updateJsonOrArray
                        };

                        set({
                            updateLogs: [...get().updateLogs, newLog],
                            undoStack: [...get().undoStack, newLog],
                            redoStack: [],
                        });
                    },

                    setSnapshotUpdateLogs: (updateJson) => {
                        const newLog: UpdateLogItem = { timestamp: new Date().toISOString(), json: updateJson };
                        set({
                            snapshotUpdateLogs: [...get().snapshotUpdateLogs, newLog],
                        });
                    },

                    resetUpdateLogs: () => set({ updateLogs: [] }),
                    resetUndoStack: () => set({ undoStack: [] }),
                    resetRedoStack: () => set({ redoStack: [] }),
                    resetAllHistoryStack: () => set({updateLogs: [], undoStack: [], redoStack: []}),
                    resetSnapshotUpdateLogs: () => set({ snapshotUpdateLogs: [] }),
                    setCurrentIndex: (index:number) => set({ currentIndex: index}),
                    setCurrentSnapshotIndex: (index:number) => set({ currentSnapshotIndex: index})

                }))
    );

export default createHistoryStore;
