import { create } from 'zustand';

interface MessageState {
    message: { type: 'info' | 'warn' | 'error'; text: string } | { type: 'confirm'; text: string; onConfirm: () => void; onCancel?: () => void } | null;
    setMessage: (msg: MessageState['message']) => void;
    clearMessage: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
    message: null,
    setMessage: (msg) => set({ message: msg }),
    clearMessage: () => set({ message: null }),
}));
