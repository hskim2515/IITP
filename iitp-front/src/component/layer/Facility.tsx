import React, { useEffect, useMemo, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useLayerStore } from '@stores/useLayerStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from '@stores/useScenarioStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useLogStore } from '@stores/useLogStore';
import { useNetworkTileStore } from '@stores/useNetworkTileStore';
import { NETWORK_TILING } from '@utils/lodConstants';
import { assignPropertyToResponseData } from '@utils/guid';
import { generateDummySignals } from '@utils/signal';
import { generateDummyPavementMarkings } from '@utils/pavementMarking';
import { autoSaveChangedLayers } from '@utils/autoSave';
import { showAlert, showConfirm } from '@utils/dialog';
import styles from "@css/ToolsPanel.module.css";

export interface FacilityProps {
    fields: LayerField[];
}

// 더미 생성을 지원하는 레이어 키 → 생성 함수
const DUMMY_GENERATORS: Partial<Record<string, () => any>> = {
    signal: () => {
        const network = useNetworkStore.getState().currentJsonData as any;
        const signals = generateDummySignals(network);
        return signals.length > 0 ? { signals } : null;
    },
    pavementMarking: () => {
        const network = useNetworkStore.getState().currentJsonData as any;
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

    // store의 currentJsonData 변화를 감지해 visibleFields 재계산
    const [, setDataTick] = useState(0);

    // 차량 시뮬레이션 존재 여부 확인
    useEffect(() => {
        const scenarioKey = getActiveVersionId();
        if (!scenarioKey) return;
        const base = import.meta.env.VITE_API_URL;
        fetch(`${base}/vehicle/vehicle-route/${scenarioKey}/exists`)
            .then(res => res.ok ? res.json() : { exists: false })
            .then(({ exists }) => setVehicleExists(exists))
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

    // 데이터 없고 더미 생성 가능한 레이어
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
            const data = generator();
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
                body: JSON.stringify({ numVehicle: 0, regenerate: retryCount === 0 }),
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

    return (
        <div>
            {/* 데이터 있는 레이어 */}
            {visibleFields.map((field) => {
                const parentKey = field.key;
                const nestedFields = nestedArrayFieldsMap[parentKey] || [];
                const isExpanded = expandedParents[parentKey] ?? false;

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
                            <span style={{ flex: 1 }}>{field.label}</span>
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

            {/* 데이터 없고 더미 생성 가능한 레이어 */}
            {emptyDummyFields.map((field) => (
                <div key={field.key} className={styles.sectionLabel} style={{ opacity: 0.5, cursor: 'default' }}>
                    <span style={{ flex: 1 }}>{field.label}</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleGenerate(field); }}
                        disabled={generatingKey === field.key}
                        title={`${field.label} 더미 생성`}
                        style={generateBtnStyle}
                    >
                        {generatingKey === field.key ? '...' : '더미 생성'}
                    </button>
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
                            disabled={vehicleLoading}
                            title="차량 시뮬레이션 더미 생성"
                            style={generateBtnStyle}
                        >
                            {vehicleLoading ? '...' : '더미 생성'}
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

export default Facility;
