import React, { useEffect, useState } from 'react';
import { useLayerStore } from '@stores/useLayerStore';
import { useAnalysisSettingStore } from '@stores/useAnalysisSettingStore';
import { useVisualLayerSettingStore } from '@stores/useVisualLayerSettingStore';
import { useHeatmapSettingStore } from '@stores/useHeatmapSettingStore';
import { faCog } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import LayerSettingPopup from "../popup/LayerSettingPopup";
import { LayerField } from "@stores/useLayerSchemaStore";
import styles from "@css/ToolsPanel.module.css"

export interface Props {
    fields: LayerField[];
}

const ICON_BUBBLE_TYPE_LABELS: Record<string, string> = {
    ALL: '전체 차량',
    CAR: '승용차',
    TAXI: '택시',
    BUS: '버스',
    TRUCK: '화물차',
    MOTO: '이륜차',
};

const DWELL_TIME_LABELS: Record<string, string> = {
    dwell: '정체시간 강도',
    slowCount: '저속 차량 수',
    stopGo: '정지-재출발',
};

const INTERSECTION_PULSE_LABELS: Record<string, string> = {
    incoming: '유입량',
    waiting: '대기량',
    outgoing: '방출량',
};

const FLOW_BAR_LABELS: Record<string, string> = {
    volume: '교통량',
    avgSpeed: '평균속도',
    dwell: '체류강도',
};

type LayerSummary = {
    text?: string;
    color?: string;
    gradient?: string[];
};

const HARD_CODED_ANALYSIS_FIELDS: LayerField[] = [
    {
        id: -1001,
        key: 'flowBar',
        label: '링크 플로우 바',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
    {
        id: -1002,
        key: 'iconBubble',
        label: '링크 아이콘',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
    {
        id: -1009,
        key: 'dwellTime',
        label: '체류시간 분석',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
    {
        id: -1010,
        key: 'intersectionPulse',
        label: '교차로 펄스',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
    {
        id: -1003,
        key: 'guideway',
        label: '가이드웨이',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
    {
        id: -1004,
        key: 'traceVehicle',
        label: '차량 강조',
        formType: 'checkbox',
        basic: false,
        auth: 0,
    },
];

const Analysis = ({fields}: Props) => {
    const [selectedLayerType, setSelectedLayerType] = useState<string | undefined>(undefined);
    const iconBubbleVehicleType = useAnalysisSettingStore((s) => s.iconBubble.vehicleType);
    const traceVehicleType = useAnalysisSettingStore((s) => s.vehicle.highlightedType);
    const dwellTimeMetric = useAnalysisSettingStore((s) => s.dwellTime.metric);
    const intersectionPulseMetric = useAnalysisSettingStore((s) => s.intersectionPulse.metric);
    const flowBarMetric = useAnalysisSettingStore((s) => s.flowBar.metric);
    const heatmapColors = useHeatmapSettingStore((s) => s.colors);
    const guidewayColor = useVisualLayerSettingStore((s) => s.guidewayColor);
    const traceVehicleColor = useVisualLayerSettingStore((s) => s.traceVehicleColor);
    const {
        activeLayerName,
        addActiveLayerName,
        removeActiveLayerName,
        layerManager,
    } = useLayerStore();
    const mergedFields = [
        ...fields,
        ...HARD_CODED_ANALYSIS_FIELDS.filter(
            (hardcoded) => !fields.some((field) => field.key === hardcoded.key)
        ),
    ];

    const handleSettingClick = (type: string) => {
        setSelectedLayerType(prev => prev === type ? undefined : type);
    };

    const defaultSelected = mergedFields.find(field => field.basic)?.key || null;

    useEffect(() => {
        if (defaultSelected) {
            addActiveLayerName(defaultSelected);
        }
    }, [defaultSelected, addActiveLayerName]);

    const handleToggle = (value: string, checked: boolean) => {
        if (checked) {
            addActiveLayerName(value);
            layerManager?.showLayer("analyze", value);
        } else {
            removeActiveLayerName(value);
            layerManager?.hideLayer("analyze", value);
        }
    };

    const getSummaryLabel = (fieldKey: string): LayerSummary | null => {
        if (fieldKey === 'iconBubble') {
            return { text: ICON_BUBBLE_TYPE_LABELS[iconBubbleVehicleType] ?? iconBubbleVehicleType };
        }
        if (fieldKey === 'dwellTime') {
            return { text: DWELL_TIME_LABELS[dwellTimeMetric] ?? dwellTimeMetric };
        }
        if (fieldKey === 'intersectionPulse') {
            return { text: INTERSECTION_PULSE_LABELS[intersectionPulseMetric] ?? intersectionPulseMetric };
        }
        if (fieldKey === 'flowBar') {
            return { text: FLOW_BAR_LABELS[flowBarMetric] ?? flowBarMetric, gradient: heatmapColors };
        }
        if (fieldKey === 'guideway') {
            return { color: guidewayColor };
        }
        if (fieldKey === 'traceVehicle') {
            const typeLabel = ICON_BUBBLE_TYPE_LABELS[traceVehicleType] ?? traceVehicleType;
            return { text: typeLabel, color: traceVehicleColor };
        }
        return null;
    };

    return (
        <div>
            {activeLayerName && mergedFields.map(field => {
                const summary = getSummaryLabel(field.key);
                const isActive = activeLayerName.includes(field.key);
                const isOpen = selectedLayerType === field.key;
                return (
                <React.Fragment key={field.key}>
                    <label className={`${styles.layerItem} ${isActive ? styles.layerItemChecked : ''} ${isOpen ? styles.layerItemOpen : ''}`}>
                        <input
                            type={field.formType}
                            value={field.key}
                            checked={isActive}
                            onChange={e => handleToggle(field.key, e.target.checked)}
                        />
                        <span className={styles.layerItemLabelWrap}>
                            <span className={styles.layerItemLabel}>{field.label}</span>
                        </span>
                        {summary && (
                            <button
                                type="button"
                                className={styles.layerItemMetaBtn}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleSettingClick(field.key);
                                }}
                                title="설정 열기"
                            >
                                <span className={styles.layerItemMeta}>
                                    {summary.gradient && (
                                        <span
                                            className={styles.layerItemColorSwatch}
                                            style={{ background: `linear-gradient(90deg, ${summary.gradient.join(', ')})` }}
                                        />
                                    )}
                                    {!summary.gradient && summary.color && (
                                        <span
                                            className={styles.layerItemColorSwatch}
                                            style={{ background: summary.color }}
                                        />
                                    )}
                                    {summary.text && (
                                        <span className={styles.layerItemMetaText}>{summary.text}</span>
                                    )}
                                </span>
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.preventDefault(); handleSettingClick(field.key); }}
                            className={`${styles.layerItemSettingBtn} ${selectedLayerType === field.key ? styles.layerItemSettingBtnActive : ''}`}
                            title="설정"
                        >
                            <FontAwesomeIcon icon={faCog} size="sm"/>
                        </button>
                    </label>
                    {selectedLayerType === field.key && (
                        <div className={styles.settingInlinePanel}>
                            <LayerSettingPopup layerType={field.key} />
                        </div>
                    )}
                </React.Fragment>
                );
            })}
        </div>
    );
};

export default Analysis;
