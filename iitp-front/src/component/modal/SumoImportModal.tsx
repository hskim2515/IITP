import React, { useEffect, useState } from 'react';
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useBusPtLineStore } from '@stores/useBusPtLineStore';
import { useRailPtLineStore } from '@stores/useRailPtLineStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { useImportProgress, OSM_STEPS } from '@hooks/useImportProgress';
import ImportProgressBar from '@component/util/ImportProgressBar';

const MENU_CODE = 'SUMO_IMPORT';

function injectAll(data: any) {
    if (!data) return;
    const inject = (val: any, store: any) => {
        if (!val) return;
        assignPropertyToResponseData(val);
        store.getState().setCurrentJsonDataWithFullBuild(val);
        store.getState().setChange(true);
    };
    if (data.busStations?.busStations?.length > 0)  inject(data.busStations,  useBusStationStore);
    if (data.railStations?.railStations?.length > 0) inject(data.railStations, useRailStationStore);
    if (data.busRoutes?.lines?.length > 0)           inject(data.busRoutes,    useBusPtLineStore);
    if (data.railRoutes?.routes?.length > 0)         inject(data.railRoutes,   useRailPtLineStore);
    const signals = data.signals ?? [];
    if (signals.length > 0) {
        const signalData = { signals };
        assignPropertyToResponseData(signalData);
        useSignalStore.getState().setCurrentJsonData(signalData);
        useSignalStore.getState().setChange(true);
    }
}

const SumoImportModal: React.FC = () => {
    const closeSession = useWorkflowStore((s: any) => s.closeSession) as (code: string) => void;

    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();
    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const versionId = selectedScenario?.key ?? '';

    const scenarioLat = selectedScenario?.latitude;
    const scenarioLon = selectedScenario?.longitude;

    const [south, setSouth] = useState('');
    const [west,  setWest]  = useState('');
    const [north, setNorth] = useState('');
    const [east,  setEast]  = useState('');
    const [baseLat, setBaseLat] = useState(
        scenarioLat && scenarioLat !== 0 ? scenarioLat.toFixed(6) : ''
    );
    const [baseLon, setBaseLon] = useState(
        scenarioLon && scenarioLon !== 0 ? scenarioLon.toFixed(6) : ''
    );
    const [loading, setLoading]             = useState(false);
    const { progress, start: startProgress, finish: finishProgress, reset: resetProgress } = useImportProgress(OSM_STEPS);
    const [error,   setError]               = useState<string | null>(null);
    const [pendingData, setPendingData]     = useState<any>(null);
    const [pendingFacilities, setPendingFacilities] = useState<any>(null);
    const [warnings, setWarnings]           = useState<string[]>([]);

    useEffect(() => {
        if (!bbox) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox]);

    useEffect(() => {
        if (scenarioLat && scenarioLat !== 0 && scenarioLon && scenarioLon !== 0) return;
        const s = parseFloat(south), n = parseFloat(north);
        const w = parseFloat(west),  e = parseFloat(east);
        if (!isNaN(s) && !isNaN(n) && !isNaN(w) && !isNaN(e)) {
            setBaseLat(((s + n) / 2).toFixed(6));
            setBaseLon(((w + e) / 2).toFixed(6));
        }
    }, [south, north, west, east]);

    const handleClose = () => {
        setSelecting(false);
        setBbox(null);
        setPendingData(null);
        setPendingFacilities(null);
        setWarnings([]);
        closeSession(MENU_CODE);
    };

    const handleImport = async () => {
        setError(null);
        if (!south || !west || !north || !east) {
            setError('바운딩 박스 좌표를 모두 입력하세요.');
            return;
        }
        setLoading(true);
        startProgress();
        try {
            // 기존 network.xml 백업
            if (versionId) {
                const backupRes = await fetch(
                    `${import.meta.env.VITE_API_URL}/network/${versionId}/backup`);
                if (backupRes.ok) {
                    const blob = await backupRes.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `network_backup_${versionId}.xml`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                }
            }

            const params = new URLSearchParams({ south, west, north, east });
            if (baseLat) params.append('baseLat', baseLat);
            if (baseLon) params.append('baseLon', baseLon);
            if (versionId) params.append('versionId', versionId);

            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/network/import/sumo/save?${params}`);
            const data = await res.json();
            if (!res.ok) {
                const msgs: string[] = data?.warnings ?? [`서버 오류 ${res.status}`];
                throw new Error(msgs.join('\n'));
            }
            finishProgress();
            setPendingData(data.network);
            setPendingFacilities(data);
            setWarnings(data.warnings ?? []);
        } catch (e: unknown) {
            resetProgress();
            setError(e instanceof Error ? e.message : '알 수 없는 오류');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmReplace = () => {
        if (!pendingData) return;
        assignPropertyToResponseData(pendingData);
        useNetworkStore.getState().setCurrentJsonDataWithFullBuild(pendingData);
        useNetworkStore.getState().setChange(true);
        injectAll(pendingFacilities);
        handleClose();
    };

    // ── 지도 선택 중 오버레이 ────────────────────────────────────────────────
    if (selecting) {
        return (
            <div style={selectingBannerStyle}>
                <span style={{ fontSize: 13, color: '#e0e0e0' }}>
                    Shift + 드래그로 영역을 선택하세요 (일반 드래그: 지도 이동)
                </span>
                <button style={cancelSelectBtnStyle} onClick={() => setSelecting(false)}>
                    취소
                </button>
            </div>
        );
    }

    // ── 교체 확인 다이얼로그 ─────────────────────────────────────────────────
    if (pendingData) {
        const nodeCount = pendingData.nodes?.length ?? 0;
        const linkCount = pendingData.links?.length ?? 0;
        return (
            <div style={overlayStyle}>
                <div style={{ ...panelStyle, width: 360 }}>
                    <div style={headerStyle}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>네트워크 저장 완료</span>
                    </div>
                    <div style={{ ...bodyStyle, gap: 10 }}>
                        <p style={{ fontSize: 12, color: '#ccc', margin: 0 }}>
                            서버에 network.xml이 저장되었습니다.
                        </p>
                        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
                            노드 {nodeCount}개 · 링크 {linkCount}개
                        </p>
                        <p style={{ fontSize: 10, color: '#4ecb8d', margin: 0 }}>
                            ✓ 기존 파일 백업이 자동으로 다운로드되었습니다.
                        </p>
                        {warnings.length > 0 && (
                            <div style={warningBoxStyle}>
                                <p style={{ fontSize: 10, color: '#f0c040', margin: '0 0 4px 0', fontWeight: 600 }}>
                                    ⚠ 경고 {warnings.length}건
                                </p>
                                {warnings.map((w, i) => (
                                    <p key={i} style={{ fontSize: 10, color: '#c8a840', margin: '2px 0' }}>• {w}</p>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={footerStyle}>
                        <button style={cancelBtnStyle} onClick={() => { setPendingData(null); setWarnings([]); }}>
                            닫기
                        </button>
                        <button style={importBtnStyle} onClick={handleConfirmReplace}>
                            지도에 반영
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── 메인 모달 ────────────────────────────────────────────────────────────
    return (
        <div style={overlayStyle}>
            <div style={panelStyle}>
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>OSM 가져오기</span>
                    <button style={closeBtnStyle} onClick={handleClose}>×</button>
                </div>

                <div style={bodyStyle}>
                    <p style={descStyle}>
                        OSM 데이터를 SUMO netconvert로 변환합니다.
                        교차로 차선 연결(connection)이 OSM 방식보다 정확하게 생성됩니다.
                    </p>

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
                        <label style={labelStyle}>남쪽 (South)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 37.49" value={south}
                               onChange={e => setSouth(e.target.value)}/>
                        <label style={labelStyle}>서쪽 (West)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 126.98" value={west}
                               onChange={e => setWest(e.target.value)}/>
                        <label style={labelStyle}>북쪽 (North)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 37.52" value={north}
                               onChange={e => setNorth(e.target.value)}/>
                        <label style={labelStyle}>동쪽 (East)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 127.01" value={east}
                               onChange={e => setEast(e.target.value)}/>
                    </div>

                    <div style={{ ...sectionTitle, marginTop: 14 }}>로컬 좌표 원점</div>
                    <p style={{ ...descStyle, marginTop: 2 }}>
                        {scenarioLat && scenarioLat !== 0
                            ? '시나리오 base 좌표로 자동 설정됨'
                            : '시나리오 base 좌표 미설정 — bbox 중심 사용'}
                    </p>
                    <div style={gridStyle}>
                        <label style={labelStyle}>원점 위도 (baseLat)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 37.505" value={baseLat}
                               onChange={e => setBaseLat(e.target.value)}/>
                        <label style={labelStyle}>원점 경도 (baseLon)</label>
                        <input style={inputStyle} type="number" step="any"
                               placeholder="예: 126.995" value={baseLon}
                               onChange={e => setBaseLon(e.target.value)}/>
                    </div>

                    {error && <div style={errorStyle}>{error}</div>}

                    <div style={noteStyle}>
                        ※ Docker로 netconvert를 실행합니다. 최초 실행 시 이미지 pull로 지연될 수 있습니다.
                    </div>
                </div>

                {loading && (
                    <div style={{ padding: '0 16px 8px' }}>
                        <ImportProgressBar progress={progress} color="#aa88ff" />
                    </div>
                )}

                <div style={footerStyle}>
                    <button style={cancelBtnStyle} onClick={handleClose} disabled={loading}>
                        취소
                    </button>
                    <button
                        style={loading ? { ...importBtnStyle, opacity: 0.6 } : importBtnStyle}
                        onClick={handleImport}
                        disabled={loading}
                    >
                        {loading ? 'netconvert 실행 중...' : 'OSM 가져오기'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── 스타일 (OsmImportModal과 동일) ───────────────────────────────────────────

const selectingBannerStyle: React.CSSProperties = {
    position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
    zIndex: 1300, display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 20px', background: 'rgba(14,16,28,0.96)',
    border: '1px solid rgba(65,105,225,0.5)', borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
    pointerEvents: 'all',
};
const cancelSelectBtnStyle: React.CSSProperties = {
    padding: '5px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)',
    color: '#aaa', cursor: 'pointer',
};
const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
};
const panelStyle: React.CSSProperties = {
    background: 'rgba(14,16,28,0.98)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    width: 420, maxWidth: '90vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#e0e0e0',
};
const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer',
    lineHeight: 1, padding: '0 2px',
};
const bodyStyle: React.CSSProperties = {
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
};
const descStyle: React.CSSProperties = { fontSize: 11, color: '#777', margin: '0 0 6px 0' };
const mapSelectBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, padding: '8px 14px', fontSize: 12, borderRadius: 6,
    border: '1px dashed rgba(65,105,225,0.5)', background: 'rgba(65,105,225,0.08)',
    color: '#7aa2ff', cursor: 'pointer', width: '100%',
};
const sectionTitle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: '#555',
    textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 6,
};
const gridStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
};
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888', display: 'flex', alignItems: 'center' };
const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5, color: '#ddd', fontSize: 12, padding: '5px 8px',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
};
const errorStyle: React.CSSProperties = {
    marginTop: 8, padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.3)', color: '#f07070',
};
const warningBoxStyle: React.CSSProperties = {
    marginTop: 6, padding: '8px 10px', borderRadius: 6,
    background: 'rgba(255,200,50,0.06)', border: '1px solid rgba(255,200,50,0.25)',
};
const noteStyle: React.CSSProperties = { marginTop: 10, fontSize: 10, color: '#555', lineHeight: 1.5 };
const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)',
};
const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#aaa', cursor: 'pointer',
};
const importBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(65,105,225,0.5)', background: 'rgba(65,105,225,0.2)',
    color: '#7aa2ff', cursor: 'pointer', fontWeight: 600,
};

export default SumoImportModal;
