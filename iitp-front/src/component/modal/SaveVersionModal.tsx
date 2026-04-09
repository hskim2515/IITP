import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { ScenarioVersions } from '@type/Scenario';

interface SaveVersionModalProps {
    open: boolean;
    onConfirm: (versionKey: string) => Promise<void>;
    onCancel: () => void;
}

function suggestNextVersionKey(currentKey: string | undefined | null, scenarioKey: string): string {
    if (!currentKey) return `${scenarioKey}_V1`;
    const match = currentKey.match(/^(.+?)_V(\d+)$/);
    if (match) {
        return `${match[1]!}_V${parseInt(match[2]!, 10) + 1}`;
    }
    return `${currentKey}_V2`;
}

const SaveVersionModal: React.FC<SaveVersionModalProps> = ({ open, onConfirm, onCancel }) => {
    const [keyVal, setKeyVal] = useState('');
    const [labelVal, setLabelVal] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [keyError, setKeyError] = useState<string | null>(null);
    const [labelError, setLabelError] = useState<string | null>(null);
    const keyRef = useRef<HTMLInputElement>(null);

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const selectedScenarioVersion = useScenarioStore.getState().selectedScenarioVersion;
    const setVersion = useScenarioStore.getState().setVersion;

    useEffect(() => {
        if (open && selectedScenario) {
            const suggestedKey = suggestNextVersionKey(selectedScenarioVersion?.key, selectedScenario.key);
            const versionCount = selectedScenarioVersion?.label?.match(/\d+/)?.[0];
            const nextNum = versionCount ? parseInt(versionCount, 10) + 1 : 2;
            setKeyVal(suggestedKey);
            setLabelVal(`버전 ${nextNum}`);
            setError(null);
            setKeyError(null);
            setLabelError(null);
            setTimeout(() => keyRef.current?.focus(), 50);
        }
    }, [open]);

    if (!open) return null;

    const validate = () => {
        let ok = true;
        if (!keyVal.trim()) { setKeyError('버전 키를 입력하세요.'); ok = false; }
        else if (!/^[A-Za-z0-9_]+$/.test(keyVal)) { setKeyError('영문자, 숫자, 밑줄(_)만 허용됩니다.'); ok = false; }
        else setKeyError(null);
        if (!labelVal.trim()) { setLabelError('버전 이름을 입력하세요.'); ok = false; }
        else setLabelError(null);
        return ok;
    };

    const handleOk = async () => {
        if (!validate() || !selectedScenario) return;
        setSaving(true);
        setError(null);
        try {
            const response = await axiosInstance({
                method: 'POST',
                url: `/scenario/${selectedScenario.id}/versions`,
                data: { key: keyVal, label: labelVal },
            });
            const newVersion: ScenarioVersions = response.data;
            setVersion(newVersion);
            await onConfirm(newVersion.key);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '버전 생성 실패';
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleOk();
        if (e.key === 'Escape') onCancel();
    };

    return (
        <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onCancel()}>
            <div style={panelStyle} onKeyDown={handleKeyDown}>
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>새 버전으로 저장</span>
                    <button style={closeBtnStyle} onClick={onCancel}>×</button>
                </div>
                <div style={bodyStyle}>
                    <p style={{ fontSize: 12, color: '#777', margin: '0 0 14px 0', lineHeight: 1.6 }}>
                        저장 시 새 버전이 생성됩니다.
                        {selectedScenarioVersion && (
                            <> 현재 버전: <strong style={{ color: '#aaa' }}>{selectedScenarioVersion.label}</strong> ({selectedScenarioVersion.key})</>
                        )}
                    </p>

                    <div style={fieldWrapStyle}>
                        <label style={labelStyle}>버전 키</label>
                        <input
                            ref={keyRef}
                            style={inputStyle}
                            value={keyVal}
                            onChange={(e) => setKeyVal(e.target.value)}
                            placeholder="예: SCENARIO_V2"
                        />
                        {keyError && <span style={fieldErrorStyle}>{keyError}</span>}
                    </div>

                    <div style={fieldWrapStyle}>
                        <label style={labelStyle}>버전 이름</label>
                        <input
                            style={inputStyle}
                            value={labelVal}
                            onChange={(e) => setLabelVal(e.target.value)}
                            placeholder="예: 버전 2"
                        />
                        {labelError && <span style={fieldErrorStyle}>{labelError}</span>}
                    </div>

                    {error && <div style={errorStyle}>{error}</div>}
                </div>
                <div style={footerStyle}>
                    <button style={cancelBtnStyle} onClick={onCancel} disabled={saving}>취소</button>
                    <button style={okBtnStyle} onClick={handleOk} disabled={saving}>
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
};
const panelStyle: React.CSSProperties = {
    background: 'rgba(14,16,28,0.98)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    width: 360, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column',
};
const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
};
const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#666',
    fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
};
const bodyStyle: React.CSSProperties = {
    padding: '16px',
    display: 'flex', flexDirection: 'column', gap: 12,
};
const fieldWrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
};
const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#888', fontWeight: 500,
};
const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    color: '#c8ccd4',
    fontSize: 12,
    padding: '6px 9px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: "'Segoe UI', sans-serif",
};
const fieldErrorStyle: React.CSSProperties = {
    fontSize: 11, color: '#f07070',
};
const errorStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.3)',
    color: '#f07070',
};
const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '10px 16px',
    borderTop: '1px solid rgba(255,255,255,0.07)',
};
const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#aaa', cursor: 'pointer',
};
const okBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(65,105,225,0.5)',
    background: 'rgba(65,105,225,0.2)',
    color: '#7aa2ff', cursor: 'pointer', fontWeight: 600,
};

export default SaveVersionModal;
