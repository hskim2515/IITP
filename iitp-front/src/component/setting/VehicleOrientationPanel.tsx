import React, { useCallback, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { useVehicleModelStore, DEFAULT_CORRECTIONS, CorrectionHpr } from '@stores/useVehicleModelStore';
import { useLayerStore } from '@stores/useLayerStore';
import styles from './VehicleOrientationPanel.module.css';

const VEHICLE_TYPES = ['CAR', 'TAXI', 'BUS', 'TRUCK', 'MOTO'] as const;
type VehicleType = typeof VEHICLE_TYPES[number];

const VEHICLE_LABELS: Record<VehicleType, string> = {
    CAR:   '승용차',
    TAXI:  '택시',
    BUS:   '버스',
    TRUCK: '트럭',
    MOTO:  '오토바이',
};

const toDeg = (r: number) => Math.round((r * 180) / Math.PI);
const toRad = (d: number) => (d * Math.PI) / 180;

// ─── 슬라이더 행 ─────────────────────────────────────────────────────────────
const HprRow: React.FC<{
    label: string;
    value: number;          // radians
    min?: number;
    max?: number;
    onChange: (rad: number) => void;
}> = ({ label, value, min = -180, max = 180, onChange }) => {
    const deg = toDeg(value);
    return (
        <div className={styles.row}>
            <span className={styles.axisLabel}>{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={deg}
                className={styles.slider}
                onChange={e => onChange(toRad(Number(e.target.value)))}
            />
            <input
                type="number"
                min={min}
                max={max}
                step={1}
                value={deg}
                className={styles.numInput}
                onChange={e => onChange(toRad(Number(e.target.value)))}
            />
            <span className={styles.unit}>°</span>
        </div>
    );
};

// ─── 메인 패널 ───────────────────────────────────────────────────────────────
const VehicleOrientationPanel: React.FC<{ onClose?: () => void; inline?: boolean }> = ({ onClose, inline = false }) => {
    const { correctionByType, setCorrectionForType } = useVehicleModelStore();
    const layerManager = useLayerStore(s => s.layerManager);
    const [activeType, setActiveType] = useState<VehicleType>('CAR');

    const current = correctionByType[activeType] ?? DEFAULT_CORRECTIONS[activeType] ?? { heading: 0, pitch: 0, roll: 0 };

    const applyLive = useCallback((vType: string, corr: CorrectionHpr) => {
        if (!layerManager) return;
        const hpr = new Cesium.HeadingPitchRoll(corr.heading, corr.pitch, corr.roll);
        (layerManager as any).updateVehicleCorrection?.(vType, hpr);
    }, [layerManager]);

    const update = (key: keyof CorrectionHpr, rad: number) => {
        const next = { ...current, [key]: rad };
        setCorrectionForType(activeType, next);
        applyLive(activeType, next);
    };

    const reset = () => {
        const def = DEFAULT_CORRECTIONS[activeType] ?? { heading: 0, pitch: 0, roll: 0 };
        setCorrectionForType(activeType, def);
        applyLive(activeType, def);
    };

    return (
        <div className={inline ? styles.panelInline : styles.panel}>
            {/* 헤더 */}
            <div className={styles.header}>
                <span className={styles.title}>차량 방향 보정</span>
                {!inline && onClose && (
                    <button className={styles.closeBtn} onClick={onClose}>✕</button>
                )}
            </div>

            {/* 타입 탭 */}
            <div className={styles.tabs}>
                {VEHICLE_TYPES.map(t => (
                    <button
                        key={t}
                        className={`${styles.tab} ${t === activeType ? styles.tabActive : ''}`}
                        onClick={() => setActiveType(t)}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* 슬라이더 */}
            <div className={styles.body}>
                <div className={styles.typeLabel}>{VEHICLE_LABELS[activeType]}</div>

                <HprRow label="Heading" value={current.heading} onChange={v => update('heading', v)} />
                <HprRow label="Pitch"   value={current.pitch}   min={-90} max={90} onChange={v => update('pitch', v)} />
                <HprRow label="Roll"    value={current.roll}    onChange={v => update('roll', v)} />

                <div className={styles.hint}>
                    모델이 뒤집혀 있으면 Roll ±180°, 옆으로 누워 있으면 Pitch ±90°,
                    진행방향과 정면이 다르면 Heading ±90°/180° 조정
                </div>

                <button className={styles.resetBtn} onClick={reset}>
                    기본값으로 리셋
                </button>
            </div>
        </div>
    );
};

export default VehicleOrientationPanel;
