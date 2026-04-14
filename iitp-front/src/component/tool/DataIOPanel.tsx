import React, { useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { useMessageStore } from '@stores/useMessageStore';
import styles from '@css/ToolsPanel.module.css';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { useBusStationStore, useBusStationHistoryStore } from '@stores/useBusStationStore';
import { useRailStationStore, useRailStationHistoryStore } from '@stores/useRailStationStore';
import { usePavementMarkingStore, usePavementMarkingHistoryStore } from '@stores/usePavementMarkingStore';
import { useSignalStore, useSignalHistoryStore } from '@stores/useSignalStore';
import { useSignalTodStore, useSignalTodHistoryStore } from '@stores/useSignalTodStore';
import { useBusPtLineStore, useBusPtLineWeekdayStore, useBusPtLineWeekendStore,
         useBusPtLineHistoryStore, useBusPtLineWeekdayHistoryStore, useBusPtLineWeekendHistoryStore } from '@stores/useBusPtLineStore';
import { useRailPtLineStore, useRailPtLineHistoryStore } from '@stores/useRailPtLineStore';
import { useSimulationScenarioStore, useSimulationScenarioHistoryStore } from '@stores/useSimulationScenarioStore';
import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { mergeUpdateLogs } from '@utils/history';
import SaveVersionModal from '@component/modal/SaveVersionModal';

// ── 레이어 설정 ─────────────────────────────────────────────────
// xmlExportUrl: XML export/import 엔드포인트 베이스 경로 (null이면 XML 미지원)
// filenameHints: XML 파일명 자동 감지용 키워드
const LAYER_CONFIG = [
    { key: 'network',            menuCode: 'NETWORK',             label: '네트워크',           store: useNetworkStore,            historyStore: useNetworkHistoryStore,            fullData: true,  xmlExportUrl: '/network',                        filenameHints: ['network', '네트워크'] },
    { key: 'busStation',         menuCode: 'BUS_STATION',         label: '버스 정류장',         store: useBusStationStore,         historyStore: useBusStationHistoryStore,         fullData: false, xmlExportUrl: '/public-transit/station/bus',     filenameHints: ['bus_station', 'busstation', '버스정류장', 'bus-station'] },
    { key: 'railStation',        menuCode: 'RAIL_STATION',        label: '철도 정류장',         store: useRailStationStore,        historyStore: useRailStationHistoryStore,        fullData: false, xmlExportUrl: '/public-transit/station/rail',    filenameHints: ['rail_station', 'railstation', '철도정류장', 'rail-station'] },
    { key: 'pavementMarking',    menuCode: 'PAVEMENT_MARKING',    label: '노면 표시',           store: usePavementMarkingStore,    historyStore: usePavementMarkingHistoryStore,    fullData: false, xmlExportUrl: null,                              filenameHints: ['pavement', '노면'] },
    { key: 'signal',             menuCode: 'SIGNAL',              label: '신호',                store: useSignalStore,             historyStore: useSignalHistoryStore,             fullData: false, xmlExportUrl: '/signal',                         filenameHints: ['signal', '신호'] },
    { key: 'signalTod',          menuCode: 'SIGNAL_TOD',          label: '신호 TOD',            store: useSignalTodStore,          historyStore: useSignalTodHistoryStore,          fullData: true,  xmlExportUrl: '/signal-tod',                     filenameHints: ['signal_tod', 'signaltod', 'signal-tod'] },
    { key: 'busRoute',           menuCode: 'BUS_PT_LINE',         label: '버스 노선',           store: useBusPtLineStore,          historyStore: useBusPtLineHistoryStore,          fullData: true,  xmlExportUrl: '/public-transit/line/bus',         filenameHints: ['bus_pt_line', 'busroute', 'bus_route', '버스노선'] },
    { key: 'busRouteWeekday',    menuCode: 'BUS_PT_LINE_WEEKDAY', label: '버스 노선 (평일)',     store: useBusPtLineWeekdayStore,   historyStore: useBusPtLineWeekdayHistoryStore,   fullData: true,  xmlExportUrl: '/public-transit/line/bus/weekday', filenameHints: ['weekday', '평일'] },
    { key: 'busRouteWeekend',    menuCode: 'BUS_PT_LINE_WEEKEND', label: '버스 노선 (주말)',     store: useBusPtLineWeekendStore,   historyStore: useBusPtLineWeekendHistoryStore,   fullData: true,  xmlExportUrl: '/public-transit/line/bus/weekend', filenameHints: ['weekend', '주말'] },
    { key: 'railRoute',          menuCode: 'RAIL_PT_LINE',        label: '철도 노선',           store: useRailPtLineStore,         historyStore: useRailPtLineHistoryStore,         fullData: true,  xmlExportUrl: '/public-transit/line/rail',        filenameHints: ['rail_pt_line', 'railroute', 'rail_route', '철도노선'] },
    { key: 'simulationScenario', menuCode: 'SIMULATION_SCENARIO', label: '시뮬레이션 시나리오',  store: useSimulationScenarioStore, historyStore: useSimulationScenarioHistoryStore, fullData: true,  xmlExportUrl: '/simulation-scenario',            filenameHints: ['simulation', 'scenario', '시나리오'] },
] as const;

type LayerKey = (typeof LAYER_CONFIG)[number]['key'];
type LayerCfg = (typeof LAYER_CONFIG)[number];

// ── XML 파일명으로 레이어 자동 감지 ─────────────────────────────
function detectLayerFromFilename(filename: string): LayerCfg | null {
    const lower = filename.toLowerCase().replace(/\s/g, '_');
    for (const cfg of LAYER_CONFIG) {
        if (!cfg.xmlExportUrl) continue;
        if (cfg.filenameHints.some(hint => lower.includes(hint.toLowerCase()))) {
            return cfg;
        }
    }
    return null;
}

function downloadJson(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function dateTag() {
    return new Date().toISOString().slice(0, 10);
}

type DataIOSection = 'all' | 'export' | 'import';

// ── XML 가져오기 상태 ─────────────────────────────────────────────
type XmlImportState = {
    file: File;
    detectedLayer: LayerCfg | null;
    selectedKey: LayerKey | '';
};

const DataIOPanel: React.FC<{ hideHeader?: boolean; section?: DataIOSection }> = ({
    hideHeader = false,
    section = 'all',
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importStatus, setImportStatus] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    const pendingSaveRef = useRef<((versionKey: string) => Promise<void>) | null>(null);

    // XML 가져오기 상태
    const [xmlImport, setXmlImport] = useState<XmlImportState | null>(null);
    const [xmlImporting, setXmlImporting] = useState(false);

    // 좌표 입력 상태 (MISSING_COORDINATES 에러 시)
    const [coordInput, setCoordInput] = useState<{ latitude: string; longitude: string } | null>(null);

    const setMessage = useMessageStore.getState().setMessage;

    // ── 현재 전체 데이터 백업 다운로드 ────────────────────────────
    const downloadBackup = useCallback(() => {
        const combined: Record<string, unknown> = {};
        let hasAny = false;
        for (const cfg of LAYER_CONFIG) {
            const data = cfg.store.getState().currentJsonData;
            if (data) { combined[cfg.key] = data; hasAny = true; }
        }
        if (hasAny) {
            downloadJson(`iitp_backup_${dateTag()}.json`, {
                __iitp_export: true, version: '1.0', data: combined,
            });
        }
    }, []);

    // ── 가져오기 전 확인 다이얼로그 ──────────────────────────────
    const confirmAndImport = useCallback((onConfirmed: () => void) => {
        const hasChanges = LAYER_CONFIG.some(cfg => cfg.store.getState().isChanged);
        const doImport = () => {
            downloadBackup();
            onConfirmed();
        };

        if (hasChanges) {
            setMessage({
                type: 'confirm',
                text: '저장되지 않은 변경사항이 있습니다.\n가져오기를 진행하면 현재 데이터가 교체됩니다.\n(현재 데이터는 자동으로 백업 파일로 다운로드됩니다)',
                onConfirm: doImport,
                onCancel: () => {},
            });
        } else {
            downloadBackup();
            onConfirmed();
        }
    }, [downloadBackup, setMessage]);

    // ── 서버 저장 ──────────────────────────────────────────────────
    const doSaveLayer = async (cfg: LayerCfg, versionKey: string) => {
        const api = apiConfig[cfg.menuCode as ApiMenuKey]?.update;
        if (!api) return;
        const currentJson = cfg.store.getState().currentJsonData;
        if (!currentJson) return;
        const logJson = cfg.historyStore.getState().updateLogs;
        const snapshotLogJson = cfg.historyStore.getState().snapshotUpdateLogs;
        const mergedLog = mergeUpdateLogs(logJson, snapshotLogJson);
        const data = cfg.fullData
            ? currentJson
            : Object.values(currentJson as Record<string, unknown>)[0];
        const payload = { data, logs: mergedLog };

        setSavingKeys(prev => new Set(prev).add(cfg.key));
        try {
            await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: payload });
            cfg.historyStore.getState().resetUpdateLogs();
            cfg.store.getState().setChange(false);
            setImportStatus({ type: 'ok', text: `${cfg.label} 저장 완료` });
        } catch {
            setImportStatus({ type: 'error', text: `${cfg.label} 저장 실패` });
        } finally {
            setSavingKeys(prev => { const s = new Set(prev); s.delete(cfg.key); return s; });
        }
    };

    const handleSaveLayer = (cfg: LayerCfg) => {
        const { selectedScenario } = useScenarioStore.getState();
        if (!selectedScenario) return;
        pendingSaveRef.current = (versionKey: string) => doSaveLayer(cfg, versionKey);
        setVersionModalOpen(true);
    };

    const handleSaveAll = () => {
        const changed = LAYER_CONFIG.filter(cfg => cfg.store.getState().isChanged);
        if (!changed.length) {
            setImportStatus({ type: 'error', text: '변경된 레이어가 없습니다.' });
            return;
        }
        const { selectedScenario } = useScenarioStore.getState();
        if (!selectedScenario) return;
        pendingSaveRef.current = async (versionKey: string) => {
            for (const cfg of changed) await doSaveLayer(cfg, versionKey);
        };
        setVersionModalOpen(true);
    };

    // ── XML 내보내기 ─────────────────────────────────────────────
    const [exportingXmlKey, setExportingXmlKey] = useState<string | null>(null);

    const handleExportXml = async (cfg: LayerCfg) => {
        if (!cfg.xmlExportUrl) return;
        const { selectedScenarioVersion } = useScenarioStore.getState();
        if (!selectedScenarioVersion) {
            setImportStatus({ type: 'error', text: '시나리오 버전을 먼저 선택해주세요.' });
            return;
        }
        setExportingXmlKey(cfg.key);
        try {
            const url = `${cfg.xmlExportUrl}/${selectedScenarioVersion.key}/export`;
            const response = await axiosInstance({ method: 'GET', url, responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'application/xml' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = `${cfg.key}_${selectedScenarioVersion.key}_${dateTag()}.xml`;
            a.click();
            URL.revokeObjectURL(href);
            setImportStatus({ type: 'ok', text: `${cfg.label} XML 내보내기 완료` });
        } catch {
            setImportStatus({ type: 'error', text: `${cfg.label} XML 내보내기 실패` });
        } finally {
            setExportingXmlKey(null);
        }
    };

    // ── JSON 내보내기 ─────────────────────────────────────────────
    const handleExportLayer = (key: LayerKey) => {
        const cfg = LAYER_CONFIG.find(l => l.key === key)!;
        const data = cfg.store.getState().currentJsonData;
        if (!data) {
            setImportStatus({ type: 'error', text: `${cfg.label} 데이터가 없습니다.` });
            return;
        }
        downloadJson(`iitp_${key}_${dateTag()}.json`, { __iitp_layer: key, data });
    };

    const handleExportAll = () => {
        const combined: Record<string, unknown> = {};
        let hasAny = false;
        for (const cfg of LAYER_CONFIG) {
            const data = cfg.store.getState().currentJsonData;
            if (data) { combined[cfg.key] = data; hasAny = true; }
        }
        if (!hasAny) {
            setImportStatus({ type: 'error', text: '내보낼 데이터가 없습니다.' });
            return;
        }
        downloadJson(`iitp_all_${dateTag()}.json`, { __iitp_export: true, version: '1.0', data: combined });
    };

    // ── XML 가져오기 실행 ─────────────────────────────────────────
    const doXmlImport = async (cfg: LayerCfg, coords?: { latitude: number; longitude: number }) => {
        if (!xmlImport) return;
        const { selectedScenarioVersion } = useScenarioStore.getState();
        if (!selectedScenarioVersion) {
            setImportStatus({ type: 'error', text: '시나리오 버전을 먼저 선택해주세요.' });
            return;
        }

        setXmlImporting(true);
        setImportStatus(null);
        try {
            const formData = new FormData();
            formData.append('file', xmlImport.file);
            let url = `${import.meta.env.VITE_API_URL}${cfg.xmlExportUrl}/${selectedScenarioVersion.key}/import`;
            if (coords) {
                url += `?latitude=${coords.latitude}&longitude=${coords.longitude}`;
            }
            const res = await fetch(url, { method: 'POST', body: formData });
            const data = await res.json();

            // 좌표 미설정 → 입력 요청
            if (!res.ok && data?.errors?.includes('MISSING_COORDINATES')) {
                setCoordInput({ latitude: '', longitude: '' });
                setXmlImporting(false);
                return;
            }

            if (!res.ok) {
                throw new Error((data?.errors ?? data?.warnings ?? [`서버 오류 ${res.status}`]).join('\n'));
            }
            const responseData = data.network ?? data.data ?? data;
            console.log('[doXmlImport] responseData keys:', Object.keys(responseData ?? {}), 'nodes:', responseData?.nodes?.length, 'links:', responseData?.links?.length);
            assignPropertyToResponseData(responseData);
            cfg.store.getState().setCurrentJsonDataWithFullBuild(responseData);
            cfg.store.getState().setChange(true);
            setImportStatus({ type: 'ok', text: `${cfg.label} XML 가져오기 완료` });
            setXmlImport(null);
            setCoordInput(null);
        } catch (e: unknown) {
            setImportStatus({ type: 'error', text: e instanceof Error ? e.message : 'XML 가져오기 실패' });
        } finally {
            setXmlImporting(false);
        }
    };

    const handleXmlImport = () => {
        if (!xmlImport) return;
        const targetKey = xmlImport.selectedKey || xmlImport.detectedLayer?.key;
        const cfg = LAYER_CONFIG.find(l => l.key === targetKey);
        if (!cfg || !cfg.xmlExportUrl) {
            setImportStatus({ type: 'error', text: '가져올 레이어를 선택해주세요.' });
            return;
        }
        confirmAndImport(() => doXmlImport(cfg));
    };

    const handleCoordSubmit = () => {
        if (!coordInput || !xmlImport) return;
        const lat = parseFloat(coordInput.latitude);
        const lon = parseFloat(coordInput.longitude);
        if (isNaN(lat) || isNaN(lon)) {
            setImportStatus({ type: 'error', text: '올바른 위경도 값을 입력해주세요.' });
            return;
        }
        const targetKey = xmlImport.selectedKey || xmlImport.detectedLayer?.key;
        const cfg = LAYER_CONFIG.find(l => l.key === targetKey);
        if (!cfg) return;
        doXmlImport(cfg, { latitude: lat, longitude: lon });
    };

    // ── JSON 가져오기 ─────────────────────────────────────────────
    const processJsonFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target!.result as string);
                let loaded = 0;

                if (parsed.__iitp_export) {
                    // 전체 내보내기 파일
                    for (const cfg of LAYER_CONFIG) {
                        const layerData = parsed.data?.[cfg.key];
                        if (!layerData) continue;
                        assignPropertyToResponseData(layerData);
                        cfg.store.getState().setCurrentJsonDataWithFullBuild(layerData);
                        cfg.store.getState().setChange(true);
                        loaded++;
                    }
                    setImportStatus({ type: 'ok', text: `${loaded}개 레이어 가져오기 완료` });
                } else if (parsed.__iitp_layer) {
                    // 단일 레이어 파일
                    const cfg = LAYER_CONFIG.find(l => l.key === parsed.__iitp_layer);
                    if (!cfg) {
                        setImportStatus({ type: 'error', text: `알 수 없는 레이어: ${parsed.__iitp_layer}` });
                        return;
                    }
                    assignPropertyToResponseData(parsed.data);
                    cfg.store.getState().setCurrentJsonDataWithFullBuild(parsed.data);
                    cfg.store.getState().setChange(true);
                    setImportStatus({ type: 'ok', text: `${cfg.label} 가져오기 완료` });
                } else {
                    // 메타 정보 없음 — 파일명으로 레이어 추정
                    const detected = detectLayerFromFilename(file.name);
                    if (detected) {
                        // 데이터가 직접 배열이거나 객체인 경우 시도
                        const data = parsed.data ?? parsed;
                        assignPropertyToResponseData(data);
                        detected.store.getState().setCurrentJsonDataWithFullBuild(data);
                        detected.store.getState().setChange(true);
                        setImportStatus({ type: 'ok', text: `${detected.label}(파일명 감지) 가져오기 완료` });
                    } else {
                        setImportStatus({ type: 'error', text: 'IITP 형식 파일이 아닙니다. (__iitp_layer 또는 __iitp_export 키 필요)' });
                    }
                }
            } catch {
                setImportStatus({ type: 'error', text: 'JSON 파싱 오류' });
            }
        };
        reader.readAsText(file);
    };

    // ── 파일 드롭/선택 처리 ───────────────────────────────────────
    const processFile = (file: File) => {
        setImportStatus(null);
        if (file.name.endsWith('.json')) {
            confirmAndImport(() => processJsonFile(file));
        } else if (file.name.endsWith('.xml')) {
            const detected = detectLayerFromFilename(file.name);
            setXmlImport({
                file,
                detectedLayer: detected,
                selectedKey: detected?.key ?? '',
            });
        } else {
            setImportStatus({ type: 'error', text: 'JSON 또는 XML 파일만 지원합니다.' });
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) processFile(file);
    };

    return (
        <>
            <SaveVersionModal
                open={versionModalOpen}
                onConfirm={async (versionKey) => {
                    setVersionModalOpen(false);
                    if (pendingSaveRef.current) {
                        await pendingSaveRef.current(versionKey);
                        pendingSaveRef.current = null;
                    }
                }}
                onCancel={() => {
                    setVersionModalOpen(false);
                    pendingSaveRef.current = null;
                }}
            />
            {!hideHeader && (
                <div className={styles.panelHeader}>
                    <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                        데이터 입출력
                    </span>
                </div>
            )}

            <div className={styles.panelBody}>

                {/* ── 서버 저장 ── */}
                {(section === 'all') && (<>
                    <div style={sectionTitleStyle}>서버 저장</div>
                    {LAYER_CONFIG.map(cfg => (
                        <LayerSaveRow
                            key={cfg.key}
                            label={cfg.label}
                            store={cfg.store as any}
                            saving={savingKeys.has(cfg.key)}
                            onSave={() => handleSaveLayer(cfg)}
                        />
                    ))}
                    <button className={styles.measureBtn} style={{ marginTop: 6 }} onClick={handleSaveAll}>
                        <span className={styles.measureIcon}>💾</span>
                        변경된 레이어 전체 저장
                    </button>
                    <div className={styles.sectionDivider} />
                </>)}

                {/* ── 내보내기 ── */}
                {(section === 'all' || section === 'export') && (<>
                    <div style={sectionTitleStyle}>내보내기</div>
                    {LAYER_CONFIG.map(cfg => (
                        <LayerExportRow
                            key={cfg.key}
                            label={cfg.label}
                            store={cfg.store as any}
                            onExport={() => handleExportLayer(cfg.key)}
                            onExportXml={cfg.xmlExportUrl ? () => handleExportXml(cfg) : undefined}
                            exportingXml={exportingXmlKey === cfg.key}
                        />
                    ))}
                    <button className={styles.measureBtn} style={{ marginTop: 6 }} onClick={handleExportAll}>
                        <span className={styles.measureIcon}>⬇</span>
                        전체 내보내기 (JSON)
                    </button>
                    {section === 'all' && <div className={styles.sectionDivider} />}
                </>)}

                {/* ── 가져오기 ── */}
                {(section === 'all' || section === 'import') && (<>
                    <div style={sectionTitleStyle}>가져오기</div>

                    {/* 드롭존 */}
                    <div
                        style={{
                            ...dropZoneStyle,
                            borderColor: isDragging ? 'rgba(65,105,225,0.7)' : 'rgba(255,255,255,0.12)',
                            background: isDragging ? 'rgba(65,105,225,0.08)' : 'rgba(255,255,255,0.03)',
                        }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.6 }}>⬆</div>
                        <div style={{ fontSize: 11, color: '#888' }}>JSON 또는 XML 파일을 끌어오거나</div>
                        <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,.xml"
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                        />
                    </div>

                    {/* XML 레이어 선택 패널 */}
                    {xmlImport && (
                        <div style={xmlPanelStyle}>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                                <span style={{ color: '#7aa2ff' }}>📄 {xmlImport.file.name}</span>
                            </div>
                            {xmlImport.detectedLayer ? (
                                <div style={{ fontSize: 11, color: '#6fcf97', marginBottom: 8 }}>
                                    ✓ 자동 감지: <strong>{xmlImport.detectedLayer.label}</strong>
                                </div>
                            ) : (
                                <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 6 }}>
                                    파일명으로 레이어를 감지할 수 없습니다. 직접 선택하세요.
                                </div>
                            )}
                            <select
                                style={selectStyle}
                                value={xmlImport.selectedKey}
                                onChange={(e) => setXmlImport(prev => prev ? { ...prev, selectedKey: e.target.value as LayerKey | '' } : null)}
                            >
                                <option value="">— 레이어 선택 —</option>
                                {LAYER_CONFIG.filter(c => c.xmlExportUrl).map(c => (
                                    <option key={c.key} value={c.key}>{c.label}</option>
                                ))}
                            </select>

                            {/* 좌표 입력 (MISSING_COORDINATES 에러 시) */}
                            {coordInput && (
                                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)' }}>
                                    <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 8 }}>
                                        ⚠ 시나리오 기준 좌표가 없습니다. 네트워크 좌표 변환을 위해 입력해주세요.
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>위도 (Latitude)</div>
                                            <input
                                                type="number"
                                                step="any"
                                                placeholder="예: 37.5665"
                                                value={coordInput.latitude}
                                                onChange={e => setCoordInput(prev => prev ? { ...prev, latitude: e.target.value } : null)}
                                                style={coordInputStyle}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>경도 (Longitude)</div>
                                            <input
                                                type="number"
                                                step="any"
                                                placeholder="예: 126.9780"
                                                value={coordInput.longitude}
                                                onChange={e => setCoordInput(prev => prev ? { ...prev, longitude: e.target.value } : null)}
                                                style={coordInputStyle}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                <button
                                    style={cancelSmallBtnStyle}
                                    onClick={() => { setXmlImport(null); setCoordInput(null); }}
                                >
                                    취소
                                </button>
                                <button
                                    style={{
                                        ...importSmallBtnStyle,
                                        opacity: (!xmlImport.selectedKey && !xmlImport.detectedLayer) || xmlImporting ? 0.5 : 1,
                                    }}
                                    onClick={coordInput ? handleCoordSubmit : handleXmlImport}
                                    disabled={(!xmlImport.selectedKey && !xmlImport.detectedLayer) || xmlImporting}
                                >
                                    {xmlImporting ? '가져오는 중…' : coordInput ? '좌표로 가져오기' : 'XML 가져오기'}
                                </button>
                            </div>
                        </div>
                    )}

                    {importStatus && (
                        <div style={{
                            marginTop: 8,
                            padding: '7px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            background: importStatus.type === 'ok' ? 'rgba(0,200,100,0.1)' : 'rgba(220,60,60,0.12)',
                            border: `1px solid ${importStatus.type === 'ok' ? 'rgba(0,200,100,0.3)' : 'rgba(220,60,60,0.3)'}`,
                            color: importStatus.type === 'ok' ? '#4ecb8d' : '#f07070',
                        }}>
                            {importStatus.text}
                        </div>
                    )}

                    <div className={styles.sectionDivider} />
                    <AutoNetworkSection onStatus={setImportStatus} />
                </>)}
            </div>
        </>
    );
};

// ── LayerSaveRow ─────────────────────────────────────────────
const LayerSaveRow: React.FC<{
    label: string;
    store: any;
    saving: boolean;
    onSave: () => void;
}> = ({ label, store, saving, onSave }) => {
    const isChanged = useStore(store as any, (s: any) => s.isChanged) as boolean;
    return (
        <div style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isChanged ? '#f5a623' : '#333',
                    flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, color: isChanged ? '#ddd' : '#555' }}>{label}</span>
            </div>
            <button
                onClick={onSave}
                disabled={!isChanged || saving}
                style={{
                    padding: '3px 10px', fontSize: 10, borderRadius: 4,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: isChanged ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)',
                    color: isChanged ? '#f5a623' : '#444',
                    cursor: isChanged && !saving ? 'pointer' : 'default',
                }}
            >
                {saving ? '저장 중…' : '저장'}
            </button>
        </div>
    );
};

// ── LayerExportRow ───────────────────────────────────────────
const LayerExportRow: React.FC<{
    label: string;
    store: any;
    onExport: () => void;
    onExportXml?: () => void;
    exportingXml?: boolean;
}> = ({ label, store, onExport, onExportXml, exportingXml }) => {
    const hasData = !!store.getState().currentJsonData;
    return (
        <div style={rowStyle}>
            <span style={{ fontSize: 11, color: hasData ? '#aaa' : '#444' }}>{label}</span>
            <div style={{ display: 'flex', gap: 4 }}>
                {onExportXml && (
                    <button
                        onClick={onExportXml}
                        disabled={exportingXml}
                        style={{
                            padding: '3px 10px', fontSize: 10, borderRadius: 4,
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(80,180,100,0.15)',
                            color: exportingXml ? '#555' : '#6ecf8a',
                            cursor: exportingXml ? 'default' : 'pointer',
                        }}
                    >
                        {exportingXml ? '...' : 'XML'}
                    </button>
                )}
                <button
                    onClick={onExport}
                    disabled={!hasData}
                    style={{
                        padding: '3px 10px', fontSize: 10, borderRadius: 4,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: hasData ? 'rgba(65,105,225,0.15)' : 'rgba(255,255,255,0.03)',
                        color: hasData ? '#7aa2ff' : '#444',
                        cursor: hasData ? 'pointer' : 'default',
                    }}
                >
                    JSON
                </button>
            </div>
        </div>
    );
};

// ── 스타일 ────────────────────────────────────────────────────
const sectionTitleStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: '#555',
    letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6,
};

const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const dropZoneStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '18px 12px', borderRadius: 8, border: '1px dashed',
    cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s', gap: 2,
};

const xmlPanelStyle: React.CSSProperties = {
    marginTop: 8,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(65,105,225,0.06)',
    border: '1px solid rgba(65,105,225,0.2)',
};

const selectStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    color: '#c8ccd4',
    fontSize: 12,
    padding: '5px 8px',
    outline: 'none',
    fontFamily: "'Segoe UI', sans-serif",
    cursor: 'pointer',
};

const coordInputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    color: '#c8ccd4',
    fontSize: 12,
    padding: '5px 8px',
    outline: 'none',
};

const cancelSmallBtnStyle: React.CSSProperties = {
    flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#777', cursor: 'pointer',
};

const importSmallBtnStyle: React.CSSProperties = {
    flex: 2, padding: '5px 0', fontSize: 11, borderRadius: 4,
    border: '1px solid rgba(65,105,225,0.45)',
    background: 'rgba(65,105,225,0.2)',
    color: '#7aa2ff', cursor: 'pointer', fontWeight: 600,
};

// ── 자동 네트워크 생성 섹션 ──────────────────────────────────────
const AutoNetworkSection: React.FC<{
    onStatus: (s: { type: 'ok' | 'error'; text: string } | null) => void;
}> = ({ onStatus }) => {
    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();

    const [expanded, setExpanded] = useState(false);
    const [south,    setSouth]    = useState('');
    const [west,     setWest]     = useState('');
    const [north,    setNorth]    = useState('');
    const [east,     setEast]     = useState('');
    const [loading,  setLoading]  = useState(false);

    // bbox 지도 선택 반영
    React.useEffect(() => {
        if (!bbox) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox]);

    const handleGenerate = async () => {
        if (!south || !west || !north || !east) {
            onStatus({ type: 'error', text: '바운딩 박스 좌표를 모두 입력하세요.' });
            return;
        }
        const s = parseFloat(south), n = parseFloat(north);
        const w = parseFloat(west),  e = parseFloat(east);
        if (n - s > 0.2 || e - w > 0.2) {
            onStatus({ type: 'error', text: '영역이 너무 큽니다. 최대 0.2° × 0.2°' });
            return;
        }
        setLoading(true);
        onStatus(null);
        try {
            const formData = new FormData();
            formData.append('south', south);
            formData.append('west',  west);
            formData.append('north', north);
            formData.append('east',  east);

            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/network/import/auto/json`,
                { method: 'POST', body: formData },
            );
            if (!res.ok) {
                const body = await res.text().catch(() => `HTTP ${res.status}`);
                throw new Error(body || `서버 오류 ${res.status}`);
            }
            const resp = await res.json();
            // resp = { network: {...}, signals: [...] }
            const networkData = resp.network ?? resp;
            const signalsData = resp.signals ?? [];

            assignPropertyToResponseData(networkData);
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild(networkData);
            useNetworkStore.getState().setChange(true);

            // 신호 데이터 주입
            if (signalsData.length > 0) {
                assignPropertyToResponseData({ signals: signalsData });
                useSignalStore.getState().setCurrentJsonData({ signals: signalsData });
                useSignalStore.getState().setChange(true);
            }

            const nodeCount   = networkData.nodes?.length   ?? 0;
            const linkCount   = networkData.links?.length   ?? 0;
            const signalCount = signalsData.length;
            onStatus({ type: 'ok', text: `생성 완료 — 노드 ${nodeCount}개, 링크 ${linkCount}개, 신호 ${signalCount}개` });
            setBbox(null);
        } catch (e: unknown) {
            onStatus({ type: 'error', text: e instanceof Error ? e.message : '생성 실패' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <button
                style={{
                    width: '100%', textAlign: 'left', padding: '6px 8px',
                    background: expanded ? 'rgba(65,105,225,0.1)' : 'transparent',
                    border: '1px solid ' + (expanded ? 'rgba(65,105,225,0.3)' : 'rgba(255,255,255,0.08)'),
                    borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onClick={() => setExpanded(v => !v)}
            >
                <span style={{ fontSize: 11, color: '#7aa2ff', fontWeight: 600 }}>
                    ✦ 자동 네트워크 생성
                </span>
                <span style={{ fontSize: 10, color: '#555' }}>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 10, color: '#666', margin: 0, lineHeight: 1.5 }}>
                        선택 영역의 표준노드링크 데이터를 불러옵니다.
                        차선수·제한속도·도로폭 등 속성이 포함됩니다.
                    </p>

                    {/* 영역 선택 버튼 */}
                    {selecting ? (
                        <>
                            <div style={{ fontSize: 10, color: '#ffaa44', lineHeight: 1.5 }}>
                                Shift + 드래그로 영역을 선택하세요<br/>
                                <span style={{ color: '#666' }}>(일반 드래그: 지도 이동)</span>
                            </div>
                            <button
                                style={{ ...autoSmallBtnStyle, borderColor: 'rgba(255,160,50,0.5)', color: '#ffaa44' }}
                                onClick={() => setSelecting(false)}
                            >
                                선택 취소
                            </button>
                        </>
                    ) : (
                        <button style={autoSmallBtnStyle} onClick={() => setSelecting(true)}>
                            지도에서 영역 선택
                        </button>
                    )}

                    {/* 좌표 입력 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                        {([
                            ['남(S)', south, setSouth],
                            ['서(W)', west,  setWest],
                            ['북(N)', north, setNorth],
                            ['동(E)', east,  setEast],
                        ] as [string, string, React.Dispatch<React.SetStateAction<string>>][]).map(([label, val, setter]) => (
                            <div key={label}>
                                <div style={{ fontSize: 10, color: '#666', marginBottom: 2 }}>{label}</div>
                                <input
                                    type="number" step="any" value={val}
                                    onChange={e => setter(e.target.value)}
                                    style={autoInputStyle}
                                />
                            </div>
                        ))}
                    </div>

                    {/* 생성 버튼 */}
                    <button
                        style={{
                            ...importSmallBtnStyle,
                            opacity: loading ? 0.5 : 1,
                            padding: '7px 0',
                        }}
                        onClick={handleGenerate}
                        disabled={loading}
                    >
                        {loading ? '⟳ 생성 중...' : '네트워크 생성'}
                    </button>
                </div>
            )}
        </div>
    );
};

const autoSmallBtnStyle: React.CSSProperties = {
    padding: '5px 10px', fontSize: 10, borderRadius: 4,
    border: '1px solid rgba(65,105,225,0.4)',
    background: 'rgba(65,105,225,0.1)', color: '#7aa2ff',
    cursor: 'pointer', whiteSpace: 'nowrap',
};

const autoInputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4, color: '#ccc', fontSize: 11, padding: '4px 7px', outline: 'none',
};

export default DataIOPanel;
