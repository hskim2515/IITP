import React, { useEffect } from 'react';
import { useMessageStore } from '@stores/useMessageStore';

export function MessagePopup() {
    const message = useMessageStore((state) => state.message);
    const clearMessage = useMessageStore((state) => state.clearMessage);

    useEffect(() => {
        if (!message || message.type === 'confirm') return;

        const timer = setTimeout(() => {
            clearMessage();
        }, 2000);

        return () => clearTimeout(timer);
    }, [message, clearMessage]);

    if (!message) return null;

    if (message.type === 'confirm') {
        return (
            <div className={`messagePopup ${message.type}`}>
                <p>{message.text}</p>
                <div className="buttons">
                    <button
                        onClick={() => {
                            message.onConfirm();
                            clearMessage();
                        }}
                    >
                        확인
                    </button>
                    <button
                        onClick={() => {
                            message.onCancel?.();
                            clearMessage();
                        }}
                    >
                        취소
                    </button>
                </div>
            </div>
        );
    }

    // info/warn/error
    return (
        <div className={`messagePopup ${message.type}`}>
            {message.text}
        </div>
    );
}
