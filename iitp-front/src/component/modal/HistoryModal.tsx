import React, { useEffect, useState } from 'react';
import { VerticalTimeline, VerticalTimelineElement, } from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import { menuCodeToHistoryStoreMap } from "@hooks/useHistoryInit";

interface Props {
    historySteps: HistoryStep[];
    onSelect: (index: number) => void;
    onClose: () => void;
    menuCode: string;
}

type HistoryStep = {
    id: number;
    versionId: string;
    createdAt: string;
    json: Record<string, any>;
    message?: string;
    isCurrent?: boolean;
};

const HistoryModal: React.FC<Props> = ({ onSelect, onClose, menuCode }) => {
    const [ selectedIndex, setSelectedIndex ] = useState<number | null>(null);
    const store = menuCodeToHistoryStoreMap[menuCode];

    const originHistoryData = store.getState().originHistoryData;
    const [ historySteps, setHistorySteps ] = useState<Record<string, unknown>[]>([])

    useEffect(() => {
        if (!originHistoryData) return;

        const steps = originHistoryData
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((item) => ({
                id: item.id,
                timestamp: new Date(item.createdAt).toLocaleString(),
                message: `변경사항 #${ item.id }`,
                raw: item,
            }));

        setHistorySteps(steps);
    }, [ originHistoryData ]);

    const handleSelect = (idx: number) => {
        const step = historySteps[idx];
        const result = window.confirm(`${ step.message } 시점으로 되돌리시겠습니까?`);
        if (result) {
            setSelectedIndex(idx);
            onSelect(step.id);
        }
    };

    useEffect(() => {
        if (selectedIndex === null) {
            const currentIdx = historySteps.findIndex(step => step.isCurrent);
            setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        }
    }, [ historySteps ]);

    console.log('originHistoryData', originHistoryData);
    console.log('historySteps', historySteps);

    return (
        <div className="modal-overlay">
            <div className="modal-container">
                <div className="modal-header">
                    <h2>변경 이력</h2>
                    {/*<button className="modal-close-btn" onClick={onClose}>×</button>*/ }
                    <button className="close-btn" onClick={ onClose }>×</button>
                </div>
                <div className="modal-content">
                    <VerticalTimeline layout="1-column-left">
                        { historySteps.map((step, idx) => (
                            <VerticalTimelineElement
                                key={ step.id }
                                date={ step.timestamp }
                                contentStyle={ {
                                    padding: '10px 12px',
                                    maxWidth: '300px',
                                    maxHeight: '100px',
                                    background: selectedIndex === idx ? '#0ea5e9' : '#fff',
                                    color: selectedIndex === idx ? '#fff' : '#1e1e1e',
                                    border: selectedIndex === idx ? '2px solid #0284c7' : 'none',
                                    cursor: 'pointer',
                                } }
                                contentArrowStyle={ {
                                    borderRight: selectedIndex === idx
                                        ? '7px solid #0ea5e9'
                                        : '7px solid #fff'
                                } }
                                iconStyle={ {
                                    top: 5,
                                    left: 5,
                                    width: 30,
                                    height: 30,
                                    background: selectedIndex === idx ? '#0ea5e9' : 'green',
                                    color: '#fff',
                                } }
                                onTimelineElementClick={ () => handleSelect(idx) }
                            >
                                <h3 className="vertical-timeline-element-title">
                                    { step.message || '변경 사항' }
                                </h3>
                            </VerticalTimelineElement>
                        )) }
                    </VerticalTimeline>

                </div>
            </div>
        </div>
    );
};

export default HistoryModal;
