import { create } from 'zustand';

interface MessageState {
    message: { type: 'info' | 'warn' | 'error'; text: string } | null;
    setMessage: (msg: MessageState['message']) => void;
    clearMessage: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
    message: null,
    setMessage: (msg) => set({ message: msg }),
    clearMessage: () => set({ message: null }),
}));
