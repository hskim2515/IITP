import React, { useEffect } from 'react';
import { useMessageStore } from '@stores/useMessageStore';

export function MessagePopup() {
    const message = useMessageStore((state) => state.message);
    const clearMessage = useMessageStore((state) => state.clearMessage);

    useEffect(() => {
        if (!message) return;

        const timer = setTimeout(() => {
            clearMessage();
        }, 2000);

        return () => clearTimeout(timer);
    }, [message, clearMessage]);

    if (!message) return null;

    return (
        <div className={`messagePopup ${message.type}`}>
            {message.text}
        </div>
    );
}
