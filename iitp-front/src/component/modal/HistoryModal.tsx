import React, { useEffect, useState } from 'react';
import {
    VerticalTimeline,
    VerticalTimelineElement,
} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import { menuCodeToHistoryStoreMap } from '@hooks/useHistoryInit';
import {buildMergedDataFromLogs, featureReverseLogs} from "@utils/history";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {apiConfig, ApiMenuKey} from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import {assignPropertyToResponseData} from "@utils/guid";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useMessageStore} from "@stores/useMessageStore";

interface Props {
    historySteps: HistoryStep[];
    onClose: () => void;
    menuCode: string;
}

interface HistoryStep {
    id: number;
    versionId: string;
    createdAt: string;
    json: Record<string, any>;
    message?: string;
    isCurrent?: boolean;
}

const HistoryModal: React.FC<Props> = ({ onClose, menuCode }) => {
    const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);

    const historyStore = menuCodeToHistoryStoreMap[menuCode];
    const featureStore = menuCodeToStoreMap[menuCode];

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const originData = featureStore.getState().originData;
    const firstKey = Object.keys(originData)[0] as keyof typeof originData;
    const originHistoryLogData = historyStore.getState().originHistoryData;
    const setCurrentSnapshotIndex = historyStore.getState().setCurrentSnapshotIndex;
    const setMessage = useMessageStore.getState().setMessage;

    useEffect(() => {
        if (!originHistoryLogData) return;
        const steps: HistoryStep[] = originHistoryLogData
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((item) => ({
                id: item.id,
                versionId: item.versionId,
                createdAt: item.createdAt,
                data: item.data,
                message: `변경사항 #${item.id}`,
                isCurrent: item.isCurrent,
            }));

        setHistorySteps(steps);

        getOriginHistoryData();
    }, [originHistoryLogData]);

    const getOriginHistoryData = async () => {
        const store = menuCodeToStoreMap[menuCode];
        if (!store) return;

        const originHistoryData = store.getState().originHistoryData;
        if (originHistoryData) return;

        try {
            const api = apiConfig[menuCode as ApiMenuKey].origin;
            const response = await axiosInstance({
                method: api.method,
                url: api.url + '/' + selectedScenario.key,
            });

            store.getState().setOriginHistoryData(response.data);
            assignPropertyToResponseData(response.data, menuCode);

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
                const mergeData = buildMergedDataFromLogs(originHistoryData[firstKey], logsToApply, /*isUndo=*/true);
                featureStore.getState().setCurrentJsonData({
                    //...currentData,
                    [firstKey]: mergeData,
                });
                featureReverseLogs(historyStore,historySteps.slice(0, idx + 1));
            },
            onCancel: () => {
            },
        });
    };

    return (
        <div className="modal-overlay">
            <div className="modal-container">
                <div className="modal-header">
                    <h2>변경 이력</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-content">
                    <VerticalTimeline layout="1-column-left">
                        {historySteps.map((step, idx) => {
                            const isSelected = historyStore.getState().currentSnapshotIndex === idx;
                            return (
                                <VerticalTimelineElement
                                    key={step.id}
                                    date={new Date(step.createdAt).toLocaleString()}
                                    contentStyle={{
                                        padding: '10px 12px',
                                        maxWidth: '300px',
                                        maxHeight: '100px',
                                        background: isSelected ? '#0ea5e9' : '#fff',
                                        color: isSelected ? '#fff' : '#1e1e1e',
                                        border: isSelected ? '2px solid #0284c7' : 'none',
                                        cursor: 'pointer',
                                    }}
                                    contentArrowStyle={{
                                        borderRight: isSelected
                                            ? '7px solid #0ea5e9'
                                            : '7px solid #fff',
                                    }}
                                    iconStyle={{
                                        top: 5,
                                        left: 5,
                                        width: 30,
                                        height: 30,
                                        background: isSelected ? '#0ea5e9' : 'green',
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
            </div>
        </div>
    );
};

export default HistoryModal;
