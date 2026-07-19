import React, { useRef, useState, useEffect } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { createPortal } from 'react-dom';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useBusPtLineStore } from '@stores/useBusPtLineStore';
import { useRailPtLineStore } from '@stores/useRailPtLineStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { useImportProgress, OSM_STEPS, KTDB_STEPS } from '@hooks/useImportProgress';
import { refreshNetworkTiles } from '@utils/networkRefresh';
import ImportProgressBar from '@component/util/ImportProgressBar';
import { LAYER_CONFIG, detectLayerFromFilename } from '@component/tool/DataIOPanel';
import { autoSaveChangedLayers, backupAndResetDependentLayers } from '@utils/autoSave';
import { useNetworkTileStore } from '@stores/useNetworkTileStore';
import { useOnboardingStore } from '@stores/useOnboardingStore';
import { generateDummySignals } from '@utils/signal';

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Tab = 'file' | 'osm' | 'ktdb';
type ImportType = 'osm' | 'ktdb';

interface Props {
    onClose: () => void;
}

// ── 공유 헬퍼 ────────────────────────────────────────────────────────────────
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

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
const FileImportModal: React.FC<Props> = ({ onClose }) => {
    const [tab, setTab] = useState<Tab>('file');
    const { selecting, setSelecting } = useOsmBboxStore();

    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (selecting) setSelecting(false); else onClose(); } };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [onClose, selecting, setSelecting]);

    // 지도 영역 선택 중: overlay 없이 배너만
    if (selecting) {
        return createPortal(
            <div style={selectingBannerStyle}>
                <span style={{ fontSize: 13, color: '#e0e0e0' }}>Shift + 드래그로 영역을 선택하세요 (일반 드래그: 지도 이동)</span>
                <button style={cancelSelectBtnStyle} onClick={() => setSelecting(false)}>취소</button>
            </div>,
            document.body
        );
    }

    return createPortal(
        <>
            <div onClick={onClose} style={overlayStyle} />
            <div style={panelStyle}>
                {/* 헤더 */}
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#ddd' }}>가져오기</span>
                    <button onClick={onClose} style={closeBtnStyle}>×</button>
                </div>

                {/* 탭 */}
                <div style={tabBarStyle}>
                    {([['ktdb', 'KTDB'], ['osm', 'OSM'], ['file', '파일']] as [Tab, string][]).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            style={{ ...tabStyle, ...(tab === key ? tabActiveStyle : {}) }}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* 탭 콘텐츠 */}
                <div style={bodyStyle}>
                    {tab === 'file' && <FileTab onClose={onClose} />}
                    {tab === 'osm'  && <BboxTab type="osm"  onClose={onClose} />}
                    {tab === 'ktdb' && <BboxTab type="ktdb" onClose={onClose} />}
                </div>
            </div>
        </>,
        document.body
    );
};

// ── 파일 탭 (드래그앤드랍 + 클릭 선택) ──────────────────────────────────────
const FileTab: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
    const [xmlImport, setXmlImport] = useState<{
        file: File;
        detectedLayer: ReturnType<typeof detectLayerFromFilename>;
        selectedKey: string;
    } | null>(null);

    const processJsonFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parsed = JSON.parse(e.target!.result as string);
                const versionKey = getActiveVersionId() ?? '';
                let loaded = 0;
                let networkLoaded = false;
                let signalLoaded = false;
                if (parsed.__iitp_export) {
                    const hasNetwork = LAYER_CONFIG.some(cfg => cfg.key === 'network' && parsed.data?.[cfg.key]);
                    if (hasNetwork && versionKey) await backupAndResetDependentLayers(versionKey);
                    for (const cfg of LAYER_CONFIG) {
                        const layerData = parsed.data?.[cfg.key];
                        if (!layerData) continue;
                        assignPropertyToResponseData(layerData);
                        cfg.store.getState().setCurrentJsonDataWithFullBuild(layerData);
                        cfg.store.getState().setChange(true);
                        if (cfg.key === 'network') networkLoaded = true;
                        if (cfg.key === 'signal') signalLoaded = true;
                        loaded++;
                    }
                    setStatus({ type: 'ok', text: `${loaded}개 레이어 가져오기 완료 — 저장 중...` });
                } else if (parsed.__iitp_layer) {
                    const cfg = LAYER_CONFIG.find(l => l.key === parsed.__iitp_layer);
                    if (!cfg) { setStatus({ type: 'error', text: `알 수 없는 레이어: ${parsed.__iitp_layer}` }); return; }
                    if (cfg.key === 'network' && versionKey) await backupAndResetDependentLayers(versionKey);
                    assignPropertyToResponseData(parsed.data);
                    cfg.store.getState().setCurrentJsonDataWithFullBuild(parsed.data);
                    cfg.store.getState().setChange(true);
                    if (cfg.key === 'network') networkLoaded = true;
                    setStatus({ type: 'ok', text: `${cfg.label} 가져오기 완료 — 저장 중...` });
                } else {
                    const detected = detectLayerFromFilename(file.name);
                    if (detected) {
                        const data = parsed.data ?? parsed;
                        if (detected.key === 'network' && versionKey) await backupAndResetDependentLayers(versionKey);
                        assignPropertyToResponseData(data);
                        detected.store.getState().setCurrentJsonDataWithFullBuild(data);
                        detected.store.getState().setChange(true);
                        if (detected.key === 'network') networkLoaded = true;
                        setStatus({ type: 'ok', text: `${detected.label}(파일명 감지) 가져오기 완료 — 저장 중...` });
                    } else {
                        setStatus({ type: 'error', text: '__iitp_layer 또는 __iitp_export 키가 없습니다' });
                        return;
                    }
                }
                if (versionKey) await autoSaveChangedLayers(versionKey);
                // 신호 데이터도 함께 임포트됐으면 더미 생성 팝업 불필요
                if (networkLoaded && !signalLoaded) useOnboardingStore.getState().setStep('need-dummy');
                setStatus(s => s ? { ...s, text: s.text.replace(' — 저장 중...', ' — 서버 저장 완료') } : null);
            } catch { setStatus({ type: 'error', text: 'JSON 파싱 오류' }); }
        };
        reader.readAsText(file);
    };

    const processFile = (file: File) => {
        setStatus(null);
        setXmlImport(null);
        if (file.name.endsWith('.json')) {
            processJsonFile(file);
        } else if (file.name.endsWith('.xml')) {
            const detected = detectLayerFromFilename(file.name);
            setXmlImport({ file, detectedLayer: detected, selectedKey: detected?.key ?? '' });
        } else {
            setStatus({ type: 'error', text: 'JSON 또는 XML 파일만 지원합니다' });
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    };

    const handleXmlImport = async () => {
        if (!xmlImport?.selectedKey) return;
        const cfg = LAYER_CONFIG.find(l => l.key === xmlImport.selectedKey);
        if (!cfg?.xmlExportUrl) return;
        const versionId = getActiveVersionId() ?? '';
        if (!versionId) { setStatus({ type: 'error', text: '시나리오가 선택되지 않았습니다' }); return; }
        try {
            const formData = new FormData();
            formData.append('file', xmlImport.file);
            if (xmlImport.selectedKey === 'network' && versionId) await backupAndResetDependentLayers(versionId);
            const res = await fetch(
                `${import.meta.env.VITE_API_URL}${cfg.xmlExportUrl}/${versionId}/import`,
                { method: 'POST', body: formData }
            );
            if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
            const data = await res.json();
            const responseData = data.network ?? data.data ?? data;
            assignPropertyToResponseData(responseData);
            cfg.store.getState().setCurrentJsonDataWithFullBuild(responseData);
            cfg.store.getState().setChange(true);
            if (versionId) await autoSaveChangedLayers(versionId);
            if (xmlImport.selectedKey === 'network') {
                refreshNetworkTiles(); // 타일 모드: 2D/3D 타일 캐시 무효화 (없으면 이전 네트워크 잔존)
                useOnboardingStore.getState().setStep('need-dummy');
            }
            setStatus({ type: 'ok', text: `${cfg.label} XML 가져오기 완료` });
            setXmlImport(null);
        } catch (e) {
            setStatus({ type: 'error', text: e instanceof Error ? e.message : 'XML 가져오기 실패' });
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={descStyle}>JSON 또는 XML 파일을 드래그하거나 클릭하여 가져옵니다.<br/>스키마 정보가 없으면 파일명으로 레이어를 자동 감지합니다.</p>

            <div
                style={{
                    ...dropZoneStyle,
                    borderColor: isDragging ? 'rgba(65,105,225,0.7)' : 'rgba(255,255,255,0.12)',
                    background: isDragging ? 'rgba(65,105,225,0.08)' : 'rgba(255,255,255,0.03)',
                }}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div style={{ fontSize: 22, marginBottom: 4, opacity: 0.5 }}>⬆</div>
                <div style={{ fontSize: 11, color: '#888' }}>파일을 끌어오거나</div>
                <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                <input ref={fileInputRef} type="file" accept=".json,.xml" style={{ display: 'none' }}
                       onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
            </div>

            {xmlImport && (
                <div style={xmlPanelStyle}>
                    <div style={{ fontSize: 11, color: '#7aa2ff', marginBottom: 6 }}>📄 {xmlImport.file.name}</div>
                    {xmlImport.detectedLayer
                        ? <div style={{ fontSize: 11, color: '#6fcf97', marginBottom: 8 }}>✓ 자동 감지: <strong>{xmlImport.detectedLayer.label}</strong></div>
                        : <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 6 }}>파일명으로 레이어를 감지할 수 없습니다. 직접 선택하세요.</div>
                    }
                    <select style={selectStyle} value={xmlImport.selectedKey}
                            onChange={e => setXmlImport(p => p ? { ...p, selectedKey: e.target.value } : null)}>
                        <option value="">— 레이어 선택 —</option>
                        {LAYER_CONFIG.filter(c => c.xmlExportUrl).map(c => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                    </select>
                    <button style={{ ...importBtnStyle, marginTop: 8 }} onClick={handleXmlImport}
                            disabled={!xmlImport.selectedKey}>
                        XML 가져오기
                    </button>
                </div>
            )}

            {status && (
                <div style={{ fontSize: 11, color: status.type === 'ok' ? '#6fcf97' : '#ff6b6b', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 5 }}>
                    {status.type === 'ok' ? '✓ ' : '✗ '}{status.text}
                </div>
            )}
        </div>
    );
};

// ── OSM / KTDB 탭 (공유 bbox 폼) ─────────────────────────────────────────────
const BboxTab: React.FC<{ type: ImportType; onClose: () => void }> = ({ type, onClose }) => {
    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();
    const versionId = getActiveVersionId() ?? '';

    const [south, setSouth] = useState('');
    const [west,  setWest]  = useState('');
    const [north, setNorth] = useState('');
    const [east,  setEast]  = useState('');
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState<string | null>(null);
    const [pendingData, setPendingData]       = useState<any>(null);
    const [pendingFacilities, setPendingFacilities] = useState<any>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [isSimplified, setIsSimplified]     = useState(false);
    const { progress, start: startProgress, finish: finishProgress, reset: resetProgress } =
        useImportProgress(type === 'ktdb' ? KTDB_STEPS : OSM_STEPS);
    const [reflecting, setReflecting] = useState(false); // 지도 반영 중 로더

    useEffect(() => {
        if (!bbox) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox]);

    const handleImport = async () => {
        setError(null);
        if (!south || !west || !north || !east) { setError('바운딩 박스 좌표를 모두 입력하세요.'); return; }
        setLoading(true);
        startProgress();
        try {
            const formData = new FormData();
            formData.append('south', south);
            formData.append('west',  west);
            formData.append('north', north);
            formData.append('east',  east);
            if (versionId) formData.append('versionId', versionId);

            const url = type === 'osm'
                ? `${import.meta.env.VITE_API_URL}/network/import/osm/save`
                : `${import.meta.env.VITE_API_URL}/network/import/ktdb/save`;
            const res = await fetch(url, { method: 'POST', body: formData });

            const data = await res.json();
            if (!res.ok) {
                const msgs: string[] = data?.errors ?? data?.warnings ?? [`서버 오류 ${res.status}`];
                throw new Error(msgs.join('\n'));
            }
            finishProgress();
            setIsSimplified(data.simplified ?? false);
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

    const handleConfirm = async () => {
        if (!pendingData) return;
        if (versionId) await backupAndResetDependentLayers(versionId);

        setReflecting(true);
        try {
            await new Promise(r => setTimeout(r, 50)); // 로더 렌더 프레임 양보

            if (isSimplified) {
                // 대용량 KTDB: 뷰포트 타일 모드로 전환 (versionId별 영속 → 이 시나리오만 타일 모드).
                // currentJsonData에 빈 마커 설정 → Facility.tsx visibleFields 필터 통과 → 레이어 목록 유지.
                // setTileMode(true) → tileMode 구독 → load() → updateTiles() 트리거.
                useNetworkTileStore.getState().setTileMode(true, versionId ?? undefined);
                useNetworkStore.getState().setCurrentJsonData({ id: 0, name: null, nodes: [], links: [] } as any);
            } else {
                useNetworkTileStore.getState().setTileMode(false, versionId ?? undefined);
                assignPropertyToResponseData(pendingData);
                useNetworkStore.getState().setCurrentJsonDataWithFullBuild(pendingData);
                useNetworkStore.getState().setChange(true);
            }
            refreshNetworkTiles(); // MVT/타일 캐시 무효화 — 이전 네트워크 타일 잔존 방지
            injectAll(pendingFacilities);

            // KTDB: intersection 노드 기반 더미 신호 자동 생성
            if (type === 'ktdb') {
                const signals = generateDummySignals(pendingData);
                if (signals.length > 0) {
                    const signalData = { signals };
                    assignPropertyToResponseData(signalData);
                    useSignalStore.getState().setCurrentJsonData(signalData);
                    useSignalStore.getState().setChange(true);
                }
            }

            if (versionId) {
                const emptyLogs = { added: [], modified: [], deleted: [] };
                const saveRoute = (url: string, d: any) =>
                    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d, logs: emptyLogs }) })
                        .catch(e => console.warn('[FileImport] 노선 저장 실패:', e));
                const base = import.meta.env.VITE_API_URL;
                if (pendingFacilities?.busRoutes?.lines?.length > 0)  await saveRoute(`${base}/public-transit/line/bus/${versionId}`, pendingFacilities.busRoutes);
                if (pendingFacilities?.railRoutes?.routes?.length > 0) await saveRoute(`${base}/public-transit/line/rail/${versionId}`, pendingFacilities.railRoutes);
                await autoSaveChangedLayers(versionId);
            }

            // 타일 재요청이 시작될 시간 확보 (로더가 즉시 사라져 빈 지도로 보이는 것 방지)
            await new Promise(r => setTimeout(r, 800));
        } finally {
            setReflecting(false);
        }

        useOnboardingStore.getState().setStep('need-dummy');
        setBbox(null);
        onClose();
    };

    const isOsm = type === 'osm';
    const label = isOsm ? 'OSM (Overpass)' : 'KTDB 표준노드링크';

    // 지도 반영 중 로더
    if (reflecting) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 0' }}>
                <div style={reflectSpinnerStyle} />
                <p style={{ fontSize: 13, color: '#e0e0e0', margin: 0, fontWeight: 600 }}>지도에 반영 중...</p>
                <p style={{ fontSize: 11, color: '#888', margin: 0, textAlign: 'center' }}>
                    기존 데이터를 초기화하고 새 네트워크 타일을 불러오고 있습니다.
                </p>
            </div>
        );
    }

    // 변환 완료 확인 다이얼로그
    if (pendingData) {
        const nodeCount = pendingData.nodes?.length ?? 0;
        const linkCount = pendingData.links?.length ?? 0;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 12, color: '#ccc', margin: 0 }}>서버에 network.xml이 저장되었습니다.</p>
                <p style={{ fontSize: 11, color: '#888', margin: 0 }}>노드 {nodeCount}개 · 링크 {linkCount}개</p>
                {isSimplified && (
                    <p style={{ fontSize: 10, color: '#5bc8f5', margin: 0 }}>
                        ℹ 대용량 네트워크 — 직선 간소화 렌더링. 줌인 시 상세 형상을 자동 로드합니다.
                    </p>
                )}
                {warnings.length > 0 && (
                    <div style={{ padding: '8px 10px', background: 'rgba(245,166,35,0.08)', borderRadius: 5, border: '1px solid rgba(245,166,35,0.3)' }}>
                        <p style={{ fontSize: 10, color: '#f0c040', margin: '0 0 4px', fontWeight: 600 }}>⚠ 경고 {warnings.length}건</p>
                        {warnings.map((w, i) => <p key={i} style={{ fontSize: 10, color: '#c8a840', margin: '2px 0' }}>• {w}</p>)}
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                    <button style={cancelBtnStyle} onClick={() => setPendingData(null)}>닫기</button>
                    <button style={importBtnStyle} onClick={handleConfirm}>지도에 반영</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={descStyle}>{label} 데이터로 네트워크를 생성합니다.</p>

            <button style={mapSelectBtnStyle} onClick={() => { setError(null); setSelecting(true); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
                </svg>
                지도에서 영역 선택
            </button>

            <div style={gridStyle}>
                {[['남쪽 (South)', south, setSouth, '37.49'], ['서쪽 (West)', west, setWest, '126.75'],
                  ['북쪽 (North)', north, setNorth, '37.52'], ['동쪽 (East)', east, setEast, '126.80']].map(
                    ([lbl, val, setter, ph]) => (
                        <React.Fragment key={String(lbl)}>
                            <label style={labelStyle}>{String(lbl)}</label>
                            <input style={inputStyle} type="number" step="any"
                                   placeholder={`예: ${String(ph)}`} value={String(val)}
                                   onChange={e => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)} />
                        </React.Fragment>
                    )
                )}
            </div>

            {error && <div style={{ fontSize: 11, color: '#ff6b6b', padding: '6px 8px', background: 'rgba(255,107,107,0.08)', borderRadius: 4 }}>{error}</div>}

            {loading && <ImportProgressBar progress={progress} />}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button style={cancelBtnStyle} onClick={onClose} disabled={loading}>취소</button>
                <button style={loading ? { ...importBtnStyle, opacity: 0.6 } : importBtnStyle}
                        onClick={handleImport} disabled={loading}>
                    {loading ? '변환 중...' : `${isOsm ? 'OSM' : 'KTDB'} 가져오기`}
                </button>
            </div>
        </div>
    );
};

// ── 스타일 ────────────────────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2100,
};
const panelStyle: React.CSSProperties = {
    position: 'fixed', top: '54px', left: '50%', transform: 'translateX(-50%)',
    width: 400, maxHeight: 'calc(100vh - 70px)',
    background: 'rgba(13,15,24,0.98)', backdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
    boxShadow: '0 16px 48px rgba(0,0,0,0.7)', zIndex: 2101,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
};
const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const tabBarStyle: React.CSSProperties = {
    display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
};
const tabStyle: React.CSSProperties = {
    flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 500, color: '#666',
    background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer',
};
const tabActiveStyle: React.CSSProperties = {
    color: '#7aa2ff', border: 'none', borderBottom: '2px solid #7aa2ff',
};
const bodyStyle: React.CSSProperties = {
    padding: '14px', overflowY: 'auto', flex: 1,
};
const reflectSpinnerStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    border: '3px solid rgba(255,255,255,0.15)',
    borderTopColor: '#5588ee',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite', // App.css @keyframes spin 재사용
};

const descStyle: React.CSSProperties = {
    fontSize: 11, color: '#888', margin: '0 0 4px', lineHeight: 1.6,
};
const dropZoneStyle: React.CSSProperties = {
    border: '2px dashed', borderRadius: 8, padding: '24px 16px',
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
};
const xmlPanelStyle: React.CSSProperties = {
    padding: '10px 12px', background: 'rgba(255,255,255,0.04)',
    borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
};
const selectStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 4,
    background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc',
};
const gridStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px',
};
const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#888', alignSelf: 'center',
};
const inputStyle: React.CSSProperties = {
    padding: '5px 8px', fontSize: 11, borderRadius: 4,
    background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.15)', color: '#e0e0e0',
    width: '100%', boxSizing: 'border-box',
};
const mapSelectBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '7px 14px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(65,105,225,0.12)', border: '1px solid rgba(65,105,225,0.4)', color: '#7aa2ff',
};
const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#aaa',
};
const importBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(65,105,225,0.2)', border: '1px solid rgba(65,105,225,0.5)', color: '#7aa2ff',
    fontWeight: 600,
};
const selectingBannerStyle: React.CSSProperties = {
    position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
    zIndex: 2200, display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 20px', background: 'rgba(14,16,28,0.96)',
    border: '1px solid rgba(65,105,225,0.5)', borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
    pointerEvents: 'all',
};
const cancelSelectBtnStyle: React.CSSProperties = {
    padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)',
    color: '#aaa',
};

export default FileImportModal;
