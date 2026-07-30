import React, { useEffect, useMemo, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from '@stores/useScenarioStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore, PlacementMode } from '@stores/useNetworkDrawStore';
import { useRouteDrawStore, RouteDrawMode } from '@stores/useRouteDrawStore';
import { useModeStore } from '@stores/useModeStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useNetworkTileStore } from '@stores/useNetworkTileStore';
import { NETWORK_TILING } from '@utils/lodConstants';
import { assignPropertyToResponseData } from '@utils/guid';
import { generateDummySignals } from '@utils/signal';
import { generateDummyPavementMarkings } from '@utils/pavementMarking';
import { getNetworkForDummyGeneration } from '@utils/generationNetwork';
import { autoSaveChangedLayers } from '@utils/autoSave';
import { showAlert, showConfirm } from '@utils/dialog';
import { NEXTSIM_REQUIRED_KEYS } from '@utils/nextSimValidation';
import { useNextSimReadinessStore } from '@stores/useNextSimReadinessStore';
import { useNextSimRunStore, checkNextSimAvailable } from '@utils/nextsim';
import { useBackgroundTaskStore } from '@stores/useBackgroundTaskStore';
import styles from "@css/ToolsPanel.module.css";

export interface FacilityProps {
    fields: LayerField[];
}

// 지도를 직접 클릭해 배치하는 시설물 — 이전엔 도킹된 NetworkDrawPanel(삭제됨)에 있던 3개
// 배치 버튼을 여기로 옮겼다. 이 컴포넌트가 이미 같은 레이어들의 "더미 생성" 진입점이라
// 자리가 자연스럽다.
const PLACEMENT_LABELS: Partial<Record<string, PlacementMode>> = {
    busStation: 'busStation',
    railStation: 'railStation',
    signal: 'signal',
};

// 정류장/역이 2개 이상 있어야 노선(경유 순서)을 그릴 수 있다 — "노선 그리기" 진입 버튼과
// 대상 스토어의 배열 키(currentJsonData 안의 필드명)를 함께 정의.
const ROUTE_DRAW_MODES: Partial<Record<string, Exclude<RouteDrawMode, 'none'>>> = {
    busStation: 'bus',
    railStation: 'rail',
};
const ROUTE_DRAW_ARRAY_KEY: Partial<Record<string, string>> = {
    busStation: 'busStations',
    railStation: 'railStations',
};

// 더미 생성을 지원하는 레이어 키 → 생성 함수
// 타일 모드에서는 네트워크 store 가 viewport 분(차선 stripped 가능)뿐이라 전체 네트워크를 임시 fetch
const DUMMY_GENERATORS: Partial<Record<string, () => Promise<any>>> = {
    signal: async () => {
        const network = await getNetworkForDummyGeneration();
        const signals = await generateDummySignals(network);
        return signals.length > 0 ? { signals } : null;
    },
    pavementMarking: async () => {
        const network = await getNetworkForDummyGeneration();
        const markings = generateDummyPavementMarkings(network);
        return markings.length > 0 ? { pavementMarkings: markings } : null;
    },
};

const getNestedArrayFieldsRecursive = (row: any): string[] => {
    if (!row || typeof row !== "object") return [];
    let nestedFields: string[] = [];
    for (const key in row) {
        const value = row[key];
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0].featureType) {
            nestedFields.push(key);
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value[0]));
        } else if (typeof value === "object" && value !== null) {
            nestedFields = nestedFields.concat(getNestedArrayFieldsRecursive(value));
        }
    }
    return nestedFields;
};

const Facility = ({ fields }: FacilityProps) => {
    const { activeLayerName, addActiveLayerName, removeActiveLayerName, layerManager } = useLayerStore();
    const nestedArrayFieldsMap: Record<string, string[]> = {};
    const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
    const [generatingKey, setGeneratingKey] = useState<string | null>(null);
    const [vehicleExists, setVehicleExists] = useState<boolean | null>(null);
    const [vehicleLoading, setVehicleLoading] = useState(false);
    // NextSim 준비 상태(도로/신호등 무결성)는 헤더 배지와 상태를 공유 — 여기서는 행 옆 점 표시에만 사용
    const validation = useNextSimReadinessStore((s) => s.validation);
    // KTDB 가져오기 백그라운드 스캐폴딩(백엔드가 signal.xml/OD 를 직접 재생성 중)과 겹치면
    // 안 됨 — 같은 신호 데이터를 프론트/백엔드가 동시에 다른 경로로 써서 서로 덮어쓸 수 있다.
    const ktdbScaffolding = useBackgroundTaskStore((s) => !!s.tasks['ktdb-scaffold']);
    // 차량 시뮬레이션 실행 진입점은 헤더의 NextSim 배지로 통일 — 여기서는 안내만 표시(전역 스토어 공유).
    const nsAvailable = useNextSimRunStore((s) => s.available);
    useEffect(() => { void checkNextSimAvailable(); }, []);
    const placementMode = useNetworkDrawStore((s) => s.placementMode);
    const routeDrawMode = useRouteDrawStore((s) => s.mode);
    // 보기 모드에선 지도 클릭이 아무 것도 편집하지 않아야 한다 — 배치는 편집 동작이므로
    // 편집 모드에서만 허용한다(버튼도 숨김). usePlacementMode 훅에도 동일 게이트가 있어
    // 이중 방어(모드를 전환하는 사이 남아있는 placementMode도 거기서 정리됨).
    const isEditMode = useModeStore((s) => s.appMode === 'edit');
    // 배치 모드의 클릭 리스너/ESC 취소는 usePlacementMode(Maps.tsx, 항상 마운트)가 담당한다 —
    // 이 컴포넌트(레이어 팝업의 "시설물" 탭)는 팝업을 닫거나 다른 탭으로 넘어가면 언마운트되므로,
    // 여기 두면 배치 모드를 켠 채로 팝업을 닫는 순간 클릭이 먹통이 되는 문제가 있었다. 여기서는
    // 버튼(상태 토글)만 담당한다. 노선 그리기(useRouteDrawMode)도 동일한 이유로 상시 마운트 훅.

    const handleTogglePlacement = (key: string) => {
        if (!isEditMode) return;
        const mode = PLACEMENT_LABELS[key];
        if (!mode) return;
        // 배치와 노선 그리기는 상호 배타적 — 배치를 시작하면 그리던 노선 초안은 버린다.
        useRouteDrawStore.getState().reset();
        if (placementMode === mode) useNetworkDrawStore.getState().exitToSelect();
        else useNetworkDrawStore.getState().setPlacementMode(mode);
    };

    const handleToggleRouteDraw = (key: string) => {
        if (!isEditMode) return;
        const mode = ROUTE_DRAW_MODES[key];
        if (!mode) return;
        if (routeDrawMode === mode) useRouteDrawStore.getState().reset();
        else useRouteDrawStore.getState().start(mode);
    };

    // 노선(경유 순서)을 그리려면 정류장/역이 최소 2개는 있어야 의미가 있다.
    const routeDrawEligible = (key: string): boolean => {
        const arrayKey = ROUTE_DRAW_ARRAY_KEY[key];
        if (!arrayKey) return false;
        const data = layerNameToStoreMap[key]?.getState().currentJsonData as any;
        return (data?.[arrayKey]?.length ?? 0) >= 2;
    };

    // store의 currentJsonData 변화를 감지해 visibleFields 재계산
    const [, setDataTick] = useState(0);

    // 차량 시뮬레이션 존재 여부 확인
    useEffect(() => {
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) return;
        const base = import.meta.env.VITE_API_URL;
        fetch(`${base}/vehicle/vehicle-route/${scenarioKey}/exists`)
            .then(res => res.ok ? res.json() : null)
            // exists(CZML 캐시)만 보면 원본(vehicle_sim.db)만 있는 경우를 "없음"으로 오판
            // → useSimulation/useLayerInit 로드 판단과 동일하게 원본 기준으로 통일
            .then(info => setVehicleExists(!!(info?.exists || info?.generating || info?.simDbExists)))
            .catch(() => setVehicleExists(false));
    }, []);

    useEffect(() => {
        const unsubs: Array<() => void> = [];
        fields.forEach(field => {
            const store = layerNameToStoreMap[field.key];
            if (store) {
                unsubs.push((store as any).subscribe(
                    (state: any) => state.currentJsonData,
                    () => setDataTick(t => t + 1),
                    { equalityFn: (a: any, b: any) => a === b }
                ));
            }
        });
        return () => unsubs.forEach(u => u());
    }, [fields]);

    // 스토어에 데이터가 있는 레이어만 목록에 표시
    const visibleFields = useMemo(() => {
        if (!layerManager) return fields;
        return fields.filter((field) => {
            const store = layerNameToStoreMap[field.key];
            if (store) {
                const data = store.getState().currentJsonData;
                if (data == null) return false;
                if (typeof data === 'object' && !Array.isArray(data)) {
                    return Object.values(data).some(v => Array.isArray(v) ? v.length > 0 : v != null);
                }
                return Array.isArray(data) ? data.length > 0 : true;
            }
            const layer = layerManager.getLayerByName(field.key);
            const featureCount = layer?.getSource?.()?.getFeatures?.()?.length ?? 0;
            return featureCount > 0;
        });
    }, [fields, layerManager]);

    // 데이터 없고 더미 생성 또는 직접 배치가 가능한 레이어
    const emptyDummyFields = useMemo(() => {
        const visibleKeys = new Set(visibleFields.map(f => f.key));
        return fields.filter(f => !visibleKeys.has(f.key) && (!!DUMMY_GENERATORS[f.key] || !!PLACEMENT_LABELS[f.key]));
    }, [fields, visibleFields]);

    const toggleExpand = (parentKey: string) => {
        setExpandedParents(prev => ({ ...prev, [parentKey]: !prev[parentKey] }));
    };

    const defaultSelected = visibleFields.find(field => field.basic)?.key || null;

    visibleFields.forEach((field) => {
        if (layerManager) {
            // 타일 모드: 네트워크 currentJsonData가 빈 마커({nodes:[],links:[]})라 트리 하위를
            // 유추할 수 없음 → 고정 하위 필드 제공 (cells/segments는 타일 응답에서 제외되므로 생략)
            if (field.key === 'network' && (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode)) {
                nestedArrayFieldsMap[field.key] = ['nodes', 'ports', 'connections', 'links', 'lanes'];
                return;
            }
            const store = layerNameToStoreMap[field.key];
            const currentJsonData = store?.getState().currentJsonData;
            if (currentJsonData) {
                nestedArrayFieldsMap[field.key] = getNestedArrayFieldsRecursive(currentJsonData);
            }
        }
    });

    useEffect(() => {
        if (defaultSelected) {
            addActiveLayerName(defaultSelected);
            (nestedArrayFieldsMap[defaultSelected] || []).forEach(child => {
                addActiveLayerName(`${defaultSelected}.${child}`);
            });
        }
    }, [defaultSelected]);

    const isParentChecked = (key: string) => {
        const children = nestedArrayFieldsMap[key] || [];
        if (children.length === 0) return activeLayerName?.includes(key);
        return children.some(child => activeLayerName?.includes(`${key}.${child}`));
    };

    const isChildChecked = (parentKey: string, childKey: string) =>
        activeLayerName?.includes(`${parentKey}.${childKey}`);

    const toggleParent = (parentKey: string, checked: boolean) => {
        const children = nestedArrayFieldsMap[parentKey] || [];
        if (checked) {
            addActiveLayerName(parentKey);
            children.forEach(child => addActiveLayerName(`${parentKey}.${child}`));
            layerManager?.showLayer('facility', parentKey);
        } else {
            removeActiveLayerName(parentKey);
            children.forEach(child => removeActiveLayerName(`${parentKey}.${child}`));
            layerManager?.hideLayer('facility', parentKey);
        }
    };

    const toggleChild = (parentKey: string, childKey: string, checked: boolean) => {
        const fullKey = `${parentKey}.${childKey}`;
        if (checked) {
            addActiveLayerName(fullKey);
            if (!activeLayerName?.includes(parentKey)) addActiveLayerName(parentKey);
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, true);
        } else {
            removeActiveLayerName(fullKey);
            layerManager?.toggleByFeatureType('facility', parentKey, childKey, false);
            const children = nestedArrayFieldsMap[parentKey] || [];
            const anyChecked = children.some(child => activeLayerName?.includes(`${parentKey}.${child}`));
            if (!anyChecked) removeActiveLayerName(parentKey);
        }
    };

    const handleDelete = async (field: LayerField) => {
        if (!await showConfirm(`${field.label} 데이터를 삭제하시겠습니까?`)) return;
        const store = layerNameToStoreMap[field.key];
        if (!store) return;
        store.getState().setCurrentJsonData(null);
        store.getState().setChange(true);
        layerManager?.hideLayer('facility', field.key);
        removeActiveLayerName(field.key);
        (nestedArrayFieldsMap[field.key] ?? []).forEach(child => removeActiveLayerName(`${field.key}.${child}`));
        const versionKey = getActiveVersionId();
        if (versionKey) await autoSaveChangedLayers(versionKey);
    };

    const handleGenerate = async (field: LayerField) => {
        const generator = DUMMY_GENERATORS[field.key];
        const store = layerNameToStoreMap[field.key];
        if (!generator || !store) return;
        setGeneratingKey(field.key);
        try {
            const data = await generator();
            if (!data) {
                await showAlert(`${field.label} 더미 데이터를 생성할 수 없습니다. 네트워크 데이터를 먼저 가져오세요.`);
                return;
            }
            assignPropertyToResponseData(data);
            store.getState().setCurrentJsonData(data);
            store.getState().setChange(true);
            const versionKey = getActiveVersionId();
            if (versionKey) await autoSaveChangedLayers(versionKey);
        } finally {
            setGeneratingKey(null);
        }
    };

    const handleVehicleDelete = async () => {
        if (!await showConfirm('차량 시뮬레이션 데이터를 삭제하시겠습니까?')) return;
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) return;
        setVehicleLoading(true);
        try {
            const base = import.meta.env.VITE_API_URL;
            const res = await fetch(`${base}/vehicle/vehicle-route/${scenarioKey}`, { method: 'DELETE' });
            if (!res.ok) {
                await showAlert(`차량 시뮬레이션 삭제에 실패했습니다. (${res.status})\n서버를 재시작한 후 다시 시도하세요.`);
                return;
            }
            // 스토어 초기화
            useVehicleStore.setState({ czml: '' as any, vehicleData: '' as any, vehicleRoute: '' as any, features: '' as any });
            useSimulationStore.getState().reset();
            // Cesium/OL 차량 레이어 제거
            layerManager?.removeVehicleLayer();
            setVehicleExists(false);
        } catch (e) {
            await showAlert('차량 시뮬레이션 삭제에 실패했습니다.');
        } finally {
            setVehicleLoading(false);
        }
    };

    const requiredDotColor = (key: string) => {
        const v = validation[key];
        if (v?.loading) return '#888';
        if (v?.ok === true) return '#2ed573';
        if (v?.ok === false) return '#ff4757';
        return '#888';
    };
    const requiredDotTitle = (key: string) => {
        const v = validation[key];
        if (v?.loading) return '검증 중...';
        if (v?.ok === true) return 'NextSim 필수 데이터 — 검증 통과';
        if (v?.ok === false) return `NextSim 필수 데이터 — 문제 ${v.issues?.length ?? 0}건 (헤더의 NextSim 배지 참고)`;
        return 'NextSim 필수 데이터 — 아직 검증 안 됨 (헤더의 NextSim 배지에서 검증)';
    };

    return (
        <div>
            {/* 데이터 있는 레이어 */}
            {visibleFields.map((field) => {
                const parentKey = field.key;
                const nestedFields = nestedArrayFieldsMap[parentKey] || [];
                const isExpanded = expandedParents[parentKey] ?? false;
                const isRequired = NEXTSIM_REQUIRED_KEYS.has(parentKey);

                return (
                    <div key={parentKey}>
                        <div
                            className={styles.sectionLabel}
                            onClick={() => nestedFields.length && toggleExpand(parentKey)}
                        >
                            {nestedFields.length > 0 && (
                                <span className={styles.sectionToggle}>
                                    {isExpanded ? '▼' : '▶'}
                                </span>
                            )}
                            <span style={{ flex: 1 }}>
                                {field.label}
                                {isRequired && (
                                    <span title={requiredDotTitle(parentKey)} style={{ color: requiredDotColor(parentKey), marginLeft: 5, fontSize: 10 }}>●</span>
                                )}
                            </span>
                            {isEditMode && PLACEMENT_LABELS[parentKey] && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleTogglePlacement(parentKey); }}
                                    title={placementMode === PLACEMENT_LABELS[parentKey] ? '배치 종료 (ESC)' : `지도를 클릭해 ${field.label} 추가 배치`}
                                    style={placementMode === PLACEMENT_LABELS[parentKey] ? placeBtnActiveStyle : placeBtnStyle}
                                >
                                    {placementMode === PLACEMENT_LABELS[parentKey] ? '■ 배치 중' : '📍 배치'}
                                </button>
                            )}
                            {isEditMode && ROUTE_DRAW_MODES[parentKey] && routeDrawEligible(parentKey) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleRouteDraw(parentKey); }}
                                    title={routeDrawMode === ROUTE_DRAW_MODES[parentKey] ? '노선 그리기 종료 (ESC)' : `지도에서 ${field.label}을(를) 순서대로 클릭해 노선 만들기`}
                                    style={routeDrawMode === ROUTE_DRAW_MODES[parentKey] ? placeBtnActiveStyle : placeBtnStyle}
                                >
                                    {routeDrawMode === ROUTE_DRAW_MODES[parentKey] ? '■ 그리는 중' : (ROUTE_DRAW_MODES[parentKey] === 'bus' ? '🚌 노선 그리기' : '🚆 노선 그리기')}
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(field); }}
                                title={`${field.label} 데이터 삭제`}
                                style={deleteBtnStyle}
                            >
                                ✕
                            </button>
                            <input
                                type="checkbox"
                                checked={!!isParentChecked(parentKey)}
                                onChange={(e) => toggleParent(parentKey, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ accentColor: '#7aa2ff', width: 13, height: 13, cursor: 'pointer' }}
                            />
                        </div>

                        {isExpanded && nestedFields.map(childKey => (
                            <label key={`${parentKey}.${childKey}`} className={styles.childItem}>
                                <input
                                    type="checkbox"
                                    checked={!!isChildChecked(parentKey, childKey)}
                                    onChange={(e) => toggleChild(parentKey, childKey, e.target.checked)}
                                />
                                {childKey}
                            </label>
                        ))}
                    </div>
                );
            })}

            {/* 데이터 없고 더미 생성 또는 직접 배치가 가능한 레이어 */}
            {emptyDummyFields.map((field) => (
                <div key={field.key} className={styles.sectionLabel} style={{ opacity: placementMode === PLACEMENT_LABELS[field.key] ? 1 : 0.5, cursor: 'default' }}>
                    <span style={{ flex: 1 }}>
                        {field.label}
                        {NEXTSIM_REQUIRED_KEYS.has(field.key) && (
                            <span title={requiredDotTitle(field.key)} style={{ color: requiredDotColor(field.key), marginLeft: 5, fontSize: 10 }}>●</span>
                        )}
                    </span>
                    {isEditMode && PLACEMENT_LABELS[field.key] && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleTogglePlacement(field.key); }}
                            title={placementMode === PLACEMENT_LABELS[field.key] ? '배치 종료 (ESC)' : `지도를 클릭해 ${field.label} 배치`}
                            style={placementMode === PLACEMENT_LABELS[field.key] ? placeBtnActiveStyle : placeBtnStyle}
                        >
                            {placementMode === PLACEMENT_LABELS[field.key] ? '■ 배치 중' : '📍 배치'}
                        </button>
                    )}
                    {DUMMY_GENERATORS[field.key] && (
                    <button
                        onClick={(e) => { e.stopPropagation(); handleGenerate(field); }}
                        disabled={generatingKey === field.key || ktdbScaffolding}
                        title={ktdbScaffolding
                            ? '백그라운드에서 서버가 신호/OD 데이터를 생성 중입니다 — 완료 후 다시 시도하세요'
                            : `${field.label} 더미 생성`}
                        style={{ ...generateBtnStyle, opacity: (generatingKey === field.key || ktdbScaffolding) ? 0.6 : 1 }}
                    >
                        {generatingKey === field.key ? '생성 중...' : ktdbScaffolding ? '서버 생성 중...' : '더미 생성'}
                    </button>
                    )}
                </div>
            ))}

            {/* 차량 시뮬레이션 행 — 생성(실행) 진입점은 헤더의 NextSim 배지로 통일, 여기선 삭제만 담당 */}
            {vehicleExists === true && (
                <div className={styles.sectionLabel}>
                    <span style={{ flex: 1 }}>차량 시뮬레이션</span>
                    <button
                        onClick={handleVehicleDelete}
                        disabled={vehicleLoading}
                        title="차량 시뮬레이션 데이터 삭제"
                        style={deleteBtnStyle}
                    >
                        {vehicleLoading ? '...' : '✕'}
                    </button>
                </div>
            )}
            {vehicleExists === false && nsAvailable === true && (
                <div className={styles.sectionLabel} style={{ opacity: 0.5, cursor: 'default' }}>
                    <span style={{ flex: 1 }}>차량 시뮬레이션</span>
                    <span style={{ fontSize: 10, color: '#666' }}>헤더의 NextSim 배지에서 실행하세요</span>
                </div>
            )}
        </div>
    );
};

const deleteBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: 10,
    padding: '0 3px',
    lineHeight: 1,
    flexShrink: 0,
};

const generateBtnStyle: React.CSSProperties = {
    background: 'rgba(122,162,255,0.12)',
    border: '1px solid rgba(122,162,255,0.3)',
    color: '#7aa2ff',
    cursor: 'pointer',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 4,
    flexShrink: 0,
};

const placeBtnStyle: React.CSSProperties = {
    background: 'rgba(255,180,70,0.12)',
    border: '1px solid rgba(255,180,70,0.3)',
    color: '#ffb347',
    cursor: 'pointer',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 4,
    flexShrink: 0,
    marginRight: 4,
};

const placeBtnActiveStyle: React.CSSProperties = {
    ...placeBtnStyle,
    background: 'rgba(255,80,80,0.15)',
    border: '1px solid rgba(255,80,80,0.35)',
    color: '#ff6b6b',
};

export default Facility;
