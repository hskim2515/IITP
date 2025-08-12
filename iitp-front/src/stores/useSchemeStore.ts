import { create } from "zustand";

interface Scheme {
    id: number;
    rowKey: string;
    layerKey: string;
    key: string;
    readonly: boolean;
    type: string;
    options: any;
}

interface SchemeState {
    schemes: Scheme[];
    setSchemes: (data: Scheme[]) => void;
    getByRowKey: (rowKey: string) => Scheme[];
    getByRowKeyAndKey: (rowKey: string, key: string) => Scheme | undefined;
}

export const useSchemeStore = create<SchemeState>((set, get) => ({
    schemes: [],

    setSchemes: (data) => set({ schemes: data }),

    getByRowKey: (rowKey) => {
        return get().schemes.filter((s) => s.rowKey === rowKey);
    },

    getByRowKeyAndKey: (rowKey, key) => {
        return get().schemes.find((s) => s.rowKey === rowKey && s.key === key);
    },
}));
