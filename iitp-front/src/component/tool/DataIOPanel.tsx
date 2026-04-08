import React, { useRef, useState } from 'react';
import { useStore } from 'zustand';
import styles from '@css/ToolsPanel.module.css';
import { useNetworkStore, useNetworkHistoryStore } from '@stores/useNetworkStore';
import { useBusStationStore, useBusStationHistoryStore } from '@stores/useBusStationStore';
import { useRailStationStore, useRailStationHistoryStore } from '@stores/useRailStationStore';
import { usePavementMarkingStore, usePavementMarkingHistoryStore } from '@stores/usePavementMarkingStore';
import { useSignalStore, useSignalHistoryStore } from '@stores/useSignalStore';
import { useSignalTodStore, useSignalTodHistoryStore } from '@stores/useSignalTodStore';
import { useBusPtLineStore, useBusPtLineWeekdayStore, useBusPtLineWeekendStore,
         useBusPtLineHistoryStore, useBusPtLineWeekdayHistoryStore, useBusPtLineWeekendHistoryStore } from '@stores/useBusPtLineStore';
import { useRailPtLineStore, useRailPtLineHistoryStore } from '@stores/useRailPtLineStore';
import { useSimulationScenarioStore, useSimulationScenarioHistoryStore } from '@stores/useSimulationScenarioStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { mergeUpdateLogs } from '@utils/history';
import SaveVersionModal from '@component/modal/SaveVersionModal';

// ── 전체 레이어 (저장 + 내보내기/가져오기) ───────────────────
const LAYER_CONFIG = [
    { key: 'network',            menuCode: 'NETWORK',             label: '네트워크',           store: useNetworkStore,            historyStore: useNetworkHistoryStore            },
    { key: 'busStation',         menuCode: 'BUS_STATION',         label: '버스 정류장',         store: useBusStationStore,         historyStore: useBusStationHistoryStore         },
    { key: 'railStation',        menuCode: 'RAIL_STATION',        label: '철도 정류장',         store: useRailStationStore,        historyStore: useRailStationHistoryStore        },
    { key: 'pavementMarking',    menuCode: 'PAVEMENT_MARKING',    label: '노면 표시',           store: usePavementMarkingStore,    historyStore: usePavementMarkingHistoryStore    },
    { key: 'signal',             menuCode: 'SIGNAL',              label: '신호',                store: useSignalStore,             historyStore: useSignalHistoryStore             },
    { key: 'signalTod',          menuCode: 'SIGNAL_TOD',          label: '신호 TOD',            store: useSignalTodStore,          historyStore: useSignalTodHistoryStore          },
    { key: 'busRoute',           menuCode: 'BUS_PT_LINE',         label: '버스 노선',           store: useBusPtLineStore,          historyStore: useBusPtLineHistoryStore          },
    { key: 'busRouteWeekday',    menuCode: 'BUS_PT_LINE_WEEKDAY', label: '버스 노선 (평일)',     store: useBusPtLineWeekdayStore,   historyStore: useBusPtLineWeekdayHistoryStore   },
    { key: 'busRouteWeekend',    menuCode: 'BUS_PT_LINE_WEEKEND', label: '버스 노선 (주말)',     store: useBusPtLineWeekendStore,   historyStore: useBusPtLineWeekendHistoryStore   },
    { key: 'railRoute',          menuCode: 'RAIL_PT_LINE',        label: '철도 노선',           store: useRailPtLineStore,         historyStore: useRailPtLineHistoryStore         },
    { key: 'simulationScenario', menuCode: 'SIMULATION_SCENARIO', label: '시뮬레이션 시나리오',  store: useSimulationScenarioStore, historyStore: useSimulationScenarioHistoryStore },
] as const;

type LayerKey = (typeof LAYER_CONFIG)[number]['key'];

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

const DataIOPanel: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importStatus, setImportStatus] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    const pendingSaveRef = useRef<((versionKey: string) => Promise<void>) | null>(null);

    // ── 저장 ──────────────────────────────────────────────────────
    const doSaveLayer = async (cfg: typeof LAYER_CONFIG[number], versionKey: string) => {
        const api = apiConfig[cfg.menuCode as ApiMenuKey]?.update;
        if (!api) return;
        const currentJson = cfg.store.getState().currentJsonData;
        if (!currentJson) return;
        const logJson = cfg.historyStore.getState().updateLogs;
        const snapshotLogJson = cfg.historyStore.getState().snapshotUpdateLogs;
        const mergedLog = mergeUpdateLogs(logJson, snapshotLogJson);
        const extractedArray = Object.values(currentJson as Record<string, unknown>)[0];
        const payload = { data: extractedArray, logs: mergedLog };

        setSavingKeys(prev => new Set(prev).add(cfg.key));
        try {
            await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: payload });
            cfg.historyStore.getState().resetUpdateLogs();
            cfg.store.getState().setChange(false);
            setImportStatus({ type: 'ok', text: `${cfg.label} 저장 완료` });
        } catch (err) {
            setImportStatus({ type: 'error', text: `${cfg.label} 저장 실패` });
        } finally {
            setSavingKeys(prev => { const s = new Set(prev); s.delete(cfg.key); return s; });
        }
    };

    const handleSaveLayer = (cfg: typeof LAYER_CONFIG[number]) => {
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

    // ── 내보내기 ──────────────────────────────────────────────────
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

    // ── 가져오기 ──────────────────────────────────────────────────
    const processFile = (file: File) => {
        if (!file.name.endsWith('.json')) {
            setImportStatus({ type: 'error', text: 'JSON 파일만 지원합니다.' });
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target!.result as string);
                let loaded = 0;

                if (parsed.__iitp_export) {
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
                    setImportStatus({ type: 'error', text: 'IITP 형식 파일이 아닙니다.' });
                }
            } catch {
                setImportStatus({ type: 'error', text: 'JSON 파싱 오류' });
            }
        };
        reader.readAsText(file);
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
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    데이터 입출력
                </span>
            </div>

            <div className={styles.panelBody}>

                {/* ── 서버 저장 ── */}
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

                {/* ── 내보내기 ── */}
                <div style={sectionTitleStyle}>내보내기</div>
                {LAYER_CONFIG.map(cfg => (
                    <LayerExportRow
                        key={cfg.key}
                        label={cfg.label}
                        store={cfg.store as any}
                        onExport={() => handleExportLayer(cfg.key)}
                    />
                ))}
                <button className={styles.measureBtn} style={{ marginTop: 6 }} onClick={handleExportAll}>
                    <span className={styles.measureIcon}>⬇</span>
                    전체 내보내기
                </button>

                <div className={styles.sectionDivider} />

                {/* ── 가져오기 ── */}
                <div style={sectionTitleStyle}>가져오기</div>
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
                    <div style={{ fontSize: 11, color: '#888' }}>JSON 파일을 끌어오거나</div>
                    <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                </div>

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
}> = ({ label, store, onExport }) => {
    const hasData = !!store.getState().currentJsonData;
    return (
        <div style={rowStyle}>
            <span style={{ fontSize: 11, color: hasData ? '#aaa' : '#444' }}>{label}</span>
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
    );
};

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

export default DataIOPanel;
