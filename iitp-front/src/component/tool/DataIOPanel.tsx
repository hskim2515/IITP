import React, { useRef, useState } from 'react';
import styles from '@css/ToolsPanel.module.css';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { usePavementMarkingStore } from '@stores/usePavementMarkingStore';
import { useSignalStore } from '@stores/useSignalStore';
import { assignPropertyToResponseData } from '@utils/guid';

const LAYER_CONFIG = [
    { key: 'network',         label: '네트워크',     store: useNetworkStore },
    { key: 'busStation',      label: '버스 정류장',  store: useBusStationStore },
    { key: 'railStation',     label: '철도 정류장',  store: useRailStationStore },
    { key: 'pavementMarking', label: '노면 표시',    store: usePavementMarkingStore },
    { key: 'signal',          label: '신호',         store: useSignalStore },
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
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    데이터 입출력
                </span>
            </div>

            <div className={styles.panelBody}>
                {/* ── 내보내기 ── */}
                <div style={sectionTitleStyle}>내보내기</div>

                {LAYER_CONFIG.map(cfg => (
                    <LayerExportRow
                        key={cfg.key}
                        label={cfg.label}
                        store={cfg.store}
                        onExport={() => handleExportLayer(cfg.key)}
                    />
                ))}

                <button
                    className={styles.measureBtn}
                    style={{ marginTop: 6 }}
                    onClick={handleExportAll}
                >
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
                        background: importStatus.type === 'ok'
                            ? 'rgba(0,200,100,0.1)'
                            : 'rgba(220,60,60,0.12)',
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

// ── LayerExportRow: 레이어별 현재 데이터 유무 표시 + 내보내기 버튼
const LayerExportRow: React.FC<{
    label: string;
    store: (typeof LAYER_CONFIG)[number]['store'];
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
                    padding: '3px 10px',
                    fontSize: 10,
                    borderRadius: 4,
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
    fontSize: 10,
    fontWeight: 600,
    color: '#555',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginBottom: 6,
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const dropZoneStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px 12px',
    borderRadius: 8,
    border: '1px dashed',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
    gap: 2,
};

export default DataIOPanel;
