import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '@api/axiosInstance';
import { useVehicleModelStore, VehicleModelItem, VehicleTypeRef } from '@stores/useVehicleModelStore';
import styles from '@css/Header.module.css';
import VehicleOrientationPanel from './VehicleOrientationPanel';

const VehicleModelSelector: React.FC = () => {
    const { models, selectedModel, setModels, setSelectedModel, setVehicleTypes } = useVehicleModelStore();
    const [panelOpen, setPanelOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        Promise.all([
            axiosInstance.get('/vehicle-models').then(r => r.data).catch(() => []),
            axiosInstance.get('/vehicle-types').then(r => r.data).catch(() => []),
        ]).then(([modelsData, typesData]) => {
            const data: VehicleModelItem[] = Array.isArray(modelsData) ? modelsData : [];
            const types: VehicleTypeRef[]  = Array.isArray(typesData)  ? typesData  : [];
            setModels(data);
            setVehicleTypes(types);
            if (data.length > 0 && !selectedModel) setSelectedModel(data[0]);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 패널 외부 클릭 시 닫기
    useEffect(() => {
        if (!panelOpen) return;
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setPanelOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [panelOpen]);

    return (
        <div ref={wrapRef} style={{ position: 'relative' }}>
            <div className={styles['modelSelectorWrap']}>
                {models.length > 0 && (
                    <>
                        <label className={styles['modelSelectorLabel']}>차량 모델</label>
                        <select
                            className={styles['modelSelector']}
                            value={selectedModel?.id ?? ''}
                            onChange={e => {
                                const found = models.find(m => String(m.id) === e.target.value);
                                setSelectedModel(found ?? null);
                            }}
                        >
                            {models.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                    </>
                )}

                {/* 방향 보정 패널 토글 버튼 */}
                <button
                    className={styles['orientationBtn']}
                    title="차량 방향 보정"
                    onClick={() => setPanelOpen(v => !v)}
                >
                    ⚙
                </button>
            </div>

            {panelOpen && (
                <VehicleOrientationPanel onClose={() => setPanelOpen(false)} />
            )}
        </div>
    );
};

export default VehicleModelSelector;
