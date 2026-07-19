import { create } from 'zustand';
import { useLogStore } from './useLogStore';

type ToastMessage = { type: 'info' | 'warn' | 'error'; text: string };
type ConfirmMessage = { type: 'confirm'; text: string; onConfirm: () => void; onCancel?: () => void };
type AlertMessage  = { type: 'alert';   text: string; onClose: () => void };

export type MessageContent = ToastMessage | ConfirmMessage | AlertMessage;

interface MessageState {
    message: MessageContent | null;
    setMessage: (msg: MessageContent) => void;
    clearMessage: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
    message: null,
    setMessage: (msg) => {
        set({ message: msg });
        if (msg.type === 'info' || msg.type === 'warn' || msg.type === 'error') {
            useLogStore.getState().addLog(msg.type, msg.text);
        }
    },
    clearMessage: () => set({ message: null }),
}));
