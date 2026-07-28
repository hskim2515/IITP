import React, { useRef, useState, useCallback, useEffect } from 'react';
import { getActiveVersionId } from "@utils/versionId";
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
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useSignalTimelineStore } from '@stores/useSignalTimelineStore';
import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { mergeUpdateLogs } from '@utils/history';
import SaveVersionModal from '@component/modal/SaveVersionModal';
import { useAppSettingsStore } from '@stores/useAppSettingsStore';
import { useImportProgress, OSM_STEPS } from '@hooks/useImportProgress';
import ImportProgressBar from '@component/util/ImportProgressBar';
import { useMapStore } from '@stores/useMapStore';

// ── 레이어 설정 ─────────────────────────────────────────────────
// xmlExportUrl: XML export/import 엔드포인트 베이스 경로 (null이면 XML 미지원)
// filenameHints: XML 파일명 자동 감지용 키워드
// busRouteWeekday/busRouteWeekend 는 busRoute 보다 먼저 와야 한다 — detectLayerFromFilename 은
// 배열 순서상 첫 매치를 반환하므로, "roadPTline - weekday.xml" 같은 파일이 (더 뒤에 있는) busRoute의
// 일반 'roadptline' 힌트에 먼저 걸려 weekday 구분이 무시되는 것을 방지한다.
export const LAYER_CONFIG = [
    { key: 'network',            menuCode: 'NETWORK',             label: '네트워크',           store: useNetworkStore,            historyStore: useNetworkHistoryStore,            fullData: true,  xmlExportUrl: '/network',                        filenameHints: ['network', '네트워크'] },
    { key: 'busStation',         menuCode: 'BUS_STATION',         label: '버스 정류장',         store: useBusStationStore,         historyStore: useBusStationHistoryStore,         fullData: false, xmlExportUrl: '/public-transit/station/bus',     filenameHints: ['bus_station', 'busstation', '버스정류장', 'bus-station', 'roadstation'] },
    { key: 'railStation',        menuCode: 'RAIL_STATION',        label: '철도 정류장',         store: useRailStationStore,        historyStore: useRailStationHistoryStore,        fullData: false, xmlExportUrl: '/public-transit/station/rail',    filenameHints: ['rail_station', 'railstation', '철도정류장', 'rail-station'] },
    { key: 'pavementMarking',    menuCode: 'PAVEMENT_MARKING',    label: '노면 표시',           store: usePavementMarkingStore,    historyStore: usePavementMarkingHistoryStore,    fullData: false, xmlExportUrl: null,                              filenameHints: ['pavement', '노면'] },
    { key: 'signal',             menuCode: 'SIGNAL',              label: '신호',                store: useSignalStore,             historyStore: useSignalHistoryStore,             fullData: false, xmlExportUrl: '/signal',                         filenameHints: ['signal', '신호'] },
    { key: 'signalTod',          menuCode: 'SIGNAL_TOD',          label: '신호 TOD',            store: useSignalTodStore,          historyStore: useSignalTodHistoryStore,          fullData: true,  xmlExportUrl: '/signal-tod',                     filenameHints: ['signal_tod', 'signaltod', 'signal-tod'] },
    { key: 'busRouteWeekday',    menuCode: 'BUS_PT_LINE_WEEKDAY', label: '버스 노선 (평일)',     store: useBusPtLineWeekdayStore,   historyStore: useBusPtLineWeekdayHistoryStore,   fullData: true,  xmlExportUrl: '/public-transit/line/bus/weekday', filenameHints: ['weekday', '평일'] },
    { key: 'busRouteWeekend',    menuCode: 'BUS_PT_LINE_WEEKEND', label: '버스 노선 (주말)',     store: useBusPtLineWeekendStore,   historyStore: useBusPtLineWeekendHistoryStore,   fullData: true,  xmlExportUrl: '/public-transit/line/bus/weekend', filenameHints: ['weekend', '주말'] },
    { key: 'busRoute',           menuCode: 'BUS_PT_LINE',         label: '버스 노선',           store: useBusPtLineStore,          historyStore: useBusPtLineHistoryStore,          fullData: true,  xmlExportUrl: '/public-transit/line/bus',         filenameHints: ['bus_pt_line', 'busroute', 'bus_route', '버스노선', 'roadptline'] },
    { key: 'railRoute',          menuCode: 'RAIL_PT_LINE',        label: '철도 노선',           store: useRailPtLineStore,         historyStore: useRailPtLineHistoryStore,         fullData: true,  xmlExportUrl: '/public-transit/line/rail',        filenameHints: ['rail_pt_line', 'railroute', 'rail_route', '철도노선', 'railptline'] },
    { key: 'simulationScenario', menuCode: 'SIMULATION_SCENARIO', label: '시뮬레이션 시나리오',  store: useSimulationScenarioStore, historyStore: useSimulationScenarioHistoryStore, fullData: true,  xmlExportUrl: '/simulation-scenario',            filenameHints: ['simulation', 'scenario', '시나리오'] },
] as const;

type LayerKey = (typeof LAYER_CONFIG)[number]['key'];
type LayerCfg = (typeof LAYER_CONFIG)[number];

// ── XML 파일명으로 레이어 자동 감지 ─────────────────────────────
export function detectLayerFromFilename(filename: string): LayerCfg | null {
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

    // 시뮬레이션 결과(vehicle_sim.db) 가져오기 상태
    const [dbUploading, setDbUploading] = useState(false);

    // 좌표 입력 상태 (network XML 가져오기 시 기준점 지정)
    const [coordInput, setCoordInput] = useState<{ latitude: string; longitude: string } | null>(null);

    // network 레이어 선택 시 시나리오 기준 좌표로 coordInput 초기화
    const xmlTargetKey = xmlImport ? (xmlImport.selectedKey || xmlImport.detectedLayer?.key || '') : null;
    useEffect(() => {
        if (xmlTargetKey === 'network') {
            const scen = useScenarioStore.getState().selectedScenario;
            setCoordInput({
                latitude:  scen?.latitude  != null ? String(scen.latitude)  : '',
                longitude: scen?.longitude != null ? String(scen.longitude) : '',
            });
        } else {
            setCoordInput(null);
        }
    }, [xmlTargetKey]);

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
    // 실패 시 throw — SaveVersionModal 이 실패를 인지해야 버전 전환/유령 버전 생성을 막는다.
    const doSaveLayer = async (cfg: LayerCfg, versionKey: string) => {
        // 네트워크는 diff 저장 단일 진입점 — 타일 모드에서 전체 저장은 viewport 일부가
        // 전국 데이터를 덮어쓰므로 금지 (실패 시에도 전체 저장 폴백 없음)
        if (cfg.key === 'network') {
            setSavingKeys(prev => new Set(prev).add(cfg.key));
            try {
                const { saveNetworkDiffTileAware } = await import('@utils/networkDiff');
                const result = await saveNetworkDiffTileAware(versionKey);
                if (result === 'skipped') {
                    setImportStatus({ type: 'error', text: `${cfg.label} diff 저장 불가 — 데이터 없음` });
                    throw new Error(`${cfg.label} diff 저장 불가 — 데이터 없음`);
                }
                cfg.historyStore.getState().resetUpdateLogs();
                setImportStatus({ type: 'ok', text: `${cfg.label} 저장 완료 (diff)` });
            } catch (e) {
                setImportStatus({ type: 'error', text: `${cfg.label} 저장 실패` });
                throw e;
            } finally {
                setSavingKeys(prev => { const s = new Set(prev); s.delete(cfg.key); return s; });
            }
            return;
        }
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
        } catch (e) {
            setImportStatus({ type: 'error', text: `${cfg.label} 저장 실패` });
            throw e;
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
            const url = `${cfg.xmlExportUrl}/${getActiveVersionId()}/export`;
            const response = await axiosInstance({ method: 'GET', url, responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'application/xml' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = `${cfg.key}_${getActiveVersionId()}_${dateTag()}.xml`;
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
            let url = `${import.meta.env.VITE_API_URL}${cfg.xmlExportUrl}/${getActiveVersionId()}/import`;
            if (coords) {
                url += `?latitude=${coords.latitude}&longitude=${coords.longitude}`;
            }
            const res = await fetch(url, { method: 'POST', body: formData });
            const data = await res.json();

            // 좌표 미설정 → 입력 요청 (기준점 미리 초기화된 경우는 빈 값으로 유지)
            if (!res.ok && data?.errors?.includes('MISSING_COORDINATES')) {
                setCoordInput(prev => prev ?? { latitude: '', longitude: '' });
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
        if (coordInput) {
            // network 레이어: 좌표 유효성 검사 후 전달
            const lat = parseFloat(coordInput.latitude);
            const lon = parseFloat(coordInput.longitude);
            if (isNaN(lat) || isNaN(lon)) {
                setImportStatus({ type: 'error', text: '기준점 좌표를 입력하거나 지도에서 선택하세요.' });
                return;
            }
            confirmAndImport(() => doXmlImport(cfg, { latitude: lat, longitude: lon }));
        } else {
            confirmAndImport(() => doXmlImport(cfg));
        }
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

    // ── 시뮬레이션 결과(vehicle_sim.db) 가져오기 ───────────────────
    const doDbImport = async (file: File, versionKey: string) => {
        setDbUploading(true);
        setImportStatus(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const url = `${import.meta.env.VITE_API_URL}/vehicle/upload-db/${versionKey}`;
            const res = await fetch(url, { method: 'POST', body: formData });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error ?? `서버 오류 ${res.status}`);
            }

            // 캐시된 시뮬레이션 결과 초기화 → 다음 재생 시 새 DB로 재생성
            useVehicleStore.setState({ czml: '', vehicleRoute: '', features: '' });
            useSimulationStore.getState().reset();
            useSignalTimelineStore.getState().setSignalTimeline([]);

            setImportStatus({ type: 'ok', text: '시뮬레이션 결과(vehicle_sim.db) 가져오기 완료' });
        } catch (e: unknown) {
            setImportStatus({ type: 'error', text: e instanceof Error ? e.message : 'DB 가져오기 실패' });
        } finally {
            setDbUploading(false);
        }
    };

    const processDbFile = (file: File) => {
        const { selectedScenarioVersion } = useScenarioStore.getState();
        if (!selectedScenarioVersion) {
            setImportStatus({ type: 'error', text: '시나리오 버전을 먼저 선택해주세요.' });
            return;
        }
        setMessage({
            type: 'confirm',
            text: '시뮬레이션 결과 파일(vehicle_sim.db)을 교체합니다.\n기존 차량 경로 데이터는 삭제되고 다음 재생 시 새 파일로 다시 생성됩니다.\n계속할까요?',
            onConfirm: () => doDbImport(file, getActiveVersionId() ?? ""),
            onCancel: () => {},
        });
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
        } else if (file.name.endsWith('.db')) {
            processDbFile(file);
        } else {
            setImportStatus({ type: 'error', text: 'JSON, XML 또는 DB 파일만 지원합니다.' });
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
                    // 저장 성공 후에만 모달 닫기 — 실패 시 모달이 에러를 표시해야 함
                    if (pendingSaveRef.current) {
                        await pendingSaveRef.current(versionKey);
                        pendingSaveRef.current = null;
                    }
                    setVersionModalOpen(false);
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
                            opacity: dbUploading ? 0.6 : 1,
                            pointerEvents: dbUploading ? 'none' : undefined,
                        }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.6 }}>⬆</div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                            {dbUploading ? 'vehicle_sim.db 업로드 중…' : 'JSON, XML 또는 DB 파일을 끌어오거나'}
                        </div>
                        <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,.xml,.db"
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

                            {/* 좌표 입력 (network XML 가져오기 시 기준점 지정) */}
                            {coordInput && (
                                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(80,120,255,0.06)', border: '1px solid rgba(80,120,255,0.25)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <div style={{ fontSize: 11, color: '#8aaaee' }}>기준점 좌표 (배치 위치)</div>
                                        <button
                                            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(80,140,255,0.15)', border: '1px solid rgba(80,140,255,0.4)', color: '#7ab0ff', lineHeight: 1.6 }}
                                            onClick={() => {
                                                useMapStore.getState().startCoordPick((lat, lng) => {
                                                    setCoordInput({
                                                        latitude:  lat.toFixed(7),
                                                        longitude: lng.toFixed(7),
                                                    });
                                                });
                                            }}
                                        >
                                            지도에서 선택
                                        </button>
                                    </div>
                                    {!coordInput.latitude && !coordInput.longitude && (
                                        <div style={{ fontSize: 10, color: '#f5a623', marginBottom: 6 }}>
                                            ⚠ 시나리오 기준 좌표가 없습니다. 직접 입력하거나 지도에서 선택하세요.
                                        </div>
                                    )}
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
                                    onClick={handleXmlImport}
                                    disabled={(!xmlImport.selectedKey && !xmlImport.detectedLayer) || xmlImporting}
                                >
                                    {xmlImporting ? '가져오는 중…' : 'XML 가져오기'}
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
                    <OsmNetworkSection onStatus={setImportStatus} />
                    <div style={{ marginTop: 8 }} />
                    <SumoNetworkSection onStatus={setImportStatus} />
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

// ── 시설물 응답 → 스토어 일괄 주입 헬퍼 ─────────────────────────────
function injectFacilities(data: any) {
    if (!data) return;
    // 버스 정류장
    const busStations = data.busStations;
    if (busStations?.busStations?.length > 0) {
        assignPropertyToResponseData(busStations);
        useBusStationStore.getState().setCurrentJsonDataWithFullBuild(busStations);
        useBusStationStore.getState().setChange(true);
    }
    // 철도역
    const railStations = data.railStations;
    if (railStations?.railStations?.length > 0) {
        assignPropertyToResponseData(railStations);
        useRailStationStore.getState().setCurrentJsonDataWithFullBuild(railStations);
        useRailStationStore.getState().setChange(true);
    }
    // 버스 노선
    const busRoutes = data.busRoutes;
    if (busRoutes?.lines?.length > 0) {
        assignPropertyToResponseData(busRoutes);
        useBusPtLineStore.getState().setCurrentJsonDataWithFullBuild(busRoutes);
        useBusPtLineStore.getState().setChange(true);
    }
    // 철도 노선
    const railRoutes = data.railRoutes;
    if (railRoutes?.routes?.length > 0) {
        assignPropertyToResponseData(railRoutes);
        useRailPtLineStore.getState().setCurrentJsonDataWithFullBuild(railRoutes);
        useRailPtLineStore.getState().setChange(true);
    }
    // 신호
    const signals = data.signals ?? [];
    if (signals.length > 0) {
        const signalData = { signals };
        assignPropertyToResponseData(signalData);
        useSignalStore.getState().setCurrentJsonData(signalData);
        useSignalStore.getState().setChange(true);
    }
}

// ── OSM 네트워크 생성 섹션 ────────────────────────────────────────
const OsmNetworkSection: React.FC<{
    onStatus: (s: { type: 'ok' | 'error'; text: string } | null) => void;
}> = ({ onStatus }) => {
    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();
    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const [expanded, setExpanded] = useState(false);
    const [south,    setSouth]    = useState('');
    const [west,     setWest]     = useState('');
    const [north,    setNorth]    = useState('');
    const [east,     setEast]     = useState('');
    const [loading,  setLoading]  = useState(false);
    const { progress, start: startProgress, finish: finishProgress, reset: resetProgress } = useImportProgress(OSM_STEPS);

    React.useEffect(() => {
        if (!bbox || !expanded) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox, expanded]);

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
        startProgress();
        onStatus(null);
        try {
            const versionId = getActiveVersionId() ?? '';
            const formData = new FormData();
            formData.append('south', south);
            formData.append('west',  west);
            formData.append('north', north);
            formData.append('east',  east);
            if (versionId) formData.append('versionId', versionId);
            // OD 매트릭스/버스·철도 시설물 자동생성 파라미터 — 앱 설정(⚙ → 자동생성 설정)에서 사용자가 조정한 값
            {
                const {
                    odMinFlow, odMaxFlow, odRefDistM,
                    busFacilityEnabled, railFacilityEnabled, busDefaultIntervalMin,
                } = useAppSettingsStore.getState().autoGeneration;
                formData.append('odMinFlow', String(odMinFlow));
                formData.append('odMaxFlow', String(odMaxFlow));
                formData.append('odRefDistM', String(odRefDistM));
                formData.append('generateBusFacilities', String(busFacilityEnabled));
                formData.append('generateRailFacilities', String(railFacilityEnabled));
                formData.append('busDefaultIntervalMin', String(busDefaultIntervalMin));
            }

            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/network/import/ktdb/save`,
                { method: 'POST', body: formData });
            if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));

            const data = await res.json();
            const networkData = data.network;
            if (!networkData) throw new Error('네트워크 데이터를 받지 못했습니다.');
            assignPropertyToResponseData(networkData);
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild(networkData);
            useNetworkStore.getState().setChange(true);
            finishProgress();

            const signalsData = data.signals ?? [];
            if (signalsData.length > 0) {
                assignPropertyToResponseData({ signals: signalsData });
                useSignalStore.getState().setCurrentJsonData({ signals: signalsData });
                useSignalStore.getState().setChange(true);
            }

            const nodeCount = networkData.nodes?.length ?? 0;
            const linkCount = networkData.links?.length ?? 0;
            onStatus({ type: 'ok', text: `표준 노드링크 완료 — 노드 ${nodeCount}개, 링크 ${linkCount}개` });
            setBbox(null);
        } catch (e: unknown) {
            resetProgress();
            onStatus({ type: 'error', text: e instanceof Error ? e.message : '표준 노드링크 생성 실패' });
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
                    📍 표준 노드링크 가져오기
                </span>
                <span style={{ fontSize: 10, color: '#555' }}>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 10, color: '#666', margin: 0, lineHeight: 1.5 }}>
                        표준 노드링크 데이터로 네트워크를 생성합니다.
                        차선수·제한속도·도로폭 등 속성이 포함됩니다.
                    </p>

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

                    <button
                        style={{ ...importSmallBtnStyle, opacity: loading ? 0.5 : 1, padding: '7px 0' }}
                        onClick={handleGenerate}
                        disabled={loading}
                    >
                        {loading ? '변환 중...' : '표준 노드링크 가져오기'}
                    </button>
                    <ImportProgressBar progress={progress} />
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

// ── OSM 가져오기 섹션 ──────────────────────────────────────────
const SumoNetworkSection: React.FC<{
    onStatus: (s: { type: 'ok' | 'error'; text: string } | null) => void;
}> = ({ onStatus }) => {
    const { selecting, bbox, setSelecting, setBbox } = useOsmBboxStore();
    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const [expanded, setExpanded] = useState(false);
    const [south,    setSouth]    = useState('');
    const [west,     setWest]     = useState('');
    const [north,    setNorth]    = useState('');
    const [east,     setEast]     = useState('');
    const [loading,  setLoading]  = useState(false);
    const { progress: sumoProgress, start: startSumoProgress, finish: finishSumoProgress, reset: resetSumoProgress } = useImportProgress(OSM_STEPS);

    React.useEffect(() => {
        if (!bbox || !expanded) return;
        setSouth(bbox.south.toFixed(6));
        setWest(bbox.west.toFixed(6));
        setNorth(bbox.north.toFixed(6));
        setEast(bbox.east.toFixed(6));
    }, [bbox, expanded]);

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
        startSumoProgress();
        onStatus(null);
        try {
            const versionId = getActiveVersionId() ?? '';
            const params = new URLSearchParams({ south, west, north, east });
            const scenLat = selectedScenario?.latitude;
            const scenLon = selectedScenario?.longitude;
            if (scenLat && scenLat !== 0) params.append('baseLat', String(scenLat));
            if (scenLon && scenLon !== 0) params.append('baseLon', String(scenLon));
            if (versionId) params.append('versionId', versionId);

            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/network/import/sumo/save?${params}`);
            if (!res.ok) {
                const body = await res.text().catch(() => `HTTP ${res.status}`);
                throw new Error(body || `서버 오류 ${res.status}`);
            }
            const data = await res.json();
            const networkData = data.network;
            if (!networkData) throw new Error('네트워크 데이터를 받지 못했습니다.');
            assignPropertyToResponseData(networkData);
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild(networkData);
            useNetworkStore.getState().setChange(true);
            injectFacilities(data);
            finishSumoProgress();

            const nodeCount  = networkData.nodes?.length ?? 0;
            const linkCount  = networkData.links?.length ?? 0;
            const busCount   = data.busStations?.busStations?.length ?? 0;
            const railCount  = data.railStations?.railStations?.length ?? 0;
            const sigCount   = data.signals?.length ?? 0;
            onStatus({ type: 'ok', text: `OSM 생성 완료 — 노드 ${nodeCount}개, 링크 ${linkCount}개, 신호 ${sigCount}개, 버스정류장 ${busCount}개, 철도역 ${railCount}개` });

            setBbox(null);
        } catch (e: unknown) {
            resetSumoProgress();
            onStatus({ type: 'error', text: e instanceof Error ? e.message : 'OSM 생성 실패' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <button
                style={{
                    width: '100%', textAlign: 'left', padding: '6px 8px',
                    background: expanded ? 'rgba(100,65,225,0.1)' : 'transparent',
                    border: '1px solid ' + (expanded ? 'rgba(100,65,225,0.3)' : 'rgba(255,255,255,0.08)'),
                    borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onClick={() => setExpanded(v => !v)}
            >
                <span style={{ fontSize: 11, color: '#aa88ff', fontWeight: 600 }}>
                    🗺 OSM 가져오기
                </span>
                <span style={{ fontSize: 10, color: '#555' }}>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 10, color: '#666', margin: 0, lineHeight: 1.5 }}>
                        OpenStreetMap 도로 데이터를 SUMO netconvert로 변환합니다.
                        교차로 차선 연결이 정밀 생성됩니다. (Docker 필요)
                    </p>

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
                        <button
                            style={{ ...autoSmallBtnStyle, borderColor: 'rgba(100,65,225,0.4)', color: '#aa88ff' }}
                            onClick={() => setSelecting(true)}
                        >
                            지도에서 영역 선택
                        </button>
                    )}

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

                    <button
                        style={{
                            ...importSmallBtnStyle,
                            opacity: loading ? 0.5 : 1,
                            padding: '7px 0',
                            borderColor: 'rgba(100,65,225,0.45)',
                            background: 'rgba(100,65,225,0.2)',
                            color: '#aa88ff',
                        }}
                        onClick={handleGenerate}
                        disabled={loading}
                    >
                        {loading ? 'netconvert 실행 중...' : 'OSM 가져오기'}
                    </button>
                    <ImportProgressBar progress={sumoProgress} color="#aa88ff" />
                </div>
            )}
        </div>
    );
};

export default DataIOPanel;
