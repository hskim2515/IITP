import React, { useEffect } from 'react';
import { useMessageStore } from '@stores/useMessageStore';

export function MessagePopup() {
    const message = useMessageStore((state) => state.message);
    const clearMessage = useMessageStore((state) => state.clearMessage);

    // info/warn/error: 2초 후 자동 닫기
    useEffect(() => {
        if (!message || message.type === 'confirm' || message.type === 'alert') return;
        const timer = setTimeout(clearMessage, 2000);
        return () => clearTimeout(timer);
    }, [message, clearMessage]);

    if (!message) return null;

    // ── 토스트 (info / warn / error) ────────────────────────────────────
    if (message.type === 'info' || message.type === 'warn' || message.type === 'error') {
        return (
            <div className={`messagePopup ${message.type}`}>
                {message.text}
            </div>
        );
    }

    // ── 모달 (confirm / alert) ──────────────────────────────────────────
    const isConfirm = message.type === 'confirm';

    const handleConfirm = () => {
        if (message.type === 'confirm') message.onConfirm();
        else if (message.type === 'alert') message.onClose();
        clearMessage();
    };

    const handleCancel = () => {
        if (message.type === 'confirm') message.onCancel?.();
        clearMessage();
    };

    return (
        <div style={overlayStyle}>
            <div style={dialogStyle}>
                <p style={textStyle}>{message.text}</p>
                <div style={footerStyle}>
                    {isConfirm && (
                        <button style={cancelBtnStyle} onClick={handleCancel}>
                            취소
                        </button>
                    )}
                    <button style={confirmBtnStyle} onClick={handleConfirm}>
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(var(--surface-overlay-rgb), 0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000,
};

const dialogStyle: React.CSSProperties = {
    background: 'rgba(var(--surface-popover-rgb), 0.98)',
    border: '1px solid rgba(var(--overlay-rgb), 0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(var(--surface-overlay-rgb), 0.7)',
    padding: '24px 28px',
    minWidth: 300, maxWidth: 440,
    display: 'flex', flexDirection: 'column', gap: 16,
};

const textStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--text-secondary)', margin: 0,
    lineHeight: 1.7, whiteSpace: 'pre-wrap',
};

const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
};

const confirmBtnStyle: React.CSSProperties = {
    padding: '6px 18px', fontSize: 12, borderRadius: 5, fontWeight: 600,
    border: '1px solid rgba(var(--accent-rgb), 0.5)', background: 'rgba(var(--accent-rgb), 0.2)',
    color: 'var(--accent-text)', cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb), 0.12)', background: 'rgba(var(--overlay-rgb), 0.05)',
    color: 'var(--text-muted)', cursor: 'pointer',
};
