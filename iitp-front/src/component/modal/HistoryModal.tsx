import React, { useEffect, useState } from 'react';
import {
    VerticalTimeline,
    VerticalTimelineElement,
} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import { menuCodeToHistoryStoreMap } from '@hooks/useHistoryInit';
import { buildMergedDataFromLogs} from "@utils/history";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";

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
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);

    const historyStore = menuCodeToHistoryStoreMap[menuCode];
    const featureStore = menuCodeToStoreMap[menuCode];

    const originData = featureStore.getState().originData;
    const firstKey = Object.keys(originData)[0] as keyof typeof originData;
    const originItem = originData[firstKey];
    const currentJsonData = featureStore.getState().currentJsonData;
    const originHistoryData = historyStore.getState().originHistoryData;

    const [currentData, setCurrentData] = useState<Record<string,any>>(originItem);

    useEffect(() => {
        if (!originHistoryData) return;
        const steps: HistoryStep[] = originHistoryData
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
    }, [originHistoryData]);

    useEffect(() => {
        if (selectedIndex === null && historySteps.length > 0) {
            const currentIdx = historySteps.findIndex(step => step.isCurrent);
            setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        }
    }, [historySteps, selectedIndex]);

    const handleSelect = (idx: number) => {
        const step = historySteps[idx];
        const confirmed = window.confirm(`${step.message} 시점으로 되돌리시겠습니까?`);
        if (confirmed) {
            setSelectedIndex(idx);

            const logsToApply = historySteps.slice(0, idx + 1);

            if (logsToApply.length === 0) {
                alert('변경할 데이터가 없습니다.');
                return;
            }
            const mergeData = buildMergedDataFromLogs(originItem, logsToApply, /*isUndo=*/true);
            featureStore.getState().setCurrentJsonData({
                //...currentData,
                [firstKey]: mergeData,
            });
        }
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
                            const isSelected = selectedIndex === idx;

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
