import React, { useEffect, useState } from 'react';
import {
    VerticalTimeline,
    VerticalTimelineElement,
} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import useHistoryInit, { menuCodeToHistoryStoreMap } from '@hooks/useHistoryInit';
import { GeoJSON } from 'ol/format';
import { interpolateByOffset } from '@utils/interpolateByOffset';
import { featureCollectionToFlatRow } from '@utils/grid';
import {buildJsonFromLogs, mergeJsonWithLog} from "@utils/history";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {FeatureCollection} from "geojson";

interface Props {
    historySteps: HistoryStep[];
    onClose: () => void;
    menuCode: string;
    setRowData: (rowData:Record<string, any>) => void;
}

interface HistoryStep {
    id: number;
    versionId: string;
    createdAt: string;
    json: Record<string, any>;
    message?: string;
    isCurrent?: boolean;
}

const HistoryModal: React.FC<Props> = ({ onClose, menuCode,setRowData }) => {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);

    const historyStore = menuCodeToHistoryStoreMap[menuCode];
    const featureStore = menuCodeToStoreMap[menuCode];

    const originFeatureData = featureStore.getState().originData?.geojson;
    const originHistoryData = historyStore.getState().originHistoryData;

    const [currentFeatureData, setCurrentFeatureData] = useState<FeatureCollection>(originFeatureData);

    useEffect(() => {
        if (!originHistoryData) return;

        const steps: HistoryStep[] = originHistoryData
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((item) => ({
                id: item.id,
                versionId: item.versionId,
                createdAt: item.createdAt,
                json: item.json,
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
            const prevIndex = selectedIndex;
            setSelectedIndex(idx);

            const isUndo = idx >= prevIndex;

            const from = Math.min(prevIndex, idx);
            const to = Math.max(prevIndex, idx);

            const slicedLogs = historySteps.slice(from, to).map(step => step.json);
            const orderedLogs = isUndo ? slicedLogs.reverse() : slicedLogs;

            const reconstructed = buildJsonFromLogs(currentFeatureData, orderedLogs, isUndo);
            setCurrentFeatureData(reconstructed);
            const format = new GeoJSON();
            const features = format.readFeatures(reconstructed, {
                featureProjection: "EPSG:4326",
                dataProjection: "EPSG:3857",
            });

            const interpolated = interpolateByOffset(features);

            const geojsonStr = format.writeFeatures(interpolated, {
                featureProjection: "EPSG:3857",
                dataProjection: "EPSG:4326",
            });

            const geojsonObj = JSON.parse(geojsonStr);
            featureStore.getState().setCurrentGeojson(geojsonObj);

            const restoredFlatRow = featureCollectionToFlatRow(geojsonObj);
            featureStore.getState().setFlatRow(restoredFlatRow);
            setRowData(restoredFlatRow);
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
