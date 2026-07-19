import { useMessageStore } from '@stores/useMessageStore';

export function showAlert(text: string): Promise<void> {
    return new Promise((resolve) => {
        useMessageStore.getState().setMessage({
            type: 'alert',
            text,
            onClose: resolve,
        });
    });
}

export function showConfirm(text: string): Promise<boolean> {
    return new Promise((resolve) => {
        useMessageStore.getState().setMessage({
            type: 'confirm',
            text,
            onConfirm: () => resolve(true),
            onCancel:  () => resolve(false),
        });
    });
}
