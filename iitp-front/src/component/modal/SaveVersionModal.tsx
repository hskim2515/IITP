import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { isAxiosError } from 'axios';
import { useScenarioStore } from '@stores/useScenarioStore';
import { ScenarioVersions } from '@type/Scenario';

interface SaveVersionModalProps {
    open: boolean;
    onConfirm: (versionKey: string) => Promise<void>;
    onCancel: () => void;
}

// 현재 편집 중인 버전(currentKey) 기준으로만 "다음 번호"를 매기면, 사용자가 최신 버전이
// 아닌 예전 버전(예: V1)에서 "새 버전으로"를 누를 때 이미 존재하는 V2와 키가 충돌한다.
// 시나리오에 실제로 존재하는 모든 형제 버전 키를 훑어 그중 최댓값+1을 제안해야 안전하다.
function suggestNextVersionKey(scenarioKey: string, existingKeys: string[]): { key: string; num: number } {
    const prefix = `${scenarioKey}_V`;
    let maxN = 0;
    for (const k of existingKeys) {
        if (!k.startsWith(prefix)) continue;
        const n = parseInt(k.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
    }
    return { key: `${prefix}${maxN + 1}`, num: maxN + 1 };
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
        if (!open || !selectedScenario) return;
        setError(null);
        setKeyError(null);
        setLabelError(null);
        // 형제 버전 전체를 조회해 키를 제안 — 현재 편집 중인 버전만 보고 제안하면
        // (예: V1을 보다가 "새 버전으로") 이미 존재하는 V2와 충돌한다.
        axiosInstance.get(`/scenario/${selectedScenario.id}/versions`)
            .then((res) => {
                const existingKeys = (res.data as ScenarioVersions[]).map(v => v.key);
                const { key, num } = suggestNextVersionKey(selectedScenario.key, existingKeys);
                setKeyVal(key);
                setLabelVal(`버전 ${num}`);
            })
            .catch(() => {
                // 형제 목록 조회 실패 시에도 입력은 가능해야 하므로 최소한의 제안으로 폴백
                setKeyVal(suggestNextVersionKey(selectedScenario.key, selectedScenarioVersion?.key ? [selectedScenarioVersion.key] : []).key);
                setLabelVal('버전 2');
            });
        setTimeout(() => keyRef.current?.focus(), 50);
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
        let newVersion: ScenarioVersions | null = null;
        let createdNow = false;
        try {
            try {
                const response = await axiosInstance({
                    method: 'POST',
                    url: `/scenario/${selectedScenario.id}/versions`,
                    data: { key: keyVal, label: labelVal, sourceVersionKey: selectedScenarioVersion?.key ?? null },
                });
                newVersion = response.data;
                createdNow = true;
            } catch (createErr) {
                // 멱등 처리: 이전 저장 시도가 버전 레코드만 만들고 실패하면(유령 버전)
                // 재시도가 중복 키 400 에 영구 차단됨 → 같은 키의 기존 버전을 찾아 재사용.
                // 단, 서버가 명확히 400(키 중복)으로 거절한 경우는 재사용하지 않는다 —
                // 이제 키 제안 자체가 형제 버전을 다 훑으므로, 그런데도 400이 났다면
                // "내 이전 시도의 유령"이 아니라 "이미 다른 버전이 그 키를 쓰고 있다"는
                // 뜻일 가능성이 높다. 그런데도 조용히 그 버전으로 갈아타면 사용자는
                // 아무 새 버전도 생기지 않았는데 "저장은 됐다"고 착각하게 된다
                // (버전 목록에 새 항목이 안 보이는데 에러도 없어 보이는 원인).
                if (isAxiosError(createErr) && createErr.response?.status === 400) throw createErr;
                const listResp = await axiosInstance.get(`/scenario/${selectedScenario.id}/versions`);
                const existing = (listResp.data as ScenarioVersions[]).find(v => v.key === keyVal);
                if (!existing) throw createErr;
                newVersion = existing;
            }
            // ⚠️ 저장이 끝나기 전에 setVersion() 금지 — 활성 버전이 새 키로 바뀌면
            // diff 저장의 baseVersionId(기준 버전) 판별이 무너져 서버가 아직 없는
            // 새 버전에서 로드하려다 404가 난다. 저장 성공 후에만 전환한다.
            await onConfirm(newVersion!.key);
            setVersion(newVersion!);
        } catch (err: unknown) {
            // 이번 시도에서 만든 버전 레코드는 롤백 (유령 버전 방지)
            const rollback = newVersion as ScenarioVersions | null;
            if (rollback && createdNow) {
                try {
                    await axiosInstance.delete(`/scenario/${selectedScenario.id}/versions/${rollback.id}`);
                } catch (_) { /* 롤백 실패 시 멱등 재사용 경로가 처리 */ }
            }
            // 백엔드가 400에 본문을 안 실어 보내므로(ResponseEntity.badRequest().build()),
            // axios의 일반 메시지("Request failed with status code 400") 대신 실제 원인을 안내.
            const message = isAxiosError(err) && err.response?.status === 400
                ? `버전 키 "${keyVal}"이(가) 이미 사용 중입니다. 다른 키를 입력해주세요.`
                : err instanceof Error ? err.message : '버전 생성 실패';
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
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>새 버전으로 저장</span>
                    <button style={closeBtnStyle} onClick={onCancel}>×</button>
                </div>
                <div style={bodyStyle}>
                    <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.4)', margin: '0 0 14px 0', lineHeight: 1.6 }}>
                        저장 시 새 버전이 생성됩니다.
                        {selectedScenarioVersion && (
                            <> 현재 버전: <strong style={{ color: 'var(--text-tertiary)' }}>{selectedScenarioVersion.label}</strong> ({selectedScenarioVersion.key})</>
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
    background: 'rgba(var(--surface-overlay-rgb), 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
};
const panelStyle: React.CSSProperties = {
    background: 'rgba(var(--surface-1-rgb), 0.98)',
    border: '1px solid rgba(var(--overlay-rgb), 0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(var(--surface-overlay-rgb), 0.7)',
    width: 360, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column',
};
const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(var(--overlay-rgb), 0.07)',
};
const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: 'rgba(var(--overlay-rgb), 0.4)',
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
    fontSize: 11, color: 'var(--text-muted)', fontWeight: 500,
};
const inputStyle: React.CSSProperties = {
    background: 'rgba(var(--overlay-rgb), 0.06)',
    border: '1px solid rgba(var(--overlay-rgb), 0.12)',
    borderRadius: 5,
    color: 'var(--text-secondary)',
    fontSize: 12,
    padding: '6px 9px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: "'Segoe UI', sans-serif",
};
const fieldErrorStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--color-danger)',
};
const errorStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(var(--color-danger-rgb), 0.12)', border: '1px solid rgba(var(--color-danger-rgb), 0.3)',
    color: 'var(--color-danger)',
};
const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '10px 16px',
    borderTop: '1px solid rgba(var(--overlay-rgb), 0.07)',
};
const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb), 0.12)',
    background: 'rgba(var(--overlay-rgb), 0.05)',
    color: 'var(--text-tertiary)', cursor: 'pointer',
};
const okBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--accent-rgb), 0.5)',
    background: 'rgba(var(--accent-rgb), 0.2)',
    color: 'var(--accent-text)', cursor: 'pointer', fontWeight: 600,
};

export default SaveVersionModal;
