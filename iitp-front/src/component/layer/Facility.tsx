import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from '@stores/useScenarioStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useNetworkDrawStore, PlacementMode } from '@stores/useNetworkDrawStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useLogStore } from '@stores/useLogStore';
import { useNetworkTileStore } from '@stores/useNetworkTileStore';
import { NETWORK_TILING } from '@utils/lodConstants';
import { assignPropertyToResponseData, generateGUIDWithType } from '@utils/guid';
import { generateDummySignals } from '@utils/signal';
import { generateDummyPavementMarkings } from '@utils/pavementMarking';
import { getNetworkForDummyGeneration } from '@utils/generationNetwork';
import { autoSaveChangedLayers } from '@utils/autoSave';
import { showAlert, showConfirm } from '@utils/dialog';
import { NEXTSIM_REQUIRED_KEYS } from '@utils/nextSimValidation';
import { useNextSimReadinessStore } from '@stores/useNextSimReadinessStore';
import { useBackgroundTaskStore } from '@stores/useBackgroundTaskStore';
import { useEditGuideStore } from '@stores/useEditGuideStore';
import { createEventHandlers } from '@handler/createEventHandlers';
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

// 더미 생성을 지원하는 레이어 키 → 생성 함수
// 타일 모드에서는 네트워크 store 가 viewport 분(차선 stripped 가능)뿐이라 전체 네트워크를 임시 fetch
const DUMMY_GENERATORS: Partial<Record<string, () => Promise<any>>> = {
    signal: async () => {
        const network = await getNetworkForDummyGeneration();
        const signals = generateDummySignals(network);
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
    const placementMode = useNetworkDrawStore((s) => s.placementMode);

    // ── 시설물 배치 모드(버스정류장/지하철역/신호): createEventHandlers 등록 + 완료 시 자동 해제 ──
    const placementCleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (placementMode === 'none') {
            placementCleanupRef.current?.();
            placementCleanupRef.current = null;
            return;
        }

        const featureTypeMap = {
            busStation: 'busStations',
            railStation: 'railStations',
            signal: 'signals',
        } as const;
        const featureType = featureTypeMap[placementMode];
        const guid = generateGUIDWithType(featureType);

        const placementLabel = { busStation: '버스 정류장', railStation: '철도역', signal: '신호등' }[placementMode];
        useEditGuideStore.getState().setGuide({
            title: `시설물 배치 — ${placementLabel}`,
            steps: [
                { keys: ['클릭'], text: `지도에서 ${placementLabel}을(를) 놓을 위치를 클릭하세요`, em: true },
                { keys: ['ESC'], text: '배치 종료 → 선택 모드로 복귀' },
            ],
            tip: '배치 후 속성 창에서 상세 정보를 수정할 수 있어요.',
        });

        const record: Record<string, any> = { featureType, __guid: guid, id: Date.now() };
        if (placementMode === 'signal') {
            record.turning = 'Straight';
            record.type = 'TrafficLight';
        }

        const handlerCleanup = createEventHandlers(record);

        // 대상 스토어 구독: 새 항목이 추가되면 배치 모드 종료 → 선택 모드로 복귀(모드 버튼이
        // 없으므로 배치가 끝났는데도 아무 모드로도 안 돌아가면 그다음 클릭이 아무 반응이 없다).
        const targetStore = { busStation: useBusStationStore, railStation: useRailStationStore, signal: useSignalStore }[placementMode];
        const getCount = (data: any) => Object.values(data ?? {}).flat().length;
        const prevCount = getCount(targetStore.getState().currentJsonData);
        const unsubscribe = (targetStore as any).subscribe(
            (state: any) => state.currentJsonData,
            (data: any) => {
                if (getCount(data) > prevCount) useNetworkDrawStore.getState().exitToSelect();
            },
            { equalityFn: (a: any, b: any) => a === b }
        );

        placementCleanupRef.current = () => {
            handlerCleanup?.();
            unsubscribe();
            useEditGuideStore.getState().clear();
        };

        return () => {
            placementCleanupRef.current?.();
            placementCleanupRef.current = null;
        };
    }, [placementMode]);

    // ESC 키로 배치 모드 취소 → 선택 모드로 복귀
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && placementMode !== 'none') useNetworkDrawStore.getState().exitToSelect();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [placementMode]);

    const handleTogglePlacement = (key: string) => {
        const mode = PLACEMENT_LABELS[key];
        if (!mode) return;
        if (placementMode === mode) useNetworkDrawStore.getState().exitToSelect();
        else useNetworkDrawStore.getState().setPlacementMode(mode);
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

    const handleVehicleGenerate = async () => {
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) return;

        const signalData = useSignalStore.getState().currentJsonData as any;
        const hasSignal = Array.isArray(signalData?.signals) && signalData.signals.length > 0;
        if (!hasSignal) {
            const ok = await showConfirm(
                '신호 데이터가 없습니다.\n신호 패턴을 자동 추정하여 차량 시뮬레이션을 생성합니다.\n계속하시겠습니까?'
            );
            if (!ok) return;
        }

        setVehicleLoading(true);
        useLogStore.getState().addLog('info', hasSignal
            ? '차량 시뮬레이션 더미 생성 시작...'
            : '차량 시뮬레이션 더미 생성 시작 (신호 패턴 자동 추정)...'
        );

        const base = import.meta.env.VITE_API_URL;
        const poll = (retryCount: number) => {
            fetch(`${base}/vehicle/vehicle-route/${scenarioKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numVehicle: 0, regenerate: retryCount === 0, generateDummy: true }),
            })
                .then(res => {
                    if (res.status === 202) {
                        if (retryCount < 120) {
                            setTimeout(() => poll(retryCount + 1), retryCount < 10 ? 3000 : 5000);
                        } else {
                            setVehicleLoading(false);
                        }
                    } else if (res.ok) {
                        setVehicleExists(true);
                        setVehicleLoading(false);
                        useVehicleStore.getState().triggerRefetch();
                    } else {
                        setVehicleLoading(false);
                        showAlert('차량 시뮬레이션 더미 생성에 실패했습니다.');
                    }
                })
                .catch(() => {
                    setVehicleLoading(false);
                    showAlert('차량 시뮬레이션 더미 생성에 실패했습니다.');
                });
        };
        poll(0);
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
                            {PLACEMENT_LABELS[parentKey] && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleTogglePlacement(parentKey); }}
                                    title={placementMode === PLACEMENT_LABELS[parentKey] ? '배치 종료 (ESC)' : `지도를 클릭해 ${field.label} 추가 배치`}
                                    style={placementMode === PLACEMENT_LABELS[parentKey] ? placeBtnActiveStyle : placeBtnStyle}
                                >
                                    {placementMode === PLACEMENT_LABELS[parentKey] ? '■ 배치 중' : '📍 배치'}
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
                    {PLACEMENT_LABELS[field.key] && (
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

            {/* 차량 시뮬레이션 행 */}
            {vehicleExists !== null && (
                <div className={styles.sectionLabel} style={vehicleExists ? undefined : { opacity: 0.5, cursor: 'default' }}>
                    <span style={{ flex: 1 }}>차량 시뮬레이션</span>
                    {vehicleExists ? (
                        <button
                            onClick={handleVehicleDelete}
                            disabled={vehicleLoading}
                            title="차량 시뮬레이션 데이터 삭제"
                            style={deleteBtnStyle}
                        >
                            {vehicleLoading ? '...' : '✕'}
                        </button>
                    ) : (
                        <button
                            onClick={handleVehicleGenerate}
                            disabled={vehicleLoading || ktdbScaffolding}
                            title={ktdbScaffolding
                                ? '백그라운드에서 서버가 신호/OD 데이터를 생성 중입니다 — 완료 후 다시 시도하세요'
                                : '차량 시뮬레이션 더미 생성'}
                            style={{ ...generateBtnStyle, opacity: (vehicleLoading || ktdbScaffolding) ? 0.6 : 1 }}
                        >
                            {vehicleLoading ? '생성 중...' : ktdbScaffolding ? '서버 생성 중...' : '더미 생성'}
                        </button>
                    )}
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
