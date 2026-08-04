import React, { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { assignPropertyToResponseData } from '@utils/guid';

const MENU_CODE = 'AUTO_NETWORK';

const AutoNetworkModal: React.FC = () => {
    const closeSession = useWorkflowStore((s: any) => s.closeSession) as (code: string) => void;
    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();

    // bbox 좌표
    const [south, setSouth] = useState('');
    const [west,  setWest]  = useState('');
    const [north, setNorth] = useState('');
    const [east,  setEast]  = useState('');

    // VWorld API key (env 우선)
    const envApiKey = process.env.REACT_APP_VWORLD_API_KEY ?? '';
    const [apiKey, setApiKey] = useState(envApiKey);

    // KTDB ZIP (선택)
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [ktdbFile, setKtdbFile] = useState<File | null>(null);

    // 고급 파라미터 (접힘)
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [grayTolerance, setGrayTolerance] = useState(25);
    const [brightnessMin, setBrightnessMin] = useState(55);
    const [brightnessMax, setBrightnessMax] = useState(210);
    const [minRoadArea,   setMinRoadArea]   = useState(300);
    const [minSegmentPx,  setMinSegmentPx]  = useState(10);

    // 상태
    const [loading,     setLoading]     = useState(false);
    const [progress,    setProgress]    = useState('');
    const [error,       setError]       = useState<string | null>(null);
    const [pendingData, setPendingData] = useState<any>(null);
    const [stats,       setStats]       = useState<any>(null);

    // bbox가 지도 선택으로 채워지면 입력란에 반영
    useEffect(() => {
        if (!bbox) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox]);

    const handleClose = () => {
        setSelecting(false);
        setBbox(null);
        setPendingData(null);
        setStats(null);
        closeSession(MENU_CODE);
    };

    const handleGenerate = async () => {
        setError(null);
        if (!south || !west || !north || !east) {
            setError('바운딩 박스 좌표를 모두 입력하세요.');
            return;
        }
        if (!apiKey) {
            setError('VWorld API 키를 입력하세요.');
            return;
        }

        const s = parseFloat(south), n = parseFloat(north);
        const w = parseFloat(west),  e = parseFloat(east);
        if (n - s > 0.1 || e - w > 0.1) {
            setError('영역이 너무 큽니다. 최대 0.1° × 0.1° (약 11km × 11km)');
            return;
        }

        setLoading(true);
        setProgress('VWorld 위성 타일 수집 중...');

        try {
            const formData = new FormData();
            formData.append('south',          south);
            formData.append('west',           west);
            formData.append('north',          north);
            formData.append('east',           east);
            formData.append('vworldApiKey',   apiKey);
            formData.append('grayTolerance',  String(grayTolerance));
            formData.append('brightnessMin',  String(brightnessMin));
            formData.append('brightnessMax',  String(brightnessMax));
            formData.append('minRoadArea',    String(minRoadArea));
            formData.append('minSegmentPx',   String(minSegmentPx));
            if (ktdbFile) formData.append('ktdbZip', ktdbFile);

            setProgress('도로 세그멘테이션 · 중심선 추출 중...');

            const url = `${import.meta.env.VITE_API_URL}/network/import/auto/json`;
            const res = await fetch(url, { method: 'POST', body: formData });

            if (!res.ok) {
                const body = await res.text().catch(() => `HTTP ${res.status}`);
                throw new Error(body || `서버 오류 ${res.status}`);
            }

            setProgress('네트워크 빌드 중...');
            const data = await res.json();
            assignPropertyToResponseData(data);
            setPendingData(data);
            // stats는 backend가 NetworkResponse에 포함시키지 않으므로 직접 집계
            setStats({
                node_count: data.nodes?.length ?? 0,
                link_count: data.links?.length ?? 0,
                ktdb_used : !!ktdbFile,
            });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : '알 수 없는 오류');
        } finally {
            setLoading(false);
            setProgress('');
        }
    };

    const handleApply = () => {
        if (!pendingData) return;
        useNetworkStore.getState().setCurrentJsonDataWithFullBuild(pendingData);
        useNetworkStore.getState().setChange(true);
        handleClose();
    };

    // ── 지도 선택 중 배너 ─────────────────────────────────────────────────
    if (selecting) {
        return (
            <div style={selectingBannerStyle}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    지도에서 드래그하여 영역을 선택하세요
                </span>
                <button style={cancelSelectBtnStyle} onClick={() => setSelecting(false)}>
                    취소
                </button>
            </div>
        );
    }

    // ── 결과 확인 ────────────────────────────────────────────────────────────
    if (pendingData && stats) {
        return (
            <div style={overlayStyle}>
                <div style={{ ...panelStyle, width: 360 }}>
                    <div style={headerStyle}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>자동 네트워크 생성 완료</span>
                    </div>
                    <div style={{ ...bodyStyle, gap: 10 }}>
                        <div style={statsBoxStyle}>
                            <StatRow label="노드" value={`${stats.node_count}개`} />
                            <StatRow label="링크" value={`${stats.link_count}개`} />
                            <StatRow label="KTDB 매핑" value={stats.ktdb_used ? '적용됨' : '미적용 (기본값)'} />
                        </div>
                        <p style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb),0.45)', margin: 0, lineHeight: 1.6 }}>
                            위성 이미지에서 추출한 도로 네트워크입니다.
                            교차로 연결(connection)은 자동 생성되지 않으며
                            시뮬레이션 전 수동 보정이 필요합니다.
                        </p>
                    </div>
                    <div style={footerStyle}>
                        <button style={cancelBtnStyle} onClick={() => { setPendingData(null); setStats(null); }}>
                            다시 생성
                        </button>
                        <button style={primaryBtnStyle} onClick={handleApply}>
                            지도에 반영
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── 메인 모달 ─────────────────────────────────────────────────────────
    return (
        <div style={overlayStyle}>
            <div style={panelStyle}>
                {/* 헤더 */}
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>자동 네트워크 생성</span>
                    <button style={closeBtnStyle} onClick={handleClose}>×</button>
                </div>

                <div style={bodyStyle}>
                    <p style={descStyle}>
                        VWorld 위성 이미지에서 도로를 자동 추출합니다.
                        전국노드링크 SHP를 첨부하면 차선수·제한속도를 매핑합니다.
                    </p>

                    {/* 영역 선택 */}
                    <button style={mapSelectBtnStyle} onClick={() => { setError(null); setSelecting(true); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
                        </svg>
                        지도에서 영역 선택
                    </button>

                    <div style={sectionTitle}>바운딩 박스</div>
                    <div style={gridStyle}>
                        {[
                            ['남쪽 (South)', south, setSouth],
                            ['서쪽 (West)',  west,  setWest],
                            ['북쪽 (North)', north, setNorth],
                            ['동쪽 (East)',  east,  setEast],
                        ].map(([label, val, setter]: any) => (
                            <React.Fragment key={label as string}>
                                <label style={labelStyle}>{label}</label>
                                <input style={inputStyle} type="number" step="any"
                                       value={val} onChange={e => setter(e.target.value)}/>
                            </React.Fragment>
                        ))}
                    </div>

                    {/* VWorld API Key */}
                    <div style={{ ...sectionTitle, marginTop: 12 }}>VWorld API 키</div>
                    <input
                        style={inputStyle}
                        type="text"
                        placeholder="VWORLD_API_KEY"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                    />

                    {/* KTDB ZIP */}
                    <div style={{ ...sectionTitle, marginTop: 12 }}>전국노드링크 SHP (선택)</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button style={filePickBtnStyle} onClick={() => fileInputRef.current?.click()}>
                            {ktdbFile ? '파일 변경' : 'ZIP 선택'}
                        </button>
                        <span style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb),0.4)' }}>
                            {ktdbFile ? ktdbFile.name : '미첨부 — 기본 속성(1차선, 50km/h) 사용'}
                        </span>
                        <input ref={fileInputRef} type="file" accept=".zip"
                               style={{ display: 'none' }}
                               onChange={e => setKtdbFile(e.target.files?.[0] ?? null)}/>
                    </div>

                    {/* 고급 파라미터 */}
                    <button
                        style={advancedToggleBtnStyle}
                        onClick={() => setShowAdvanced(v => !v)}
                    >
                        {showAdvanced ? '▲' : '▼'} 고급 파라미터
                    </button>

                    {showAdvanced && (
                        <div style={advancedPanelStyle}>
                            <AdvancedRow label="회색 허용 편차" min={5}  max={60} value={grayTolerance} onChange={setGrayTolerance}/>
                            <AdvancedRow label="최소 밝기"       min={0}  max={150} value={brightnessMin} onChange={setBrightnessMin}/>
                            <AdvancedRow label="최대 밝기"       min={100} max={255} value={brightnessMax} onChange={setBrightnessMax}/>
                            <AdvancedRow label="최소 도로 면적(px)" min={50} max={2000} value={minRoadArea} onChange={setMinRoadArea}/>
                            <AdvancedRow label="최소 세그먼트(px)"  min={5}  max={100}  value={minSegmentPx} onChange={setMinSegmentPx}/>
                        </div>
                    )}

                    {/* 에러 */}
                    {error && <div style={errorStyle}>{error}</div>}

                    {/* 진행 중 */}
                    {loading && (
                        <div style={progressStyle}>
                            <span style={spinnerStyle}>⟳</span> {progress}
                        </div>
                    )}

                    <div style={noteStyle}>
                        ※ 세그멘테이션은 색상 기반 휴리스틱입니다.
                        나무·그늘·건물이 많은 구간은 오검출될 수 있습니다.
                        생성 후 선택·편집 모드로 보정하세요.
                    </div>
                </div>

                {/* 푸터 */}
                <div style={footerStyle}>
                    <button style={cancelBtnStyle} onClick={handleClose} disabled={loading}>
                        취소
                    </button>
                    <button
                        style={loading ? { ...primaryBtnStyle, opacity: 0.5 } : primaryBtnStyle}
                        onClick={handleGenerate}
                        disabled={loading}
                    >
                        {loading ? '생성 중...' : '네트워크 생성'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

const StatRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
);

const AdvancedRow: React.FC<{
    label: string; min: number; max: number; value: number;
    onChange: (v: number) => void;
}> = ({ label, min, max, value, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{label}</span>
        <input type="range" min={min} max={max} value={value}
               onChange={e => onChange(Number(e.target.value))}
               style={{ flex: 2 }}/>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 36, textAlign: 'right' }}>{value}</span>
    </div>
);

// ── 스타일 ──────────────────────────────────────────────────────────────────

const selectingBannerStyle: React.CSSProperties = {
    position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
    zIndex: 1300, display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 20px', background: 'rgba(var(--surface-popover-rgb),0.96)',
    border: '1px solid rgba(var(--accent-rgb),0.5)', borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
    pointerEvents: 'all',
};

const cancelSelectBtnStyle: React.CSSProperties = {
    padding: '5px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb),0.15)',
    background: 'rgba(var(--overlay-rgb),0.07)', color: 'var(--text-tertiary)', cursor: 'pointer',
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(var(--surface-overlay-rgb),0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
};

const panelStyle: React.CSSProperties = {
    background: 'rgba(var(--surface-popover-rgb),0.98)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
    borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    width: 440, maxWidth: '92vw', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid rgba(var(--overlay-rgb),0.07)', color: 'var(--text-secondary)',
};

const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
};

const bodyStyle: React.CSSProperties = {
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
    overflowY: 'auto',
};

const descStyle: React.CSSProperties = { fontSize: 11, color: 'rgba(var(--overlay-rgb),0.45)', margin: '0 0 4px 0' };

const mapSelectBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 8, padding: '8px 14px', fontSize: 12, borderRadius: 6,
    border: '1px dashed rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.08)',
    color: 'var(--accent-text)', cursor: 'pointer', width: '100%',
};

const sectionTitle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4,
};

const gridStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px',
};

const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
    background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
    borderRadius: 5, color: 'var(--text-secondary)', fontSize: 12, padding: '5px 8px',
    outline: 'none', width: '100%', boxSizing: 'border-box',
};

const filePickBtnStyle: React.CSSProperties = {
    padding: '5px 12px', fontSize: 11, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb),0.15)',
    background: 'rgba(var(--overlay-rgb),0.06)', color: 'var(--text-tertiary)', cursor: 'pointer',
    whiteSpace: 'nowrap',
};

const advancedToggleBtnStyle: React.CSSProperties = {
    marginTop: 4, padding: '4px 10px', fontSize: 11, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb),0.1)',
    background: 'rgba(var(--overlay-rgb),0.04)', color: 'rgba(var(--overlay-rgb),0.4)', cursor: 'pointer',
    textAlign: 'left', width: '100%',
};

const advancedPanelStyle: React.CSSProperties = {
    padding: '8px 10px', background: 'rgba(var(--overlay-rgb),0.02)',
    border: '1px solid rgba(var(--overlay-rgb),0.07)', borderRadius: 6,
    display: 'flex', flexDirection: 'column', gap: 6,
};

const statsBoxStyle: React.CSSProperties = {
    padding: '10px 12px', background: 'rgba(var(--accent-rgb),0.06)',
    border: '1px solid rgba(var(--accent-rgb),0.2)', borderRadius: 6,
    display: 'flex', flexDirection: 'column', gap: 6,
};

const errorStyle: React.CSSProperties = {
    marginTop: 4, padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(var(--color-danger-rgb),0.12)', border: '1px solid rgba(var(--color-danger-rgb),0.3)',
    color: 'var(--color-danger)',
};

const progressStyle: React.CSSProperties = {
    marginTop: 4, padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)',
    color: 'var(--accent-text)', display: 'flex', alignItems: 'center', gap: 8,
};

const spinnerStyle: React.CSSProperties = {
    display: 'inline-block',
    animation: 'spin 1s linear infinite',
    fontSize: 14,
};

const noteStyle: React.CSSProperties = {
    marginTop: 6, fontSize: 10, color: 'var(--text-disabled)', lineHeight: 1.5,
};

const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '10px 16px', borderTop: '1px solid rgba(var(--overlay-rgb),0.07)',
};

const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--overlay-rgb),0.12)',
    background: 'rgba(var(--overlay-rgb),0.05)', color: 'var(--text-tertiary)', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(var(--accent-rgb),0.5)',
    background: 'rgba(var(--accent-rgb),0.2)', color: 'var(--accent-text)',
    cursor: 'pointer', fontWeight: 600,
};

export default AutoNetworkModal;
