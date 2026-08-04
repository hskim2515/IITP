import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import GlbMiniViewer from '@component/util/GlbMiniViewer';
import FileInput from '@component/util/FileInput';
import { buildFileUrl } from '@utils/fileUrl';
import {
    createDefaultVehicleTypeDraft,
    createPlatformOnlyDraft,
    findDefinitionForRecord,
    mergeVehicleTypeDetail,
    NEXTSIM_VEHICLE_TYPES,
    normalizeNextsimCodes,
    validateVehicleTypeDraft,
    VEHICLE_PARAMETER_META,
    VEHICLE_PARAMETER_NAMES,
    VehicleParameterName,
    VehicleTypeDefinition,
    VehicleTypeDraft,
    VehicleTypeRecord,
} from '@utils/vehicleTypeDefinitions';
import {
    useVehicleModelStore,
    VehicleModelItem,
} from '@stores/useVehicleModelStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import styles from '@css/VehicleTypeModelEditor.module.css';

interface Props {
    onMinimize: () => void;
    onClose: () => void;
}

interface EditorEntry {
    key: string;
    definition?: VehicleTypeDefinition;
    record?: VehicleTypeRecord;
    platformOnly: boolean;
}

interface HprDegrees {
    heading: number;
    pitch: number;
    roll: number;
}

interface CachedVehicleEditorState {
    draft: VehicleTypeDraft;
    modelId?: number;
    modelName: string;
    modelColor: string;
    modelLength: string;
    modelFile: File | null;
    modelFilePath: string | null;
    modelFileRemoved: boolean;
    hprDegrees: HprDegrees;
    zOffset: number;
}

const vehicleEditorDraftCache = new Map<string, CachedVehicleEditorState>();
let lastSelectedVehicleTypeKey = NEXTSIM_VEHICLE_TYPES[0].canonicalName;

const BASIC_PARAMETERS: VehicleParameterName[] = [
    'veh_len',
    'veh_width',
    'jamgap',
    'vf',
    'reaction_time',
    'max_acc',
    'max_dec',
];

const LANE_CHANGE_PARAMETERS: VehicleParameterName[] = [
    'lc_param1',
    'lc_param2',
    'lc_sensitivity',
];

const toDegrees = (radians: number) => Math.round((radians * 180) / Math.PI);
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const parseHpr = (raw?: string | { heading?: number; pitch?: number; roll?: number }): HprDegrees => {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
            heading: toDegrees(value?.heading ?? 0),
            pitch: toDegrees(value?.pitch ?? 0),
            roll: toDegrees(value?.roll ?? Math.PI),
        };
    } catch {
        return { heading: 0, pitch: 0, roll: 180 };
    }
};

const ModelAdjustmentRow: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit: string;
    onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, unit, onChange }) => (
    <label className={styles.adjustmentRow}>
        <span>{label}</span>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(Number(event.target.value))}
        />
        <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(Number(event.target.value))}
        />
        <em>{unit}</em>
    </label>
);

const createEmptyPlatformRecord = (): VehicleTypeRecord => ({
    vehicleId: '',
    name: '새 표시 유형',
    v2x: 'off',
    drt: '0',
    maxPax: '0',
    nextsimTypeCode: '',
});

const VehicleTypeModelEditor: React.FC<Props> = ({ onMinimize, onClose }) => {
    const versionId = useScenarioStore(state => state.selectedScenarioVersion?.key ?? '');
    const { setModels, setVehicleTypes } = useVehicleModelStore();
    const [records, setRecords] = useState<VehicleTypeRecord[]>([]);
    const [models, setLocalModels] = useState<VehicleModelItem[]>([]);
    const [selectedKey, setSelectedKey] = useState(lastSelectedVehicleTypeKey);
    const [draft, setDraft] = useState<VehicleTypeDraft>(
        createDefaultVehicleTypeDraft(NEXTSIM_VEHICLE_TYPES[0]),
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [laneChangeOpen, setLaneChangeOpen] = useState(false);
    const [modelOpen, setModelOpen] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    const [modelId, setModelId] = useState<number | undefined>();
    const [modelName, setModelName] = useState('');
    const [modelColor, setModelColor] = useState('#4f8cff');
    const [modelLength, setModelLength] = useState('');
    const [modelFile, setModelFile] = useState<File | null>(null);
    const [modelFilePath, setModelFilePath] = useState<string | null>(null);
    const [modelFileRemoved, setModelFileRemoved] = useState(false);
    const [hprDegrees, setHprDegrees] = useState<HprDegrees>({ heading: 0, pitch: 0, roll: 180 });
    const [zOffset, setZOffset] = useState(0.2);
    const [panelHeight, setPanelHeight] = useState(() => (
        Math.min(760, Math.max(440, window.innerHeight * 0.72))
    ));
    const blobUrlRef = useRef<string | null>(null);
    const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const latestEditorStateRef = useRef<CachedVehicleEditorState | null>(null);
    const selectedKeyRef = useRef(selectedKey);
    const editorChangeVersionRef = useRef(0);

    const loadLists = useCallback(async () => {
        if (!versionId) throw new Error('선택된 시나리오 버전이 없습니다.');
        const response = await axiosInstance.get(`/vehicle-config/${encodeURIComponent(versionId)}`);
        const nextRecords = Array.isArray(response.data?.vehicleTypes) ? response.data.vehicleTypes : [];
        const nextModels = Array.isArray(response.data?.vehicleModels) ? response.data.vehicleModels : [];
        setRecords(nextRecords);
        setLocalModels(nextModels);
        setModels(nextModels);
        setVehicleTypes(nextRecords);
        return { nextRecords, nextModels };
    }, [setModels, setVehicleTypes, versionId]);

    useEffect(() => {
        setLoading(true);
        setMessage(null);
        loadLists()
            .catch(error => {
                console.error('[VehicleTypeModelEditor] 목록 로드 실패', error);
                setMessage({ type: 'error', text: '교통수단 유형을 불러오지 못했습니다.' });
            })
            .finally(() => setLoading(false));
    }, [loadLists]);

    const entries = useMemo<EditorEntry[]>(() => {
        const required = NEXTSIM_VEHICLE_TYPES.map(definition => ({
            key: definition.canonicalName,
            definition,
            record: records.find(record => (
                normalizeNextsimCodes(record.nextsimTypeCode).includes(definition.nextsimTypeCode)
            )),
            platformOnly: false,
        }));
        const platformOnly = records
            .filter(record => record.platformOnly || !findDefinitionForRecord(record))
            .map(record => ({
                key: `platform-${record.id}`,
                record,
                platformOnly: true,
            }));
        return [...required, ...platformOnly];
    }, [records]);

    const selectedEntry = useMemo(
        () => entries.find(entry => entry.key === selectedKey),
        [entries, selectedKey],
    );

    useEffect(() => {
        if (entries.length === 0 || selectedEntry) return;
        const fallbackKey = entries[0].key;
        lastSelectedVehicleTypeKey = fallbackKey;
        setSelectedKey(fallbackKey);
    }, [entries, selectedEntry]);

    const applyModel = useCallback((
        vehicleTypeId: number | undefined,
        vehicleTypeKey: string | undefined,
        sourceModels: VehicleModelItem[],
    ) => {
        const model = sourceModels.find(item => (
            (vehicleTypeKey && item.vehicleTypeKey === vehicleTypeKey)
            || (vehicleTypeId != null && item.vehicleTypeId === vehicleTypeId)
        ));
        setModelId(model?.id);
        setModelName(model?.name ?? '');
        setModelColor(model?.color ?? '#4f8cff');
        setModelLength(model?.length != null ? String(model.length) : '');
        setModelFile(null);
        setModelFilePath(model?.filePath ?? null);
        setModelFileRemoved(false);
        setHprDegrees(parseHpr(model?.correctionHpr));
        setZOffset(model?.zOffset ?? 0.2);
    }, []);

    latestEditorStateRef.current = {
        draft,
        modelId,
        modelName,
        modelColor,
        modelLength,
        modelFile,
        modelFilePath,
        modelFileRemoved,
        hprDegrees,
        zOffset,
    };
    selectedKeyRef.current = selectedKey;
    lastSelectedVehicleTypeKey = selectedKey;

    const restoreCachedState = useCallback((cached: CachedVehicleEditorState) => {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = cached.modelFile ? URL.createObjectURL(cached.modelFile) : null;
        setDraft(cached.draft);
        setModelId(cached.modelId);
        setModelName(cached.modelName);
        setModelColor(cached.modelColor);
        setModelLength(cached.modelLength);
        setModelFile(cached.modelFile);
        setModelFilePath(cached.modelFilePath);
        setModelFileRemoved(cached.modelFileRemoved);
        setHprDegrees(cached.hprDegrees);
        setZOffset(cached.zOffset);
    }, []);

    useEffect(() => {
        if (!selectedEntry) return;
        const cacheKey = `${versionId}:${selectedEntry.key}`;
        const cached = vehicleEditorDraftCache.get(cacheKey);
        if (cached) {
            restoreCachedState(cached);
            return;
        }
        let cancelled = false;
        const changeVersionAtLoadStart = editorChangeVersionRef.current;
        const canApplyLoadedData = () => (
            !cancelled && editorChangeVersionRef.current === changeVersionAtLoadStart
        );
        const loadDetail = async () => {
            const baseDraft = selectedEntry.definition
                ? createDefaultVehicleTypeDraft(selectedEntry.definition)
                : createPlatformOnlyDraft(selectedEntry.record ?? createEmptyPlatformRecord());
            if (selectedEntry.record?.id == null) {
                if (canApplyLoadedData()) {
                    setDraft(baseDraft);
                    applyModel(undefined, selectedEntry.key, models);
                }
                return;
            }
            try {
                const rows = Object.entries(selectedEntry.record.parameters ?? {}).map(
                    ([parameterName, value]) => ({ parameterName, ...value }),
                );
                if (canApplyLoadedData()) {
                    setDraft(mergeVehicleTypeDetail(
                        selectedEntry.record,
                        rows,
                        selectedEntry.definition,
                    ));
                    applyModel(selectedEntry.record.id, selectedEntry.record.key ?? selectedEntry.key, models);
                }
            } catch (error) {
                console.error('[VehicleTypeModelEditor] 상세 로드 실패', error);
                if (canApplyLoadedData()) {
                    setDraft({ ...baseDraft, id: selectedEntry.record.id });
                    applyModel(selectedEntry.record.id, selectedEntry.record.key ?? selectedEntry.key, models);
                    setMessage({ type: 'error', text: '상세값 일부를 불러오지 못해 기본값을 표시합니다.' });
                }
            }
        };
        void loadDetail();
        return () => { cancelled = true; };
    }, [applyModel, models, restoreCachedState, selectedEntry, versionId]);

    useEffect(() => () => {
        if (latestEditorStateRef.current) {
            vehicleEditorDraftCache.set(`${versionId}:${selectedKeyRef.current}`, latestEditorStateRef.current);
        }
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    }, [versionId]);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!resizeRef.current) return;
            const nextHeight = resizeRef.current.startHeight
                + (resizeRef.current.startY - event.clientY);
            setPanelHeight(Math.min(window.innerHeight - 90, Math.max(360, nextHeight)));
        };
        const handleMouseUp = () => {
            resizeRef.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const startResizing = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        resizeRef.current = { startY: event.clientY, startHeight: panelHeight };
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    };

    const previewUrl = useMemo(() => {
        if (modelFile && blobUrlRef.current) return blobUrlRef.current;
        return modelFilePath ? buildFileUrl(modelFilePath) : null;
    }, [modelFile, modelFilePath]);

    const handleModelFile = (file: File | null) => {
        editorChangeVersionRef.current += 1;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = file ? URL.createObjectURL(file) : null;
        setModelFile(file);
        if (file) setModelFileRemoved(false);
    };

    const clearModelFile = () => {
        editorChangeVersionRef.current += 1;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
        setModelFile(null);
        setModelFilePath(null);
        setModelFileRemoved(true);
    };

    const selectVehicleType = (nextKey: string) => {
        if (nextKey === selectedKey) return;
        if (latestEditorStateRef.current) {
            vehicleEditorDraftCache.set(`${versionId}:${selectedKey}`, latestEditorStateRef.current);
        }
        lastSelectedVehicleTypeKey = nextKey;
        setSelectedKey(nextKey);
        setMessage(null);
    };

    const updateParameter = (
        name: VehicleParameterName,
        field: 'mean' | 'sd' | 'min' | 'max' | 'dist',
        value: string,
    ) => {
        setDraft(current => ({
            ...current,
            parameters: {
                ...current.parameters,
                [name]: {
                    ...current.parameters[name],
                    [field]: value,
                },
            },
        }));
    };

    const handleSave = async () => {
        const errors = validateVehicleTypeDraft(draft);
        if (errors.length > 0) {
            setMessage({ type: 'error', text: errors[0].message });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            if (!versionId) throw new Error('선택된 시나리오 버전이 없습니다.');
            const vehicleType = {
                ...draft,
                key: draft.platformOnly
                    ? draft.vehicleId
                    : (draft.canonicalName ?? selectedEntry?.definition?.canonicalName),
            };
            const configuration = {
                key: vehicleType.key,
                vehicleType,
                model: {
                    id: modelId,
                    key: vehicleType.key,
                    vehicleTypeId: draft.id,
                    vehicleTypeKey: vehicleType.key,
                    name: modelName || `${draft.name} 기본 모델`,
                    color: modelColor,
                    length: modelLength,
                    fileName: null,
                    filePath: modelFilePath,
                    correctionHpr: JSON.stringify({
                        heading: toRadians(hprDegrees.heading),
                        pitch: toRadians(hprDegrees.pitch),
                        roll: toRadians(hprDegrees.roll),
                    }),
                    zOffset,
                },
                removeFile: modelFileRemoved,
            };
            const data = new FormData();
            data.append('configuration', JSON.stringify(configuration));
            if (modelFile) data.append('file', modelFile);
            await axiosInstance.put(
                `/vehicle-config/${encodeURIComponent(versionId)}`,
                data,
            );
            vehicleEditorDraftCache.delete(`${versionId}:${selectedKey}`);
            const refreshed = await loadLists();
            const savedType = refreshed.nextRecords.find((record: VehicleTypeRecord) => (
                record.key === vehicleType.key
                || record.vehicleId === vehicleType.vehicleId
            ));
            applyModel(savedType?.id, vehicleType.key, refreshed.nextModels);
            setDraft(current => ({ ...current, id: savedType?.id }));
            if (draft.platformOnly) {
                vehicleEditorDraftCache.delete(`${versionId}:platform-new`);
                lastSelectedVehicleTypeKey = `platform-${savedType?.id}`;
                setSelectedKey(lastSelectedVehicleTypeKey);
            }
            setMessage({ type: 'success', text: '시나리오 버전의 XML과 표시 모델을 저장했습니다.' });
        } catch (error) {
            console.error('[VehicleTypeModelEditor] 저장 실패', error);
            setMessage({
                type: 'error',
                text: '차량 유형 XML과 표시 모델 저장에 실패했습니다.',
            });
        } finally {
            setSaving(false);
        }
    };

    const addPlatformType = () => {
        const newCacheKey = `${versionId}:platform-new`;
        if (!vehicleEditorDraftCache.has(newCacheKey)) {
            vehicleEditorDraftCache.set(newCacheKey, {
                draft: createPlatformOnlyDraft(createEmptyPlatformRecord()),
                modelId: undefined,
                modelName: '',
                modelColor: '#4f8cff',
                modelLength: '',
                modelFile: null,
                modelFilePath: null,
                modelFileRemoved: false,
                hprDegrees: { heading: 0, pitch: 0, roll: 180 },
                zOffset: 0.2,
            });
        }
        const cached = vehicleEditorDraftCache.get(newCacheKey);
        if (latestEditorStateRef.current) {
            vehicleEditorDraftCache.set(`${versionId}:${selectedKey}`, latestEditorStateRef.current);
        }
        lastSelectedVehicleTypeKey = 'platform-new';
        setSelectedKey('platform-new');
        if (cached) restoreCachedState(cached);
        setMessage({ type: 'info', text: '표시 전용 유형은 NextSim 입력에 포함되지 않습니다.' });
    };

    const hprRad = {
        heading: toRadians(hprDegrees.heading),
        pitch: toRadians(hprDegrees.pitch),
        roll: toRadians(hprDegrees.roll),
    };

    if (loading) {
        return <div className={styles.loading}>교통수단 유형을 불러오는 중...</div>;
    }

    return (
        <div className={styles.editor} style={{ height: panelHeight }}>
            <div className={styles.resizeHandle} onMouseDown={startResizing}>
                <div />
            </div>
            <header className={styles.header}>
                <div className={styles.headerTitle}>
                    <i />
                    <strong>교통수단 유형</strong>
                    <span>NextSim 주행 특성과 2D/3D 표시 모델을 함께 관리합니다.</span>
                </div>
                <div className={styles.headerActions}>
                    <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
                <div className={styles.windowControls}>
                    <button
                        type="button"
                        className={styles.windowButton}
                        onClick={onMinimize}
                        title="최소화"
                        aria-label="최소화"
                    >
                        −
                    </button>
                    <button type="button" className={styles.closeButton} onClick={onClose}>×</button>
                </div>
            </header>

            <div className={styles.content}>
                <aside className={styles.sidebar}>
                    <div className={styles.sidebarTitle}>NextSim 필수 유형</div>
                    <div className={styles.typeList}>
                        {entries.filter(entry => !entry.platformOnly).map(entry => {
                            const selected = entry.key === selectedKey;
                            const modelConnected = models.some(model => (
                                model.vehicleTypeKey === (entry.record?.key ?? entry.key)
                                || model.vehicleTypeId === entry.record?.id
                            ));
                            return (
                                <button
                                    type="button"
                                    key={entry.key}
                                    className={`${styles.typeItem} ${selected ? styles.selected : ''}`}
                                    onClick={() => selectVehicleType(entry.key)}
                                >
                                    <span className={styles.typeIcon}>{entry.definition?.nextsimTypeCode}</span>
                                    <span className={styles.typeText}>
                                        <strong>{entry.definition?.label}</strong>
                                        <small>{entry.definition?.canonicalName}</small>
                                    </span>
                                    <span className={styles.statuses}>
                                        <i className={entry.record ? styles.ok : styles.warning}>
                                            {entry.record ? '입력' : '기본값'}
                                        </i>
                                        <i className={modelConnected ? styles.ok : styles.muted}>
                                            {modelConnected ? '사용자 모델' : '기본 표시'}
                                        </i>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className={styles.sidebarTitleRow}>
                        <span>플랫폼 표시 유형</span>
                        <button type="button" onClick={addPlatformType}>+ 추가</button>
                    </div>
                    <div className={styles.typeList}>
                        {entries.filter(entry => entry.platformOnly).map(entry => (
                            <button
                                type="button"
                                key={entry.key}
                                className={`${styles.typeItem} ${entry.key === selectedKey ? styles.selected : ''}`}
                                onClick={() => selectVehicleType(entry.key)}
                            >
                                <span className={styles.typeIcon}>2D</span>
                                <span className={styles.typeText}>
                                    <strong>{entry.record?.name || entry.record?.vehicleId}</strong>
                                    <small>표시 전용</small>
                                </span>
                            </button>
                        ))}
                        {entries.every(entry => !entry.platformOnly) && selectedKey !== 'platform-new' && (
                            <div className={styles.emptyList}>추가된 표시 유형이 없습니다.</div>
                        )}
                        {selectedKey === 'platform-new' && (
                            <button type="button" className={`${styles.typeItem} ${styles.selected}`}>
                                <span className={styles.typeIcon}>NEW</span>
                                <span className={styles.typeText}><strong>새 표시 유형</strong></span>
                            </button>
                        )}
                    </div>
                </aside>

                <main
                    className={styles.main}
                    onChangeCapture={() => {
                        editorChangeVersionRef.current += 1;
                    }}
                >
                    <section className={styles.summary}>
                        <div>
                            <div className={styles.eyebrow}>
                                {draft.platformOnly ? 'PLATFORM VISUAL TYPE' : 'NEXTSIM VEHICLE TYPE'}
                            </div>
                            <h2>{draft.name || '이름 없음'}</h2>
                            <p>
                                {selectedEntry?.definition?.description
                                    ?? 'NextSim 계산에는 사용되지 않고 결과 화면의 색상과 모델을 결정합니다.'}
                            </p>
                        </div>
                        <div className={styles.summaryBadges}>
                            {!draft.platformOnly && <span>출력 코드 {draft.nextsimTypeCode}</span>}
                            {!draft.routeSupported && !draft.platformOnly && <span className={styles.unsupported}>경로 생성 미지원</span>}
                            <span>{modelId != null ? '3D 모델 연결됨' : '기본 모델 사용'}</span>
                        </div>
                    </section>

                    {message && (
                        <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>
                    )}

                    <section className={styles.card}>
                        <div className={styles.cardHeader}>
                            <div>
                                <h3>유형 기본 정보</h3>
                                <p>NextSim 코드와 정식 유형명은 시스템에서 관리합니다.</p>
                            </div>
                        </div>
                        <div className={styles.infoGrid}>
                            <label>
                                <span>표시 이름</span>
                                <input
                                    value={draft.name}
                                    onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                                />
                            </label>
                            <label>
                                <span>차종 ID</span>
                                <input
                                    value={draft.vehicleId}
                                    readOnly={!draft.platformOnly}
                                    onChange={event => setDraft(current => ({ ...current, vehicleId: event.target.value }))}
                                />
                            </label>
                            {!draft.platformOnly && (
                                <>
                                    <label>
                                        <span>NextSim 유형</span>
                                        <input value={draft.canonicalName ?? ''} readOnly />
                                    </label>
                                    <label>
                                        <span>결과 코드</span>
                                        <input value={draft.nextsimTypeCode} readOnly />
                                    </label>
                                </>
                            )}
                            <label>
                                <span>최대 탑승 인원</span>
                                <div className={styles.withUnit}>
                                    <input
                                        type="number"
                                        min="0"
                                        value={draft.maxPax}
                                        onChange={event => setDraft(current => ({ ...current, maxPax: event.target.value }))}
                                    />
                                    <em>명</em>
                                </div>
                            </label>
                        </div>
                    </section>

                    {!draft.platformOnly && (
                        <>
                            <section className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h3>기본 주행 특성</h3>
                                        <p>가장 많이 사용하는 평균값만 표시합니다. 범위와 분포는 상세 설정에서 수정할 수 있습니다.</p>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.defaultButton}
                                        onClick={() => {
                                            const definition = selectedEntry?.definition;
                                            if (definition) setDraft(current => ({
                                                ...createDefaultVehicleTypeDraft(definition),
                                                id: current.id,
                                                name: current.name,
                                                vehicleId: current.vehicleId,
                                            }));
                                        }}
                                    >
                                        유형 기본값 복원
                                    </button>
                                </div>
                                <div className={styles.basicGrid}>
                                    {BASIC_PARAMETERS.map(name => (
                                        <label key={name} className={styles.metric}>
                                            <span>{VEHICLE_PARAMETER_META[name].label}</span>
                                            <div className={styles.withUnit}>
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={draft.parameters[name].mean}
                                                    onChange={event => updateParameter(name, 'mean', event.target.value)}
                                                />
                                                <em>{VEHICLE_PARAMETER_META[name].unit}</em>
                                            </div>
                                            <small>
                                                {draft.parameters[name].min}~{draft.parameters[name].max}
                                                {' · '}
                                                {draft.parameters[name].dist === 'normal' ? '정규분포' : '로그정규분포'}
                                            </small>
                                        </label>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.card}>
                                <button
                                    type="button"
                                    className={styles.collapseHeader}
                                    onClick={() => setAdvancedOpen(open => !open)}
                                >
                                    <span>
                                        <strong>상세 분포 설정</strong>
                                        <small>최소·평균·최대·표준편차와 분포 종류</small>
                                    </span>
                                    <b>{advancedOpen ? '접기' : '펼치기'} {advancedOpen ? '⌃' : '⌄'}</b>
                                </button>
                                {advancedOpen && (
                                    <div className={styles.distributionTable}>
                                        <div className={styles.tableHead}>
                                            <span>항목</span><span>평균</span><span>표준편차</span>
                                            <span>최소</span><span>최대</span><span>분포</span>
                                        </div>
                                        {BASIC_PARAMETERS.map(name => (
                                            <div className={styles.tableRow} key={name}>
                                                <strong>{VEHICLE_PARAMETER_META[name].label}</strong>
                                                {(['mean', 'sd', 'min', 'max'] as const).map(field => (
                                                    <input
                                                        key={field}
                                                        type="number"
                                                        step="any"
                                                        value={draft.parameters[name][field]}
                                                        onChange={event => updateParameter(name, field, event.target.value)}
                                                    />
                                                ))}
                                                <select
                                                    value={draft.parameters[name].dist}
                                                    onChange={event => updateParameter(name, 'dist', event.target.value)}
                                                >
                                                    <option value="normal">정규분포</option>
                                                    <option value="lognormal">로그정규분포</option>
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className={styles.card}>
                                <button
                                    type="button"
                                    className={styles.collapseHeader}
                                    onClick={() => setLaneChangeOpen(open => !open)}
                                >
                                    <span>
                                        <strong>차로변경 상세 설정</strong>
                                        <small>일반 사용자는 유형 기본값을 그대로 사용할 수 있습니다.</small>
                                    </span>
                                    <b>{laneChangeOpen ? '접기' : '펼치기'} {laneChangeOpen ? '⌃' : '⌄'}</b>
                                </button>
                                {laneChangeOpen && (
                                    <div className={styles.distributionTable}>
                                        <div className={styles.tableHead}>
                                            <span>항목</span><span>평균</span><span>표준편차</span>
                                            <span>최소</span><span>최대</span><span>분포</span>
                                        </div>
                                        {LANE_CHANGE_PARAMETERS.map(name => (
                                            <div className={styles.tableRow} key={name}>
                                                <strong>{VEHICLE_PARAMETER_META[name].label}</strong>
                                                {(['mean', 'sd', 'min', 'max'] as const).map(field => (
                                                    <input
                                                        key={field}
                                                        type="number"
                                                        step="any"
                                                        value={draft.parameters[name][field]}
                                                        onChange={event => updateParameter(name, field, event.target.value)}
                                                    />
                                                ))}
                                                <select
                                                    value={draft.parameters[name].dist}
                                                    onChange={event => updateParameter(name, 'dist', event.target.value)}
                                                >
                                                    <option value="normal">정규분포</option>
                                                    <option value="lognormal">로그정규분포</option>
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div>
                                        <h3>고급 입력 설정</h3>
                                        <p>V2X 사용 여부입니다.</p>
                                    </div>
                                    <select
                                        className={styles.compactSelect}
                                        value={draft.v2x}
                                        onChange={event => setDraft(current => ({
                                            ...current,
                                            v2x: event.target.value === 'on' ? 'on' : 'off',
                                        }))}
                                    >
                                        <option value="off">V2X 사용 안 함</option>
                                        <option value="on">V2X 사용</option>
                                    </select>
                                </div>
                            </section>
                        </>
                    )}

                    <section className={styles.card}>
                        <button
                            type="button"
                            className={styles.collapseHeader}
                            onClick={() => setModelOpen(open => !open)}
                        >
                            <span>
                                <strong>2D/3D 표시 모델</strong>
                                <small>이 설정은 플랫폼 가시화에만 사용되며 NextSim으로 전달되지 않습니다.</small>
                            </span>
                            <b>{modelOpen ? '접기' : '펼치기'} {modelOpen ? '⌃' : '⌄'}</b>
                        </button>
                        {modelOpen && (
                            <div className={styles.modelGrid}>
                                <div className={styles.modelPreviewColumn}>
                                    <div className={styles.preview}>
                                        {previewUrl ? (
                                            <GlbMiniViewer glbUrl={previewUrl} hprRad={hprRad} zOffset={zOffset} />
                                        ) : (
                                            <div className={styles.noPreview}>
                                                <span aria-hidden="true">🧊</span>
                                                <small>GLB 파일을 선택하면 여기서 미리보기</small>
                                            </div>
                                        )}
                                    </div>
                                    <label className={styles.fileField}>
                                        <span>3D GLB 파일</span>
                                        <FileInput
                                            value={modelFile ?? modelFilePath}
                                            onChange={handleModelFile}
                                            showPreview={false}
                                            onClear={clearModelFile}
                                        />
                                    </label>
                                </div>
                                <div className={styles.modelForm}>
                                    <fieldset className={styles.modelAdjustments} disabled={!previewUrl}>
                                        <div className={styles.adjustmentHeader}>
                                            <div>
                                                <strong>방향·높이 보정</strong>
                                                <small>
                                                    {previewUrl
                                                        ? '큰 미리보기에서 모델 방향과 높이를 확인하며 조절합니다.'
                                                        : 'GLB 파일을 선택하면 보정 기능을 사용할 수 있습니다.'}
                                                </small>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setHprDegrees({ heading: 0, pitch: 0, roll: 180 });
                                                    setZOffset(0.2);
                                                }}
                                            >
                                                기본값 리셋
                                            </button>
                                        </div>
                                        <ModelAdjustmentRow
                                            label="Heading"
                                            value={hprDegrees.heading}
                                            min={-180}
                                            max={180}
                                            unit="°"
                                            onChange={value => setHprDegrees(current => ({ ...current, heading: value }))}
                                        />
                                        <ModelAdjustmentRow
                                            label="Pitch"
                                            value={hprDegrees.pitch}
                                            min={-90}
                                            max={90}
                                            unit="°"
                                            onChange={value => setHprDegrees(current => ({ ...current, pitch: value }))}
                                        />
                                        <ModelAdjustmentRow
                                            label="Roll"
                                            value={hprDegrees.roll}
                                            min={-180}
                                            max={180}
                                            unit="°"
                                            onChange={value => setHprDegrees(current => ({ ...current, roll: value }))}
                                        />
                                        <ModelAdjustmentRow
                                            label="Z-offset"
                                            value={zOffset}
                                            min={-10}
                                            max={10}
                                            step={0.5}
                                            unit="m"
                                            onChange={setZOffset}
                                        />
                                    </fieldset>
                                    <div className={styles.modelInfoTitle}>
                                        <strong>모델 기본정보</strong>
                                        <small>2D 지도 표시와 모델 식별에 사용됩니다.</small>
                                    </div>
                                    <label>
                                        <span>모델 이름</span>
                                        <input value={modelName} onChange={event => setModelName(event.target.value)} />
                                    </label>
                                    <label>
                                        <span>차량 타입</span>
                                        <input value={draft.name} readOnly />
                                    </label>
                                    <label>
                                        <span>2D 표시 색상</span>
                                        <div className={styles.colorField}>
                                            <input type="color" value={modelColor} onChange={event => setModelColor(event.target.value)} />
                                            <input value={modelColor} onChange={event => setModelColor(event.target.value)} />
                                        </div>
                                    </label>
                                    <label>
                                        <span>기준 길이</span>
                                        <div className={styles.withUnit}>
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={modelLength}
                                                onChange={event => setModelLength(event.target.value)}
                                            />
                                            <em>m</em>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        )}
                    </section>
                </main>
            </div>
        </div>
    );
};

export default VehicleTypeModelEditor;
