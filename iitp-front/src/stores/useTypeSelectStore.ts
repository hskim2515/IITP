import { create } from 'zustand';

interface TypeSelectState {
    typeKey: string | null;
    onConfirm: ((type: string) => void) | null;
    open: (typeKey: string, onConfirm: (type: string) => void) => void;
    close: () => void;
}

export const useTypeSelectStore = create<TypeSelectState>((set) => ({
    typeKey: null,
    onConfirm: null,
    open: (typeKey, onConfirm) => set({ typeKey, onConfirm }),
    close: () => set({ typeKey: null, onConfirm: null }),
}));