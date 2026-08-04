import React, { useEffect, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import {
    VerticalTimeline,
    VerticalTimelineElement,
} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import styles from '@css/HistoryModal.module.css';
import { menuCodeToHistoryStoreMap } from '@hooks/useHistoryInit';
import {buildMergedDataFromLogs, featureReverseLogs} from "@utils/history";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {apiConfig, ApiMenuKey} from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import {assignPropertyToResponseData} from "@utils/guid";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useMessageStore} from "@stores/useMessageStore";
import { HistoryStoreFactoryType } from "@stores/useHistoryStoreFactory";
import {
    filterSignalHistoryEntry,
    hasHistoryEntryChanges,
    SignalHistoryScope,
} from "@utils/signalHistory";

interface Props {
    historySteps?: HistoryStep[];
    menuCode: string;
    historyStoreOverride?: HistoryStoreFactoryType;
    historyScope?: SignalHistoryScope;
}

interface HistoryStep {
    id: number;
    versionId: string;
    createdAt: string;
    data: Record<string, any>;
    message?: string;
    isCurrent?: boolean;
}

const HistoryModal: React.FC<Props> = ({
                                           menuCode,
                                           historyStoreOverride,
                                           historyScope,
                                       }) => {
    const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);

    const historyStore = historyStoreOverride ?? menuCodeToHistoryStoreMap[menuCode];
    const featureStore = menuCodeToStoreMap[menuCode];

    const selectedScenario = useScenarioStore((s) => s.selectedScenario);
    const selectedScenarioVersion = useScenarioStore((s) => s.selectedScenarioVersion);
    const originHistoryLogData = (historyStore as any)((s: any) => s.originHistoryData);
    const setCurrentSnapshotIndex = historyStore.getState().setCurrentSnapshotIndex;
    const setMessage = useMessageStore.getState().setMessage;

    useEffect(() => {
        if (!originHistoryLogData) return;
        const steps: HistoryStep[] = [...originHistoryLogData]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((item) => {
                const data = historyScope
                    ? filterSignalHistoryEntry(item.data ?? {}, historyScope)
                    : item.data;
                return {
                    id: item.id,
                    versionId: item.versionId,
                    createdAt: item.createdAt,
                    data,
                    message: `변경사항 #${item.id}`,
                    isCurrent: item.isCurrent,
                };
            })
            .filter(step => !historyScope || hasHistoryEntryChanges(step.data));

        setHistorySteps(steps);

        getOriginHistoryData();
    }, [historyScope, originHistoryLogData]);

    const getOriginHistoryData = async () => {
        const store = menuCodeToStoreMap[menuCode];
        if (!store) return;

        const originHistoryData = store.getState().originHistoryData;
        if (originHistoryData) return;

        try {
            const api = apiConfig[menuCode as ApiMenuKey].origin;
            const response = await axiosInstance({
                method: api.method,
                url: api.url + '/' + getActiveVersionId(),
            });

            store.getState().setOriginHistoryData(response.data);
            assignPropertyToResponseData(response.data);

        } catch (err) {
            console.error(`[${menuCode}] 데이터 불러오기 실패`, err);
        } finally {
            console.log(`[${menuCode}] originHistoryData:::`, store.getState().originHistoryData);
        }
    };

    const handleSelect = (idx: number) => {
        const step = historySteps[idx];
        const currentSnapshotIndex = historyStore.getState().currentSnapshotIndex;

        if (idx === currentSnapshotIndex) return;

        setMessage({
            type: 'confirm',
            text: `${step.message} 시점으로 되돌리겠습니까?`,
            onConfirm: () => {
                setCurrentSnapshotIndex(idx);
                const logsToApply = historySteps.slice(0, idx + 1);

                if (logsToApply.length === 0) {
                    alert('변경할 데이터가 없습니다.');
                    return;
                }
                const originHistoryData = featureStore.getState().originHistoryData;
                const currentJsonData = featureStore.getState().currentJsonData;
                const firstKey = Object.keys(originHistoryData)[0];
                const baseData = historyScope
                    ? currentJsonData[firstKey]
                    : originHistoryData[firstKey];
                const mergeData = buildMergedDataFromLogs(baseData, logsToApply, /*isUndo=*/true);
                featureStore.getState().setCurrentJsonData({
                    [firstKey]: mergeData,
                });
                featureReverseLogs(historyStore,historySteps.slice(0, idx + 1));
            },
            onCancel: () => {
            },
        });
    };

    return (
        <div className={styles.inlinePanel}>
            <VerticalTimeline layout="1-column-left">
                {historySteps.map((step, idx) => {
                    const isSelected = historyStore.getState().currentSnapshotIndex === idx;
                    return (
                        <VerticalTimelineElement
                            key={step.id}
                            visible
                            date={new Date(step.createdAt).toLocaleString()}
                            contentStyle={{
                                padding: '10px 12px',
                                maxWidth: '300px',
                                // 선택됨: 항상 채도 높은 accent 고정색 + 흰 텍스트(PLAN_COLORS 칩과 동일 이유).
                                // 미선택: 라이브러리 기본 흰 카드 대신 앱 표면 토큰으로 통일 — 테마 반응.
                                background: isSelected ? 'var(--accent)' : 'rgb(var(--surface-popover-rgb))',
                                color: isSelected ? '#fff' : 'var(--text-primary)',
                                border: isSelected ? '2px solid var(--accent-text)' : '1px solid rgba(var(--overlay-rgb), 0.1)',
                                cursor: 'pointer',
                            }}
                            contentArrowStyle={{
                                borderRight: isSelected
                                    ? '7px solid var(--accent)'
                                    : '7px solid rgb(var(--surface-popover-rgb))',
                            }}
                            iconStyle={{
                                top: 5,
                                left: 5,
                                width: 30,
                                height: 30,
                                background: isSelected ? 'var(--accent)' : 'var(--color-success)',
                                color: '#fff',
                            }}
                            onTimelineElementClick={() => handleSelect(idx)}
                        >
                            <h3 className="vertical-timeline-element-title">
                                {step.message || '변경 사항'}
                            </h3>
                        </VerticalTimelineElement>
                    );
                })}
            </VerticalTimeline>
        </div>
    );
};

export default HistoryModal;
