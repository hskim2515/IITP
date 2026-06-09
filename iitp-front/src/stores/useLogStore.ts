import { create } from 'zustand';

export type LogType = 'info' | 'warn' | 'error';

export interface LogEntry {
    id: number;
    type: LogType;
    text: string;
    timestamp: Date;
}

interface LogState {
    entries: LogEntry[];
    addLog: (type: LogType, text: string) => void;
    clear: () => void;
}

let _id = 0;

export const useLogStore = create<LogState>((set) => ({
    entries: [],
    addLog: (type, text) => set((state) => ({
        entries: [...state.entries.slice(-499), { id: _id++, type, text, timestamp: new Date() }],
    })),
    clear: () => set({ entries: [] }),
}));
