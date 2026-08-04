import React, { useEffect, useMemo, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from '@stores/useScenarioStore';
import { useNetworkStore } from '@stores/useNetworkStore';
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

    // 데이터 없고 더미 생성이 가능한 레이어
    const emptyDummyFields = useMemo(() => {
        const visibleKeys = new Set(visibleFields.map(f => f.key));
        return fields.filter(f => !visibleKeys.has(f.key) && !!DUMMY_GENERATORS[f.key]);
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

    /**
     * 체크 상태(activeLayerName)를 단일 출처로 삼아 지도 가시성을 맞춘다.
     *
     * 최종 렌더 조건은 2D/3D 모두 `부모 visible && 자식 featureType visible` 이다.
     * 부모를 다시 켜는 순간(showLayer) 이전에 꺼둔 자식이 되살아나지 않도록,
     * 부모 가시성을 적용한 뒤 **모든 자식**의 featureType 가시성을 다음 체크 상태
     * 기준으로 재적용한다 (전체 off 후 하나만 on 했는데 전부 보이던 문제의 핵심).
     */
    const applyLayerVisibility = (parentKey: string, children: string[], nextActive: Set<string>) => {
        if (!layerManager) return;
        const anyChildChecked = children.length === 0
            ? nextActive.has(parentKey)
            : children.some(child => nextActive.has(`${parentKey}.${child}`));

        if (anyChildChecked) {
            layerManager.showLayer('facility', parentKey);
            // show 이후에 적용해야 부모 show 로 되살아난 unchecked 자식이 다시 숨겨진다
            children.forEach(child =>
                layerManager.toggleByFeatureType('facility', parentKey, child, nextActive.has(`${parentKey}.${child}`)));
        } else {
            // 자식이 하나도 안 켜졌으면 부모도 실질 off — 자식 상태를 먼저 내리고 부모를 숨긴다
            children.forEach(child => layerManager.toggleByFeatureType('facility', parentKey, child, false));
            layerManager.hideLayer('facility', parentKey);
        }
    };

    /** 렌더 시점 closure 대신 store 최신 값으로 다음 체크 상태를 계산 (stale 방지) */
    const nextActiveSet = (add: string[], remove: string[]): Set<string> => {
        const next = new Set(useLayerStore.getState().activeLayerName ?? []);
        remove.forEach(k => next.delete(k));
        add.forEach(k => next.add(k));
        return next;
    };

    const toggleParent = (parentKey: string, checked: boolean) => {
        const children = nestedArrayFieldsMap[parentKey] || [];
        const childKeys = children.map(child => `${parentKey}.${child}`);
        const next = checked
            ? nextActiveSet([parentKey, ...childKeys], [])
            : nextActiveSet([], [parentKey, ...childKeys]);

        if (checked) {
            addActiveLayerName(parentKey);
            childKeys.forEach(addActiveLayerName);
        } else {
            removeActiveLayerName(parentKey);
            childKeys.forEach(removeActiveLayerName);
        }
        applyLayerVisibility(parentKey, children, next);
    };

    const toggleChild = (parentKey: string, childKey: string, checked: boolean) => {
        const fullKey = `${parentKey}.${childKey}`;
        const children = nestedArrayFieldsMap[parentKey] || [];
        const next = nextActiveSet(checked ? [fullKey] : [], checked ? [] : [fullKey]);
        // 자식이 하나라도 켜지면 부모도 켜짐, 전부 꺼지면 부모도 꺼짐 (isParentChecked 와 동일 규칙)
        const anyChecked = children.some(child => next.has(`${parentKey}.${child}`));
        if (anyChecked) next.add(parentKey);
        else next.delete(parentKey);

        if (checked) addActiveLayerName(fullKey);
        else removeActiveLayerName(fullKey);
        if (anyChecked) addActiveLayerName(parentKey);
        else removeActiveLayerName(parentKey);

        applyLayerVisibility(parentKey, children, next);
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

            {/* 데이터 없고 더미 생성이 가능한 레이어 */}
            {emptyDummyFields.map((field) => (
                <div key={field.key} className={styles.sectionLabel}>
                    <span style={{ flex: 1 }}>
                        {field.label}
                        {NEXTSIM_REQUIRED_KEYS.has(field.key) && (
                            <span title={requiredDotTitle(field.key)} style={{ color: requiredDotColor(field.key), marginLeft: 5, fontSize: 10 }}>●</span>
                        )}
                    </span>
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
                    <span style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb),0.4)' }}>헤더의 NextSim 배지에서 실행하세요</span>
                </div>
            )}
        </div>
    );
};

const deleteBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'rgba(var(--overlay-rgb),0.4)',
    cursor: 'pointer',
    fontSize: 10,
    padding: '0 3px',
    lineHeight: 1,
    flexShrink: 0,
};

const generateBtnStyle: React.CSSProperties = {
    background: 'rgba(var(--accent-text-rgb),0.12)',
    border: '1px solid rgba(var(--accent-text-rgb),0.3)',
    color: 'var(--accent-text)',
    cursor: 'pointer',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 4,
    flexShrink: 0,
};

export default Facility;
