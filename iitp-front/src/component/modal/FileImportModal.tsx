import React, { useRef, useState, useEffect } from 'react';
import JSZip from 'jszip';
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
import { useMapStore } from '@stores/useMapStore';
import { useAppSettingsStore } from '@stores/useAppSettingsStore';
import { showConfirm } from '@utils/dialog';
import { NETWORK_TILING } from '@utils/lodConstants';
import { generateDummySignals } from '@utils/signal';
import { pollKtdbScaffoldStatus } from '@utils/ktdbScaffold';
import { runAutoDummyGeneration } from '@utils/dummyGeneration';
import { parseBoundaryFile } from '@utils/boundaryFile';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useSignalTimelineStore } from '@stores/useSignalTimelineStore';

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Tab = 'file' | 'osm' | 'ktdb' | 'reanchor';
type ImportType = 'osm' | 'ktdb';
type LayerCfg = (typeof LAYER_CONFIG)[number];

type LatLon = { lat: number; lon: number };
type ReanchorMode = 'move' | 'calibrate';
/** 2점 캘리브레이션의 4개 클릭 슬롯 — src=네트워크 상 현재 위치, dst=실제로 있어야 할 위치 */
type CalibKey = 'srcA' | 'dstA' | 'srcB' | 'dstB';

interface Props {
    onClose: () => void;
}

// ── 공유 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * XML 업로드(멀티파트 POST .../import)를 실제로 지원하는 레이어.
 * 모든 LAYER_CONFIG 레이어는 이제 백엔드에 POST .../import 멀티파트 엔드포인트가 있다
 * (network는 NetworkController, 나머지는 각 컨트롤러의 기존 JAXB 파서를 재사용해 추가).
 */
const XML_IMPORT_SUPPORTED_KEYS = new Set<string>([
    'network', 'busStation', 'railStation', 'signal', 'signalTod',
    'busRoute', 'busRouteWeekday', 'busRouteWeekend', 'railRoute', 'simulationScenario',
]);

/**
 * LAYER_CONFIG(스토어 기반 레이어)에 속하지 않는 XML 업로드 전용 레이어.
 * OD 매트릭스는 지도/시설물 레이어가 아니라 OdMatrixModal이 자체 로컬 state로 관리하므로
 * Zustand 스토어가 없다 — 업로드 성공 시 스토어 반영 없이 서버 저장만 하고, 모달을 다시 열면
 * GET /od-matrix/{versionId}로 새로 읽어온다.
 */
const STORELESS_XML_IMPORTS: Record<string, { url: string; label: string; rootTag: string }> = {
    odmatrix: { url: '/od-matrix', label: 'OD 매트릭스', rootTag: 'Demands' },
};

/** 단일 레이어 JSON 데이터를 스토어에 반영 (GUID 부여 + 전체 빌드 + 변경 플래그) */
function applyLayerData(cfg: LayerCfg, data: any): void {
    assignPropertyToResponseData(data);
    cfg.store.getState().setCurrentJsonDataWithFullBuild(data);
    cfg.store.getState().setChange(true);
}

/** __iitp_export 통합 JSON(여러 레이어 묶음)을 LAYER_CONFIG 순서대로 반영 */
function applyCombinedExport(data: any): { loaded: number; networkLoaded: boolean; signalLoaded: boolean } {
    let loaded = 0, networkLoaded = false, signalLoaded = false;
    for (const cfg of LAYER_CONFIG) {
        const layerData = data?.[cfg.key];
        if (!layerData) continue;
        applyLayerData(cfg, layerData);
        if (cfg.key === 'network') networkLoaded = true;
        if (cfg.key === 'signal') signalLoaded = true;
        loaded++;
    }
    return { loaded, networkLoaded, signalLoaded };
}

/**
 * XML 루트 엘리먼트(태그명) → 레이어 키. 백엔드 JAXB @XmlRootElement 와 정확히 일치한다
 * (model/network/NetworkXml.java 의 "Network", model/signal/SignalXml.java 의 "Signal" 등).
 * 파일명 규칙은 배포판마다 다를 수 있지만(예: 이 프로젝트의 bucheon 배포판은 "road"=버스,
 * "rail"=철도 접두어를 씀) 루트 태그는 고정 스키마이므로 훨씬 신뢰할 수 있는 판별 기준이다.
 * 'Lines' 는 busRoute/busRouteWeekday/busRouteWeekend 세 레이어가 전부 공유 — 평일/주말
 * 구분은 스키마에 없는 정보라 그 경우만 파일명 토큰으로 보완한다.
 */
const XML_ROOT_TO_LAYER_KEY: Record<string, string> = {
    Network: 'network',
    PublicTransit: 'busStation',
    RailPublicTransit: 'railStation',
    Signal: 'signal',
    TOD: 'signalTod',
    Mode: 'railRoute',
    Scenarios: 'simulationScenario',
};

/** XML 텍스트 앞부분만 스캔해 루트 엘리먼트 태그명을 추출 (대용량 파일 전체 DOM 파싱 회피) */
function xmlRootElementName(text: string): string | null {
    const head = text.slice(0, 2000);
    const m = head.match(/<\?xml[^>]*\?>\s*(?:<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w.-]*)/);
    return m?.[1] ?? null;
}

/** 스키마(루트 엘리먼트)로 먼저 판별하고, 실패하거나 모호(Lines)하면 파일명 힌트로 보완 */
function detectLayerFromXml(filename: string, text: string): LayerCfg | null {
    const root = xmlRootElementName(text);
    if (root === 'Lines') {
        const lower = filename.toLowerCase();
        const wantKey = lower.includes('weekday') || lower.includes('평일') ? 'busRouteWeekday'
            : lower.includes('weekend') || lower.includes('주말') ? 'busRouteWeekend'
                : 'busRoute';
        return LAYER_CONFIG.find(c => c.key === wantKey) ?? null;
    }
    if (root && XML_ROOT_TO_LAYER_KEY[root]) {
        return LAYER_CONFIG.find(c => c.key === XML_ROOT_TO_LAYER_KEY[root]) ?? null;
    }
    // 알 수 없는 루트(커스텀 배포판 등) — 파일명 힌트로 폴백
    return detectLayerFromFilename(filename);
}

/** LAYER_CONFIG(스토어 기반) 밖의 XML 업로드 전용 레이어(현재 odmatrix)를 루트 태그로 감지 */
function detectStorelessXmlImport(text: string): { key: string; url: string; label: string } | null {
    const root = xmlRootElementName(text);
    for (const [key, cfg] of Object.entries(STORELESS_XML_IMPORTS)) {
        if (root === cfg.rootTag) return { key, url: cfg.url, label: cfg.label };
    }
    return null;
}

/** XML 파일을 서버로 업로드해 파싱시키고, 응답을 해당 레이어 스토어에 반영 */
async function importXmlToLayer(cfg: LayerCfg, file: File, versionId: string): Promise<void> {
    if (!cfg.xmlExportUrl) throw new Error(`${cfg.label}은(는) XML 가져오기를 지원하지 않습니다`);
    if (!XML_IMPORT_SUPPORTED_KEYS.has(cfg.key)) {
        throw new Error(`${cfg.label}은(는) 아직 XML 업로드를 지원하지 않습니다 (JSON으로 내보내 가져오세요)`);
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(
        `${import.meta.env.VITE_API_URL}${cfg.xmlExportUrl}/${versionId}/import`,
        { method: 'POST', body: formData }
    );
    if (!res.ok) {
        // 루트 태그가 맞아도 안쪽 내용이 스키마와 안 맞으면(잘림/오염/구조 불일치) 여기서 실패한다.
        // 백엔드는 검증 실패 시 {errors:[...]}(422), 파싱 자체가 깨지면 GlobalExceptionHandler 의
        // ProblemDetail{detail:"..."}(500) 을 준다 — 둘 다 읽어서 상태 코드보다 유용한 메시지를 보여준다.
        const body = await res.json().catch(() => null);
        const detail = Array.isArray(body?.errors) && body.errors.length > 0
            ? body.errors.join('; ')
            : (body?.detail ?? body?.message);
        throw new Error(detail || `서버 오류 ${res.status}`);
    }
    const data = await res.json();
    const responseData = data.network ?? data.data ?? data;

    // 타일 모드에서 network 를 그대로 store 에 전체 반영하면 안 된다 — 서버는 이미
    // XML 저장 + 타일 재적재까지 끝냈는데, currentJsonData 에 전체 네트워크(수만 링크)를
    // 채우는 순간 NetworkFeatureLayer.updateEditDeltas() 가 "타일 캐시에 아직 없는 링크"를
    // 전부 미저장 편집으로 오인해 편집 오버레이로 전체 네트워크를 다시 그린다 — 기존
    // 타일 렌더링과 겹쳐 보이는 원인(실측 재현: 뷰포트 5,454개 → 전체빌드 51,637개로 폭증,
    // 전부 미저장-편집 오버레이 guid 로 확인됨). 빈 마커로 두면 타일 매니저가 뷰포트를
    // 새로 fetch 해 정상 반영된다(호출부의 refreshNetworkTiles 가 트리거).
    if (cfg.key === 'network' && (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode)) {
        useNetworkStore.getState().setCurrentJsonData({ id: 0, name: null, nodes: [], links: [] } as any);
        return;
    }
    applyLayerData(cfg, responseData);
}

/** 스토어 없는 레이어(odmatrix)의 XML 업로드 — 서버 저장만 하고 화면에는 반영하지 않는다 */
async function importStorelessXml(url: string, file: File, versionId: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(
        `${import.meta.env.VITE_API_URL}${url}/${versionId}/import`,
        { method: 'POST', body: formData }
    );
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = Array.isArray(body?.errors) && body.errors.length > 0
            ? body.errors.join('; ')
            : (body?.detail ?? body?.message);
        throw new Error(detail || `서버 오류 ${res.status}`);
    }
}

/**
 * 시뮬레이션 결과(vehicle_sim.db) 업로드 — DataIOPanel.tsx의 doDbImport와 동일한 엔드포인트/캐시
 * 초기화. SQLite 매직 헤더 + 스키마(VehicleEvent/VehicleEventDebugging/vehicle_sim) 검증은
 * 백엔드(VehicleController.uploadVehicleSimDb)가 수행한다.
 */
async function importVehicleSimDb(file: File, versionId: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(
        `${import.meta.env.VITE_API_URL}/vehicle/upload-db/${versionId}`,
        { method: 'POST', body: formData }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(body?.error ?? `서버 오류 ${res.status}`);
    }
    // 캐시된 시뮬레이션 결과 초기화 → 다음 재생 시 새 DB로 재생성
    useVehicleStore.setState({ czml: '', vehicleRoute: '', features: '' });
    useSimulationStore.getState().reset();
    useSignalTimelineStore.getState().setSignalTimeline([]);
}

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
    const { selecting, setSelecting, selectingPolygon, setSelectingPolygon } = useOsmBboxStore();
    // 기준점 재설정 탭에서 "지도에서 선택" 클릭 시 true — BboxTab의 selecting과 동일하게
    // 풀스크린 오버레이를 잠깐 걷어내 지도 클릭이 오버레이가 아니라 지도(useCoordPick)로
    // 전달되게 한다 (선택 후 콜백에서 다시 false로 돌아옴).
    // picking 중엔 아래에서 모달 전체를 렌더하지 않아(return null) ReanchorTab이 그 사이
    // 언마운트된다 — 선택 도중 쌓이는 상태(모드, 좌표들)를 ReanchorTab의 로컬 state에 두면
    // 매 클릭마다 재마운트되며 초기화되므로 전부 여기(부모)로 끌어올려 보존한다
    // (BboxTab이 좌표를 zustand 스토어에 두는 것과 같은 이유 — 캘리브레이션은 4번 연속 클릭이
    // 필요해서 이 문제가 특히 치명적이다).
    const [pickingReanchor, setPickingReanchor] = useState(false);
    const [reanchorMode, setReanchorMode] = useState<ReanchorMode>('move');
    const [reanchorPicked, setReanchorPicked] = useState<LatLon | null>(null);
    const [calibPoints, setCalibPoints] = useState<Record<CalibKey, LatLon | null>>({
        srcA: null, dstA: null, srcB: null, dstB: null,
    });

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (selecting) setSelecting(false);
                else if (selectingPolygon) setSelectingPolygon(false);
                else if (pickingReanchor) { useMapStore.getState().cancelCoordPick(); setPickingReanchor(false); }
                else onClose();
            }
        };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [onClose, selecting, setSelecting, selectingPolygon, setSelectingPolygon, pickingReanchor]);

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
    // KTDB 폴리곤 그리기 중: 위와 동일한 이유로 overlay 를 걷어내야 한다 — 안 그러면
    // 모달의 풀스크린 overlay(onClick=onClose)가 지도 클릭을 가로채 useKtdbPolygonDraw 의
    // OL Draw 인터랙션에 클릭이 전혀 전달되지 않는다("버튼 눌러도 그려지지 않음", 사용자 보고).
    if (selectingPolygon) {
        return createPortal(
            <div style={selectingBannerStyle}>
                <span style={{ fontSize: 13, color: '#e0e0e0' }}>지도를 클릭해 폴리곤 꼭짓점을 추가하고, 더블클릭으로 완성하세요</span>
                <button style={cancelSelectBtnStyle} onClick={() => setSelectingPolygon(false)}>취소</button>
            </div>,
            document.body
        );
    }
    // 기준점 재설정용 지도 클릭 대기 중: Maps.tsx가 coordPickCallback 활성화 시 자체
    // 배너("지도를 클릭하여 네트워크 기준점을 선택하세요", ESC 취소 힌트)를 이미 띄우므로
    // 여기서는 오버레이만 걷어내고 별도 배너는 그리지 않는다(중복 방지).
    if (pickingReanchor) {
        return null;
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
                    {([['ktdb', 'KTDB'], ['osm', 'OSM'], ['file', '파일'], ['reanchor', '기준점']] as [Tab, string][]).map(([key, label]) => (
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
                    {tab === 'file'     && <FileTab onClose={onClose} />}
                    {tab === 'osm'      && <BboxTab type="osm"  onClose={onClose} />}
                    {tab === 'ktdb'     && <BboxTab type="ktdb" onClose={onClose} />}
                    {tab === 'reanchor' && (
                        <ReanchorTab
                            picking={pickingReanchor} setPicking={setPickingReanchor}
                            mode={reanchorMode} setMode={setReanchorMode}
                            picked={reanchorPicked} setPicked={setReanchorPicked}
                            calibPoints={calibPoints}
                            setCalibPoint={(key, v) => setCalibPoints(prev => ({ ...prev, [key]: v }))}
                            resetCalib={() => setCalibPoints({ srcA: null, dstA: null, srcB: null, dstB: null })}
                        />
                    )}
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
        detectedStoreless?: { key: string; label: string };
        selectedKey: string;
    } | null>(null);
    const [zipProcessing, setZipProcessing] = useState(false);
    const [zipProgress, setZipProgress] = useState('');
    const [zipResults, setZipResults] = useState<{ name: string; status: 'ok' | 'error' | 'skipped'; text: string }[] | null>(null);
    const [dbImport, setDbImport] = useState<{ file: File } | null>(null);
    const [dbUploading, setDbUploading] = useState(false);

    const processJsonFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parsed = JSON.parse(e.target!.result as string);
                const versionKey = getActiveVersionId() ?? '';
                let networkLoaded = false;
                let signalLoaded = false;
                if (parsed.__iitp_export) {
                    const hasNetwork = !!parsed.data?.network;
                    if (hasNetwork && versionKey) await backupAndResetDependentLayers(versionKey);
                    const result = applyCombinedExport(parsed.data);
                    networkLoaded = result.networkLoaded;
                    signalLoaded = result.signalLoaded;
                    setStatus({ type: 'ok', text: `${result.loaded}개 레이어 가져오기 완료 — 저장 중...` });
                } else if (parsed.__iitp_layer) {
                    const cfg = LAYER_CONFIG.find(l => l.key === parsed.__iitp_layer);
                    if (!cfg) { setStatus({ type: 'error', text: `알 수 없는 레이어: ${parsed.__iitp_layer}` }); return; }
                    if (cfg.key === 'network' && versionKey) await backupAndResetDependentLayers(versionKey);
                    applyLayerData(cfg, parsed.data);
                    if (cfg.key === 'network') networkLoaded = true;
                    setStatus({ type: 'ok', text: `${cfg.label} 가져오기 완료 — 저장 중...` });
                } else {
                    const detected = detectLayerFromFilename(file.name);
                    if (detected) {
                        const data = parsed.data ?? parsed;
                        if (detected.key === 'network' && versionKey) await backupAndResetDependentLayers(versionKey);
                        applyLayerData(detected, data);
                        if (detected.key === 'network') networkLoaded = true;
                        setStatus({ type: 'ok', text: `${detected.label}(파일명 감지) 가져오기 완료 — 저장 중...` });
                    } else {
                        setStatus({ type: 'error', text: '__iitp_layer 또는 __iitp_export 키가 없습니다' });
                        return;
                    }
                }
                if (versionKey) await autoSaveChangedLayers(versionKey);
                // 신호 데이터도 함께 임포트됐으면 자동 생성 불필요 — 없으면 조용히 자동 생성
                if (networkLoaded && !signalLoaded) void runAutoDummyGeneration();
                setStatus(s => s ? { ...s, text: s.text.replace(' — 저장 중...', ' — 서버 저장 완료') } : null);
            } catch { setStatus({ type: 'error', text: 'JSON 파싱 오류' }); }
        };
        reader.readAsText(file);
    };

    // ── ZIP 일괄 가져오기 ──────────────────────────────────────────────────
    // 압축 안의 각 파일을 파일명/내용으로 스키마 자동 매칭해 일괄 반영한다.
    // network 를 건드리는 항목(단일 network.xml/json 또는 network 를 포함한 통합 __iitp_export)은
    // 다른 레이어보다 먼저 처리해 backupAndResetDependentLayers 를 한 번만 태운다 —
    // 순서가 뒤바뀌면 나중에 로드된 의존 레이어(신호 등)가 리셋으로 날아간다.
    type ZipMatch =
        | { entry: JSZip.JSZipObject; cfg: LayerCfg; kind: 'xml'; text: string }
        | { entry: JSZip.JSZipObject; cfg: LayerCfg; kind: 'json'; parsed: any }
        | { entry: JSZip.JSZipObject; kind: 'combined'; parsed: any }
        | { entry: JSZip.JSZipObject; kind: 'xml-storeless'; key: string; url: string; label: string; text: string }
        | { entry: JSZip.JSZipObject; kind: 'db'; blob: Blob };

    const touchesNetwork = (m: ZipMatch) =>
        m.kind === 'combined' ? !!m.parsed?.data?.network : (m.kind === 'xml-storeless' || m.kind === 'db') ? false : m.cfg.key === 'network';

    const processZipFile = async (file: File) => {
        setZipResults(null);
        setZipProcessing(true);
        setZipProgress('압축 해제 중...');
        const versionId = getActiveVersionId() ?? '';
        const results: { name: string; status: 'ok' | 'error' | 'skipped'; text: string }[] = [];
        try {
            if (!versionId) throw new Error('시나리오가 선택되지 않았습니다');
            const zip = await JSZip.loadAsync(file);
            // macOS 압축 시 끼어드는 메타데이터(__MACOSX/, AppleDouble ._*) 는 실제 콘텐츠가
            // 아니므로 완전히 제외 — 안 걸러내면 "._network.xml" 같은 파일이 파일명 힌트에
            // 우연히 걸려(예: 'network' 포함) 서버로 잘못 업로드되어 방금 반영한 정상 데이터를
            // 깨뜨릴 수 있다(실제로 500 오류 유발 확인됨).
            const entries = Object.values(zip.files).filter(f => {
                if (f.dir) return false;
                const base = f.name.split('/').pop() ?? f.name;
                return !f.name.startsWith('__MACOSX/') && !base.startsWith('._');
            });

            const matched: ZipMatch[] = [];
            for (const entry of entries) {
                const base = entry.name.split('/').pop() ?? entry.name;
                const lower = base.toLowerCase();
                if (lower.endsWith('.xml')) {
                    const text = await entry.async('text');
                    const storeless = detectStorelessXmlImport(text);
                    if (storeless) {
                        matched.push({ entry, kind: 'xml-storeless', ...storeless, text });
                        continue;
                    }
                    const cfg = detectLayerFromXml(base, text);
                    if (!cfg) {
                        results.push({ name: entry.name, status: 'skipped', text: '레이어를 인식할 수 없는 XML 파일' });
                    } else if (!XML_IMPORT_SUPPORTED_KEYS.has(cfg.key)) {
                        results.push({ name: entry.name, status: 'skipped', text: `${cfg.label} — 아직 XML 업로드 미지원 (JSON으로 내보내 가져오세요)` });
                    } else {
                        matched.push({ entry, cfg, kind: 'xml', text });
                    }
                } else if (lower.endsWith('.json')) {
                    try {
                        const text = await entry.async('text');
                        const parsed = JSON.parse(text);
                        if (parsed.__iitp_export) {
                            matched.push({ entry, kind: 'combined', parsed });
                        } else if (parsed.__iitp_layer) {
                            const cfg = LAYER_CONFIG.find(l => l.key === parsed.__iitp_layer);
                            if (cfg) matched.push({ entry, cfg, kind: 'json', parsed });
                            else results.push({ name: entry.name, status: 'skipped', text: `알 수 없는 레이어: ${parsed.__iitp_layer}` });
                        } else {
                            const cfg = detectLayerFromFilename(base);
                            if (cfg) matched.push({ entry, cfg, kind: 'json', parsed });
                            else results.push({ name: entry.name, status: 'skipped', text: '레이어를 인식할 수 없는 JSON 파일' });
                        }
                    } catch {
                        results.push({ name: entry.name, status: 'error', text: 'JSON 파싱 오류' });
                    }
                } else if (lower.endsWith('.db')) {
                    const blob = await entry.async('blob');
                    matched.push({ entry, kind: 'db', blob });
                } else {
                    results.push({ name: entry.name, status: 'skipped', text: '지원하지 않는 형식 (JSON/XML/DB만 가능)' });
                }
            }

            // network 를 건드리는 항목을 앞으로 정렬 (안정 정렬 — 나머지는 원래 순서 유지)
            const ordered = [...matched.filter(touchesNetwork), ...matched.filter(m => !touchesNetwork(m))];

            let networkLoaded = false;
            let signalLoaded = false;
            let resetDone = false;

            for (const m of ordered) {
                setZipProgress(`가져오는 중: ${m.entry.name}`);
                try {
                    if (touchesNetwork(m) && !resetDone) {
                        await backupAndResetDependentLayers(versionId);
                        resetDone = true;
                    }
                    if (m.kind === 'xml') {
                        const base = m.entry.name.split('/').pop() ?? m.entry.name;
                        const file = new File([m.text], base, { type: 'application/xml' });
                        await importXmlToLayer(m.cfg, file, versionId);
                        if (m.cfg.key === 'network') { networkLoaded = true; refreshNetworkTiles(); }
                        if (m.cfg.key === 'signal') signalLoaded = true;
                        results.push({ name: m.entry.name, status: 'ok', text: `${m.cfg.label} (XML)` });
                    } else if (m.kind === 'combined') {
                        const result = applyCombinedExport(m.parsed.data);
                        if (result.networkLoaded) { networkLoaded = true; refreshNetworkTiles(); }
                        if (result.signalLoaded) signalLoaded = true;
                        results.push({ name: m.entry.name, status: 'ok', text: `통합 내보내기 — ${result.loaded}개 레이어` });
                    } else if (m.kind === 'xml-storeless') {
                        const base = m.entry.name.split('/').pop() ?? m.entry.name;
                        const file = new File([m.text], base, { type: 'application/xml' });
                        await importStorelessXml(m.url, file, versionId);
                        results.push({ name: m.entry.name, status: 'ok', text: `${m.label} (XML)` });
                    } else if (m.kind === 'db') {
                        const base = m.entry.name.split('/').pop() ?? m.entry.name;
                        const file = new File([m.blob], base, { type: 'application/octet-stream' });
                        await importVehicleSimDb(file, versionId);
                        results.push({ name: m.entry.name, status: 'ok', text: '시뮬레이션 결과 (vehicle_sim.db)' });
                    } else {
                        applyLayerData(m.cfg, m.parsed.data ?? m.parsed);
                        if (m.cfg.key === 'network') { networkLoaded = true; refreshNetworkTiles(); }
                        if (m.cfg.key === 'signal') signalLoaded = true;
                        results.push({ name: m.entry.name, status: 'ok', text: `${m.cfg.label} (JSON)` });
                    }
                } catch (e) {
                    results.push({ name: m.entry.name, status: 'error', text: e instanceof Error ? e.message : '가져오기 실패' });
                }
            }

            if (results.some(r => r.status === 'ok')) {
                setZipProgress('저장 중...');
                await autoSaveChangedLayers(versionId);
                if (networkLoaded && !signalLoaded) void runAutoDummyGeneration();
            }
            setZipResults(results);
        } catch (e) {
            setZipResults([{ name: file.name, status: 'error', text: e instanceof Error ? e.message : 'ZIP 처리 오류' }]);
        } finally {
            setZipProcessing(false);
            setZipProgress('');
        }
    };

    const processFile = async (file: File) => {
        setStatus(null);
        setXmlImport(null);
        setDbImport(null);
        setZipResults(null);
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.zip')) {
            void processZipFile(file);
        } else if (lower.endsWith('.json')) {
            processJsonFile(file);
        } else if (lower.endsWith('.xml')) {
            const text = await file.text();
            const storeless = detectStorelessXmlImport(text);
            if (storeless) {
                setXmlImport({ file, detectedLayer: null, detectedStoreless: storeless, selectedKey: storeless.key });
                return;
            }
            const detected = detectLayerFromXml(file.name, text);
            const usableKey = detected && XML_IMPORT_SUPPORTED_KEYS.has(detected.key) ? detected.key : '';
            setXmlImport({ file, detectedLayer: detected, selectedKey: usableKey });
        } else if (lower.endsWith('.db')) {
            setDbImport({ file });
        } else {
            setStatus({ type: 'error', text: 'JSON, XML, DB 또는 ZIP 파일만 지원합니다' });
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void processFile(file);
    };

    const handleDbImport = async () => {
        if (!dbImport) return;
        const versionId = getActiveVersionId() ?? '';
        if (!versionId) { setStatus({ type: 'error', text: '시나리오가 선택되지 않았습니다' }); return; }
        setDbUploading(true);
        try {
            await importVehicleSimDb(dbImport.file, versionId);
            setStatus({ type: 'ok', text: '시뮬레이션 결과(vehicle_sim.db) 가져오기 완료' });
            setDbImport(null);
        } catch (e) {
            setStatus({ type: 'error', text: e instanceof Error ? e.message : 'DB 가져오기 실패' });
        } finally {
            setDbUploading(false);
        }
    };

    const handleXmlImport = async () => {
        if (!xmlImport?.selectedKey) return;
        const versionId = getActiveVersionId() ?? '';
        if (!versionId) { setStatus({ type: 'error', text: '시나리오가 선택되지 않았습니다' }); return; }
        const storeless = STORELESS_XML_IMPORTS[xmlImport.selectedKey];
        if (storeless) {
            try {
                await importStorelessXml(storeless.url, xmlImport.file, versionId);
                setStatus({ type: 'ok', text: `${storeless.label} XML 가져오기 완료` });
                setXmlImport(null);
            } catch (e) {
                setStatus({ type: 'error', text: e instanceof Error ? e.message : 'XML 가져오기 실패' });
            }
            return;
        }
        const cfg = LAYER_CONFIG.find(l => l.key === xmlImport.selectedKey);
        if (!cfg?.xmlExportUrl) return;
        try {
            if (xmlImport.selectedKey === 'network' && versionId) await backupAndResetDependentLayers(versionId);
            await importXmlToLayer(cfg, xmlImport.file, versionId);
            if (versionId) await autoSaveChangedLayers(versionId);
            if (xmlImport.selectedKey === 'network') {
                refreshNetworkTiles(); // 타일 모드: 2D/3D 타일 캐시 무효화 (없으면 이전 네트워크 잔존)
                void runAutoDummyGeneration(); // network XML만 가져온 경우 — 신호는 없으므로 자동 생성
            }
            setStatus({ type: 'ok', text: `${cfg.label} XML 가져오기 완료` });
            setXmlImport(null);
        } catch (e) {
            setStatus({ type: 'error', text: e instanceof Error ? e.message : 'XML 가져오기 실패' });
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={descStyle}>
                JSON, XML, DB(vehicle_sim.db) 또는 ZIP 파일을 드래그하거나 클릭하여 가져옵니다.<br/>
                ZIP은 안의 각 파일을 파일명/내용으로 스키마 자동 매칭해 한 번에 가져옵니다.<br/>
                스키마 정보가 없으면 파일명으로 레이어를 자동 감지합니다.
            </p>

            <div
                style={{
                    ...dropZoneStyle,
                    borderColor: isDragging ? 'rgba(65,105,225,0.7)' : 'rgba(255,255,255,0.12)',
                    background: isDragging ? 'rgba(65,105,225,0.08)' : 'rgba(255,255,255,0.03)',
                    opacity: zipProcessing ? 0.6 : 1,
                    pointerEvents: zipProcessing ? 'none' : 'auto',
                }}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div style={{ fontSize: 22, marginBottom: 4, opacity: 0.5 }}>⬆</div>
                <div style={{ fontSize: 11, color: '#888' }}>파일을 끌어오거나</div>
                <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                <input ref={fileInputRef} type="file" accept=".json,.xml,.db,.zip" style={{ display: 'none' }}
                       onChange={e => { const f = e.target.files?.[0]; if (f) void processFile(f); e.target.value = ''; }} />
            </div>

            {zipProcessing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#7aa2ff', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 5 }}>
                    <div style={zipSpinnerStyle} />
                    {zipProgress || 'ZIP 처리 중...'}
                </div>
            )}

            {zipResults && (
                <div style={xmlPanelStyle}>
                    <div style={{ fontSize: 11, color: '#ccc', marginBottom: 6, fontWeight: 600 }}>
                        ZIP 가져오기 결과 ({zipResults.filter(r => r.status === 'ok').length}/{zipResults.length}개 성공)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                        {zipResults.map((r, i) => (
                            <div key={i} style={{
                                fontSize: 10, display: 'flex', gap: 6,
                                color: r.status === 'ok' ? '#6fcf97' : r.status === 'error' ? '#ff6b6b' : '#888',
                            }}>
                                <span>{r.status === 'ok' ? '✓' : r.status === 'error' ? '✗' : '—'}</span>
                                <span style={{ color: '#aaa', flexShrink: 0 }}>{r.name}</span>
                                <span>{r.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {xmlImport && (
                <div style={xmlPanelStyle}>
                    <div style={{ fontSize: 11, color: '#7aa2ff', marginBottom: 6 }}>📄 {xmlImport.file.name}</div>
                    {xmlImport.detectedStoreless ? (
                        <div style={{ fontSize: 11, color: '#6fcf97', marginBottom: 8 }}>✓ 자동 감지: <strong>{xmlImport.detectedStoreless.label}</strong></div>
                    ) : xmlImport.detectedLayer && !XML_IMPORT_SUPPORTED_KEYS.has(xmlImport.detectedLayer.key) ? (
                        <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 8 }}>
                            ⚠ <strong>{xmlImport.detectedLayer.label}</strong>은(는) 아직 XML 업로드를 지원하지 않습니다.<br/>
                            JSON으로 내보내 가져오세요 (데이터 입출력 패널).
                        </div>
                    ) : xmlImport.detectedLayer ? (
                        <div style={{ fontSize: 11, color: '#6fcf97', marginBottom: 8 }}>✓ 자동 감지: <strong>{xmlImport.detectedLayer.label}</strong></div>
                    ) : (
                        <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 6 }}>파일명으로 레이어를 감지할 수 없습니다. 직접 선택하세요.</div>
                    )}
                    <select style={selectStyle} value={xmlImport.selectedKey}
                            onChange={e => setXmlImport(p => p ? { ...p, selectedKey: e.target.value } : null)}>
                        <option value="">— 레이어 선택 —</option>
                        {LAYER_CONFIG.filter(c => c.xmlExportUrl && XML_IMPORT_SUPPORTED_KEYS.has(c.key)).map(c => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                        {Object.entries(STORELESS_XML_IMPORTS).map(([key, cfg]) => (
                            <option key={key} value={key}>{cfg.label}</option>
                        ))}
                    </select>
                    <button style={{ ...importBtnStyle, marginTop: 8 }} onClick={handleXmlImport}
                            disabled={!xmlImport.selectedKey}>
                        XML 가져오기
                    </button>
                </div>
            )}

            {dbImport && (
                <div style={xmlPanelStyle}>
                    <div style={{ fontSize: 11, color: '#7aa2ff', marginBottom: 6 }}>📄 {dbImport.file.name}</div>
                    <div style={{ fontSize: 11, color: '#f5a623', marginBottom: 8 }}>
                        ⚠ 시뮬레이션 결과(vehicle_sim.db)를 교체합니다.<br/>
                        기존 차량 경로 데이터는 삭제되고 다음 재생 시 새 파일로 다시 생성됩니다.
                    </div>
                    <button style={{ ...importBtnStyle, opacity: dbUploading ? 0.6 : 1 }} onClick={handleDbImport}
                            disabled={dbUploading}>
                        {dbUploading ? '업로드 중...' : 'DB 가져오기'}
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

// ── 기준점 재설정 탭 ──────────────────────────────────────────────────────────
// 이미 임포트된 네트워크(현재 버전)의 로컬 shape/center 좌표는 그대로 두고, WGS84 좌표
// 전체를 새 기준점으로 재계산해 서버에 재저장한다 (파일 재업로드 불필요). KTDB 스트리밍
// 임포트처럼 기준점(base_lat/base_lon) 기반으로 좌표를 역산하는 네트워크가 엉뚱한 위치에
// 나타나거나 틀어졌을 때 바로잡는 용도.
//
// 두 모드:
// - "위치만 이동": 점 하나 클릭 → 그 위치로 평행이동만. 회전/축척은 기존 값 유지.
// - "회전·축척 보정(2점)": 네트워크 상의 두 지점과 그 지점들이 실제로 있어야 할 위치를
//   각각 클릭 → 회전각·축척·위치를 한 번에 역산(2점 유사변환 캘리브레이션, GIS의 ground
//   control point 방식과 동일한 원리).
interface ReanchorTabProps {
    picking: boolean;
    setPicking: (v: boolean) => void;
    mode: ReanchorMode;
    setMode: (v: ReanchorMode) => void;
    picked: LatLon | null;
    setPicked: (v: LatLon | null) => void;
    calibPoints: Record<CalibKey, LatLon | null>;
    setCalibPoint: (key: CalibKey, v: LatLon | null) => void;
    resetCalib: () => void;
}

const CALIB_STEPS: { key: CalibKey; label: string; hint: string }[] = [
    { key: 'srcA', label: '기준점 1 — 네트워크 상의 현재 위치', hint: '화면에 보이는 네트워크에서 알아보기 쉬운 지점(교차로 등)을 클릭' },
    { key: 'dstA', label: '기준점 1 — 실제로 있어야 할 위치',   hint: '위 지점이 실제 지도에서는 어디여야 하는지 클릭' },
    { key: 'srcB', label: '기준점 2 — 네트워크 상의 현재 위치', hint: '기준점 1과 멀리 떨어진 다른 지점 — 멀수록 정확도가 높아짐' },
    { key: 'dstB', label: '기준점 2 — 실제로 있어야 할 위치',   hint: '위 지점이 실제 지도에서는 어디여야 하는지 클릭' },
];

const ReanchorTab: React.FC<ReanchorTabProps> = ({
    picking, setPicking, mode, setMode, picked, setPicked, calibPoints, setCalibPoint, resetCalib,
}) => {
    const versionId = getActiveVersionId() ?? '';
    const scenario = useScenarioStore((s) => s.selectedScenario);

    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

    // 서버 응답 반영 + 타일 캐시 갱신 (move/calibrate 공통 후처리)
    const applyNetworkResponse = (network: any) => {
        if (!useNetworkTileStore.getState().tileMode) {
            assignPropertyToResponseData(network);
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild(network);
            useNetworkStore.getState().setChange(false); // 서버에 이미 반영됨 — "미저장 편집" 아님
        }
        refreshNetworkTiles();

        // 차량 시뮬레이션은 서버가 완성된 WGS84 좌표를 DB(vehicle_routes)에 캐시해두고 재사용한다
        // (백엔드 /reanchor·/calibrate 가 그 캐시를 이미 지웠음). 여기서는 프론트가 들고 있던
        // 이전 위치의 czml/vehicleRoute 를 비우고 refetchTrigger 를 올려, 다음 재생 시 서버에
        // 새로 요청하도록 한다 — 안 비우면 캐시가 이미 있다고 보고 재요청 자체를 안 해서
        // "네트워크는 이동했는데 차량은 이전 위치에 남아있는" 증상이 재현된다.
        useVehicleStore.setState({ czml: '', vehicleRoute: '', features: '' });
        useSimulationStore.getState().reset();
        useVehicleStore.getState().triggerRefetch();
    };

    const pickInto = (onPicked: (p: LatLon) => void) => {
        setStatus(null);
        setPicking(true);
        useMapStore.getState().startCoordPick((lat, lng) => {
            onPicked({ lat, lon: lng });
            setPicking(false);
        });
    };

    const handlePickOnMap = () => pickInto(setPicked);
    const handlePickCalibStep = (key: CalibKey) => pickInto((p) => setCalibPoint(key, p));

    const handleApplyMove = async () => {
        if (!picked || !versionId) return;
        const ok = await showConfirm(
            `네트워크 전체를 새 기준점(${picked.lat.toFixed(6)}, ${picked.lon.toFixed(6)})으로 다시 배치합니다.\n` +
            `내부 도로 형상은 그대로 유지되고 위치만 이동합니다. 계속할까요?`
        );
        if (!ok) return;

        setApplying(true);
        setStatus(null);
        try {
            const url = `${import.meta.env.VITE_API_URL}/network/${versionId}/reanchor` +
                `?latitude=${picked.lat}&longitude=${picked.lon}`;
            const res = await fetch(url, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                throw new Error((data?.errors ?? data?.warnings ?? [`서버 오류 ${res.status}`]).join('\n'));
            }
            applyNetworkResponse(data.network);
            setStatus({ type: 'ok', text: '기준점을 재설정했습니다.' });
            setPicked(null);
        } catch (e: unknown) {
            setStatus({ type: 'error', text: e instanceof Error ? e.message : '기준점 재설정 실패' });
        } finally {
            setApplying(false);
        }
    };

    const allCalibPicked = CALIB_STEPS.every((s) => calibPoints[s.key] != null);

    const handleApplyCalibrate = async () => {
        if (!allCalibPicked || !versionId) return;
        const { srcA, dstA, srcB, dstB } = calibPoints as Record<CalibKey, LatLon>;
        const ok = await showConfirm(
            '네트워크 전체의 위치·회전·축척을 지정한 두 기준점에 맞춰 다시 계산합니다.\n' +
            '내부 도로 형상은 그대로 유지됩니다. 계속할까요?'
        );
        if (!ok) return;

        setApplying(true);
        setStatus(null);
        try {
            const params = new URLSearchParams({
                srcLat1: String(srcA.lat), srcLon1: String(srcA.lon),
                dstLat1: String(dstA.lat), dstLon1: String(dstA.lon),
                srcLat2: String(srcB.lat), srcLon2: String(srcB.lon),
                dstLat2: String(dstB.lat), dstLon2: String(dstB.lon),
            });
            const url = `${import.meta.env.VITE_API_URL}/network/${versionId}/calibrate?${params.toString()}`;
            const res = await fetch(url, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                throw new Error((data?.errors ?? data?.warnings ?? [`서버 오류 ${res.status}`]).join('\n'));
            }
            applyNetworkResponse(data.network);
            setStatus({ type: 'ok', text: '캘리브레이션을 적용했습니다.' });
            resetCalib();
        } catch (e: unknown) {
            setStatus({ type: 'error', text: e instanceof Error ? e.message : '캘리브레이션 실패' });
        } finally {
            setApplying(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
                <button
                    style={mode === 'move' ? modeTabActiveStyle : modeTabStyle}
                    onClick={() => setMode('move')}
                >위치만 이동</button>
                <button
                    style={mode === 'calibrate' ? modeTabActiveStyle : modeTabStyle}
                    onClick={() => setMode('calibrate')}
                >회전·축척 보정(2점)</button>
            </div>

            {scenario?.latitude != null && scenario?.longitude != null && (
                <div style={{ fontSize: 11, color: '#666' }}>
                    현재 기준 좌표: {scenario.latitude.toFixed(6)}, {scenario.longitude.toFixed(6)}
                </div>
            )}

            {mode === 'move' ? (
                <>
                    <p style={descStyle}>
                        이미 가져온 네트워크가 엉뚱한 위치에 나타날 때, 도로 형상은 그대로 두고
                        기준점(위치)만 다시 잡습니다. 파일을 다시 업로드할 필요는 없습니다.
                    </p>

                    <button style={mapSelectBtnStyle} onClick={handlePickOnMap} disabled={picking}>
                        📍 지도에서 새 기준점 선택
                    </button>

                    {picked && (
                        <div style={xmlPanelStyle}>
                            <div style={{ fontSize: 11, color: '#8aaaee', marginBottom: 6 }}>선택한 기준점</div>
                            <div style={gridStyle}>
                                <span style={labelStyle}>위도</span>
                                <span style={{ ...inputStyle, background: 'transparent', border: 'none', padding: '5px 0' }}>
                                    {picked.lat.toFixed(7)}
                                </span>
                                <span style={labelStyle}>경도</span>
                                <span style={{ ...inputStyle, background: 'transparent', border: 'none', padding: '5px 0' }}>
                                    {picked.lon.toFixed(7)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                                <button style={cancelBtnStyle} onClick={() => setPicked(null)} disabled={applying}>취소</button>
                                <button style={importBtnStyle} onClick={handleApplyMove} disabled={applying}>
                                    {applying ? '적용 중…' : '적용'}
                                </button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <p style={descStyle}>
                        네트워크가 회전돼 있거나 실제와 크기가 다를 때, 알아보기 쉬운 두 지점을 골라
                        각각 "네트워크 상 현재 위치"와 "실제로 있어야 할 위치"를 클릭하면 회전·축척·
                        위치를 한 번에 맞춥니다.
                    </p>

                    {CALIB_STEPS.map((step) => {
                        const value = calibPoints[step.key];
                        return (
                            <div key={step.key} style={xmlPanelStyle}>
                                <div style={{ fontSize: 11, color: '#8aaaee', marginBottom: 3 }}>{step.label}</div>
                                <div style={{ fontSize: 10, color: '#666', marginBottom: 7 }}>{step.hint}</div>
                                {value ? (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                        <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>
                                            {value.lat.toFixed(6)}, {value.lon.toFixed(6)}
                                        </span>
                                        <button
                                            style={{ ...cancelBtnStyle, padding: '3px 10px', fontSize: 10, flexShrink: 0 }}
                                            onClick={() => handlePickCalibStep(step.key)}
                                            disabled={picking}
                                        >다시 선택</button>
                                    </div>
                                ) : (
                                    <button style={mapSelectBtnStyle} onClick={() => handlePickCalibStep(step.key)} disabled={picking}>
                                        📍 지도에서 선택
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button style={cancelBtnStyle} onClick={resetCalib} disabled={applying}>초기화</button>
                        <button style={importBtnStyle} onClick={handleApplyCalibrate} disabled={applying || !allCalibPicked}>
                            {applying ? '적용 중…' : '적용'}
                        </button>
                    </div>
                </>
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
    const { selecting, bbox, polygons, setSelecting, setBbox, setSelectingPolygon, setPolygons } = useOsmBboxStore();
    const versionId = getActiveVersionId() ?? '';
    const isKtdb = type === 'ktdb';
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    // KTDB 탭을 벗어나거나 모달이 닫힐 때 다음 진입에 이전 폴리곤이 남아있지 않도록 정리.
    // ⚠️ "폴리곤 그리기" 버튼을 누르면 selectingPolygon=true 가 되어 부모(FileImportModal)가
    // 이 탭을 배너로 잠깐 대체하며 BboxTab 도 그 순간 언마운트된다 — 그때도 이 cleanup이
    // 걸려 setPolygons(null)이 selectingPolygon 까지 도로 false 로 되돌려버려서 배너가 뜨는
    // 순간도 없이 원래 모달로 곧장 복귀하는 버그가 있었다(사용자 실측: "아무 일도 발생하지
    // 않음"). 그리기를 "막 시작"해서 언마운트되는 경우(selectingPolygon 이 이미 true)는 여기서
    // 지우면 안 되고, 실제로 탭/모달을 떠나는 경우(selectingPolygon 이 false)에만 지운다.
    useEffect(() => () => {
        if (isKtdb && !useOsmBboxStore.getState().selectingPolygon) setPolygons(null);
    }, [isKtdb, setPolygons]);

    const handleBoundaryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // 같은 파일 재선택 시에도 change 이벤트가 다시 뜨도록
        if (!file) return;
        setError(null);
        try {
            const rings = await parseBoundaryFile(file);
            if (rings.length === 0) { setError('파일에서 경계(다각형)를 찾지 못했습니다.'); return; }
            setPolygons(rings);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '경계 파일을 읽는 중 오류가 발생했습니다.');
        }
    };

    const handleImport = async () => {
        setError(null);
        if (!south || !west || !north || !east) { setError('바운딩 박스 좌표를 모두 입력하세요.'); return; }
        if (isKtdb && !polygons) { setError('폴리곤을 그리거나 경계 파일을 업로드하세요.'); return; }
        setLoading(true);
        startProgress();
        try {
            const formData = new FormData();
            formData.append('south', south);
            formData.append('west',  west);
            formData.append('north', north);
            formData.append('east',  east);
            if (versionId) formData.append('versionId', versionId);
            if (isKtdb && polygons) formData.append('polygon', JSON.stringify(polygons));
            if (isKtdb) {
                // OD 매트릭스 자동생성(서버 NextSimInputScaffolder.buildSampleOdMatrix) 파라미터 —
                // 앱 설정(⚙ → 자동생성 설정)에서 사용자가 조정한 값을 KTDB 임포트 요청에 실어 보낸다.
                const { odMinFlow, odMaxFlow, odRefDistM } = useAppSettingsStore.getState().autoGeneration;
                formData.append('odMinFlow', String(odMinFlow));
                formData.append('odMaxFlow', String(odMaxFlow));
                formData.append('odRefDistM', String(odRefDistM));
            }

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

            // KTDB: intersection 노드 기반 더미 신호를 프론트에서 즉시 미리보기로만 표시
            // (백엔드 스캐폴딩이 끝날 때까지 지도가 신호 없이 비어 보이지 않도록). 화면
            // 표시용일 뿐 setChange(true)는 절대 하지 않는다 — 여기서 변경 표시를 하면 아래
            // autoSaveChangedLayers가 이 클라이언트製 더미(TOD 없이 만들어짐, 옛 단일-plan
            // 포맷)를 signal.xml에 그대로 저장해버려서, 뒤이어 끝나는 백엔드의 진짜 스캐폴딩
            // 결과(평시/혼잡 2-plan + signalTOD 완전 매칭)를 매번 덮어쓰는 경쟁이 있었다
            // (실측: 재임포트할 때마다 신호 TOD 커버리지가 계속 깨짐). 진짜 데이터는
            // pollKtdbScaffoldStatus 완료 시 refetchSignalAndTod가 서버에서 다시 받아와 교체한다.
            if (type === 'ktdb') {
                const signals = await generateDummySignals(pendingData);
                if (signals.length > 0) {
                    const signalData = { signals };
                    assignPropertyToResponseData(signalData);
                    useSignalStore.getState().setCurrentJsonData(signalData);
                }
                // 백엔드는 이 가져오기 응답과 별개로 더미 신호/OD/TOD 생성 + 타일 재빌드를
                // 백그라운드에서 계속 진행 중이다(대형망은 수십 초~수 분) — 완료 여부를 폴링해
                // 지도 상단 스피너로 노출한다. 안 그러면 "가져오기 완료"로 보이는 이 시점과
                // 실제 더미 데이터가 준비되는 시점이 어긋나 "아무리 기다려도 안 생기네"가 된다.
                if (versionId) pollKtdbScaffoldStatus(versionId);
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

        // KTDB는 백엔드가 이 가져오기와 별개로 신호/OD/TOD를 이미 자동 스캐폴딩 중이라(위
        // pollKtdbScaffoldStatus) 여기서 또 만들 필요가 없다 — OSM은 그런 백엔드 스캐폴딩이
        // 없으므로 여기서 직접 자동 생성한다.
        if (type === 'osm') void runAutoDummyGeneration();
        setBbox(null);
        if (isKtdb) setPolygons(null);
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

            {isKtdb ? (
                <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...mapSelectBtnStyle, flex: 1 }}
                            onClick={() => { setError(null); setSelectingPolygon(true); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                            <path d="M12 3l8 5-3 9H7l-3-9z"/>
                        </svg>
                        폴리곤 그리기
                    </button>
                    <button style={{ ...mapSelectBtnStyle, flex: 1 }}
                            onClick={() => { setError(null); fileInputRef.current?.click(); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                            <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3M7 9l5-5 5 5M12 4v13"/>
                        </svg>
                        파일로 경계 가져오기
                    </button>
                    <input ref={fileInputRef} type="file" accept=".geojson,.json,.shp,.zip"
                           style={{ display: 'none' }} onChange={handleBoundaryFile} />
                </div>
            ) : (
                <button style={mapSelectBtnStyle} onClick={() => { setError(null); setSelecting(true); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
                    </svg>
                    지도에서 영역 선택
                </button>
            )}

            {isKtdb && !polygons && (
                <p style={{ fontSize: 10, color: '#666', margin: 0 }}>폴리곤을 그리거나 파일을 업로드하세요.</p>
            )}

            <div style={gridStyle}>
                {[['남쪽 (South)', south, setSouth, '37.49'], ['서쪽 (West)', west, setWest, '126.75'],
                  ['북쪽 (North)', north, setNorth, '37.52'], ['동쪽 (East)', east, setEast, '126.80']].map(
                    ([lbl, val, setter, ph]) => (
                        <React.Fragment key={String(lbl)}>
                            <label style={labelStyle}>{String(lbl)}</label>
                            <input style={isKtdb ? { ...inputStyle, opacity: 0.6, cursor: 'default' } : inputStyle}
                                   type="number" step="any" readOnly={isKtdb}
                                   placeholder={isKtdb ? '경계에서 자동 계산' : `예: ${String(ph)}`} value={String(val)}
                                   onChange={e => isKtdb ? undefined : (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)} />
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
// 기준점 탭 내부 "위치만 이동" / "회전·축척 보정" 모드 선택용 pill 버튼
const modeTabStyle: React.CSSProperties = {
    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#888',
};
const modeTabActiveStyle: React.CSSProperties = {
    ...modeTabStyle,
    background: 'rgba(65,105,225,0.18)', border: '1px solid rgba(65,105,225,0.5)', color: '#7aa2ff',
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
const zipSpinnerStyle: React.CSSProperties = {
    width: 12,
    height: 12,
    flexShrink: 0,
    border: '2px solid rgba(255,255,255,0.15)',
    borderTopColor: '#7aa2ff',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
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
