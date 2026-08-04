import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import axiosInstance from '@api/axiosInstance';
import { apiConfig } from '@config/apiConfig';
import { MenuTreeResponse } from '@type/openapi.gen';
import GlbMiniViewer from '@component/util/GlbMiniViewer';
import FileInput from '@component/util/FileInput';
import { buildFileUrl } from '@utils/fileUrl';
import styles from '@css/PropertyPopup.module.css';
import { useVehicleModelStore, VehicleModelItem, VehicleTypeRef } from '@stores/useVehicleModelStore';
import { useLayerStore } from '@stores/useLayerStore';

interface HprDeg { heading: number; pitch: number; roll: number; }

const toDeg = (r: number) => Math.round((r * 180) / Math.PI);
const toRad = (d: number) => (d * Math.PI) / 180;

/* ── 슬라이더 행 ──────────────────────────────────────────────── */
const HprRow: React.FC<{
    label: string; value: number; min?: number; max?: number; step?: number; unit?: string;
    onChange: (v: number) => void; disabled?: boolean;
}> = ({ label, value, min = -180, max = 180, step = 1, unit = '°', onChange, disabled }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
        <span style={{ width: 58, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
        <input
            type="range" min={min} max={max} step={step} value={value}
            disabled={disabled}
            style={{ flex: 1, accentColor: 'var(--accent-text)', cursor: disabled ? 'default' : 'pointer' }}
            onChange={e => onChange(Number(e.target.value))}
        />
        <input
            type="number" min={min} max={max} step={step} value={value}
            disabled={disabled}
            style={{
                width: 52, background: 'rgba(var(--overlay-rgb), 0.05)',
                border: '1px solid rgba(var(--overlay-rgb), 0.1)', borderRadius: 4,
                color: 'var(--text-secondary)', fontSize: 11, padding: '3px 6px', textAlign: 'right',
            }}
            onChange={e => onChange(Number(e.target.value))}
        />
        <span style={{ fontSize: 10, color: 'var(--text-disabled)', flexShrink: 0 }}>{unit}</span>
    </div>
);

/* ── Props ────────────────────────────────────────────────────── */
interface Props {
    activePopupMenu: MenuTreeResponse;
    mode: 'create' | 'edit' | 'view';
    targetId: number | null;
    onClose: () => void;
    onSubmit: () => void;
    onEditMode: (mode: string, id?: number) => void;
}

const MODE_LABELS: Record<string, string> = {
    create: '새 모델 등록', edit: '모델 편집', view: '모델 상세',
};
const MODE_BADGE: Record<string, string> = {
    create: styles.modeBadgeCreate, edit: styles.modeBadgeEdit, view: styles.modeBadgeView,
};

/* ── 컴포넌트 ─────────────────────────────────────────────────── */
const VehicleModelForm: React.FC<Props> = ({
    activePopupMenu, mode, targetId, onClose, onSubmit, onEditMode,
}) => {
    const isReadOnly = mode === 'view';
    const { setModels, setVehicleTypes } = useVehicleModelStore();
    const layerManager = useLayerStore(s => s.layerManager);

    const [vtOptions, setVtOptions]           = useState<{ value: string; label: string }[]>([]);
    const [name, setName]                     = useState('');
    const [vehicleTypeId, setVehicleTypeId]   = useState('');
    const [color, setColor]                   = useState('#ffffff');
    const [length, setLength]                 = useState('');
    const [file, setFile]                     = useState<File | null>(null);
    const [zOffset, setZOffset]               = useState(0);

    // GLB 프리뷰 URL
    const [previewUrl, setPreviewUrl]         = useState<string | null>(null);
    const blobRef                             = useRef<string | null>(null);

    // 방향 보정값 (UI는 degrees, 저장/Cesium은 radians)
    const [hprDeg, setHprDeg]                 = useState<HprDeg>({ heading: 0, pitch: 0, roll: 180 });
    const hprRad = {
        heading: toRad(hprDeg.heading),
        pitch:   toRad(hprDeg.pitch),
        roll:    toRad(hprDeg.roll),
    };

    /* ── 차량 타입 옵션 로드 ──────────────────────────────────── */
    useEffect(() => {
        axiosInstance.get('/vehicle-types').then(r => {
            const data = Array.isArray(r.data) ? r.data : [];
            setVtOptions(data.map((t: any) => ({
                value: String(t.id),
                label: t.name || t.vehicleId || String(t.id),
            })));
        }).catch(() => {});
    }, []);

    /* ── view/edit 모드: 기존 데이터 로드 ────────────────────── */
    useEffect(() => {
        if ((mode !== 'view' && mode !== 'edit') || !targetId) return;
        axiosInstance.get(`/vehicle-models/${targetId}`).then(r => {
            const d = r.data;
            setName(d.name ?? '');
            setVehicleTypeId(String(d.vehicleTypeId ?? ''));
            setColor(d.color ?? '#ffffff');
            setLength(String(d.length ?? ''));
            setZOffset(d.zOffset ?? 0);
            if (d.correctionHpr) {
                // correctionHpr은 JSON 문자열로 저장됨
                const hpr = typeof d.correctionHpr === 'string'
                    ? JSON.parse(d.correctionHpr)
                    : d.correctionHpr;
                setHprDeg({
                    heading: toDeg(hpr.heading ?? 0),
                    pitch:   toDeg(hpr.pitch   ?? 0),
                    roll:    toDeg(hpr.roll    ?? Math.PI),
                });
            }
            if (d.filePath) {
                setPreviewUrl(buildFileUrl(d.filePath));
            }
        }).catch(() => {});
    }, [targetId, mode]);

    /* ── 파일 선택 → blob URL 생성 ───────────────────────────── */
    const handleFileChange = (val: File | string | null) => {
        if (val instanceof File) {
            if (blobRef.current) URL.revokeObjectURL(blobRef.current);
            const url = URL.createObjectURL(val);
            blobRef.current = url;
            setFile(val);
            setPreviewUrl(url);
        } else {
            setFile(null);
        }
    };

    // 언마운트 시 blob URL 해제
    useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

    /* ── 저장 ─────────────────────────────────────────────────── */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const { url, method } = mode === 'create'
                ? apiConfig['VEHICLE_MODEL'].create
                : apiConfig['VEHICLE_MODEL'].update;

            const finalUrl = url.includes('{id}') && targetId != null
                ? url.replace('{id}', String(targetId))
                : url;

            const fd = new FormData();
            fd.append('name', name);
            fd.append('vehicleTypeId', vehicleTypeId);
            fd.append('color', color);
            fd.append('length', length);
            fd.append('correctionHpr', JSON.stringify(hprRad));
            fd.append('zOffset', String(zOffset));
            if (file) fd.append('file', file);

            await axiosInstance.request({ url: finalUrl, method, data: fd });

            // 스토어 갱신 → 다음 시뮬레이션에 변경된 correctionHpr 반영
            const [modelsData, typesData] = await Promise.all([
                axiosInstance.get('/vehicle-models').then(r => r.data).catch(() => []),
                axiosInstance.get('/vehicle-types').then(r => r.data).catch(() => []),
            ]);
            setModels(Array.isArray(modelsData) ? modelsData : []);
            setVehicleTypes(Array.isArray(typesData) ? typesData : []);

            // ⚠️ 위 스토어 갱신은 "다음 setSimulation() 재구성 시점"(새 viewport fetch 등)에만
            // 반영된다 — 이미 화면에 떠 있는 VehiclePrimitive는 저장 직후 그대로 예전 보정값을
            // 유지해 "수정하고 저장해도 회전이 바로 안 바뀜"으로 보였다(실사용 보고).
            // VehicleOrientationPanel(라이브 슬라이더)과 동일하게 layerManager.updateVehicleCorrection
            // 으로 즉시 반영한다. 단, 프리미티브의 vehicleType 태그는 vehicle_type.vehicle_id
            // ("CAR"/"BUS" 등)가 아니라 실제 NextSim 코드(nextsimTypeCode, 예: "NV,AV")로 붙는다
            // (useSimulation.ts의 typeGroups가 VehicleInfo.veh_type 기준 — resolveVehicleType 참고)
            // — 그 코드들 전부에 대해 갱신해야 실제로 반영된다.
            if (layerManager && (layerManager as any).updateVehicleCorrection) {
                const hpr = new Cesium.HeadingPitchRoll(hprRad.heading, hprRad.pitch, hprRad.roll);
                const vt = (Array.isArray(typesData) ? typesData : [])
                    .find((t: any) => String(t.id) === String(vehicleTypeId));
                const codes = (vt?.nextsimTypeCode ?? '')
                    .split(',')
                    .map((c: string) => c.trim())
                    .filter(Boolean);
                for (const code of codes) {
                    (layerManager as any).updateVehicleCorrection(code, hpr);
                }
                if (vt?.vehicleId) (layerManager as any).updateVehicleCorrection(vt.vehicleId, hpr);
            }

            alert(mode === 'create' ? '등록되었습니다.' : '수정되었습니다.');
            onSubmit();
            onClose();
        } catch (err) {
            console.error('저장 실패:', err);
            alert('저장 중 오류가 발생했습니다.');
        }
    };

    /* ── Render ───────────────────────────────────────────────── */
    return (
        <div className={styles.formOverlay}>
            <div
                className={styles.formPanel}
                style={{ width: 460, maxWidth: '95vw' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className={styles.formHeader}>
                    <span className={styles.formTitle}>{MODE_LABELS[mode] ?? mode}</span>
                    <span className={`${styles.modeBadge} ${MODE_BADGE[mode] ?? ''}`}>{mode}</span>
                    <button className={styles.formCloseBtn} onClick={onClose}>×</button>
                </div>

                {/* Body */}
                <div className={styles.formBody}>
                    <form id="vehicle-model-form" onSubmit={handleSubmit}>

                        {/* ── 미니 3D 뷰어 ─────────────────────── */}
                        <div style={{ marginBottom: 14 }}>
                            {previewUrl ? (
                                <GlbMiniViewer glbUrl={previewUrl} hprRad={hprRad} zOffset={zOffset} />
                            ) : (
                                <div style={{
                                    height: 240, borderRadius: 8,
                                    border: '1px dashed rgba(var(--overlay-rgb), 0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--text-disabled)', fontSize: 12, background: 'rgba(var(--surface-overlay-rgb), 0.15)',
                                    flexDirection: 'column', gap: 6,
                                }}>
                                    <span style={{ fontSize: 28 }}>🧊</span>
                                    <span>GLB 파일을 선택하면 여기서 미리보기</span>
                                </div>
                            )}
                        </div>

                        {/* ── 방향 보정 슬라이더 ────────────────── */}
                        <div style={{
                            background: 'rgba(var(--overlay-rgb), 0.02)',
                            border: '1px solid rgba(var(--overlay-rgb), 0.07)',
                            borderRadius: 8, padding: '10px 12px', marginBottom: 14,
                        }}>
                            <div style={{
                                fontSize: 11, color: 'var(--accent-text)', fontWeight: 600,
                                letterSpacing: '0.3px', marginBottom: 8,
                            }}>
                                방향 보정
                            </div>
                            <HprRow label="Heading" value={hprDeg.heading} disabled={isReadOnly}
                                onChange={v => setHprDeg(p => ({ ...p, heading: v }))} />
                            <HprRow label="Pitch" value={hprDeg.pitch} min={-90} max={90} disabled={isReadOnly}
                                onChange={v => setHprDeg(p => ({ ...p, pitch: v }))} />
                            <HprRow label="Roll" value={hprDeg.roll} disabled={isReadOnly}
                                onChange={v => setHprDeg(p => ({ ...p, roll: v }))} />
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 6 }}>
                                뒤집혔으면 Roll ±180° · 옆으로 누웠으면 Pitch ±90°
                            </div>
                            {!isReadOnly && (
                                <button
                                    type="button"
                                    style={{
                                        marginTop: 8, padding: '3px 10px', fontSize: 11,
                                        background: 'rgba(var(--overlay-rgb), 0.04)',
                                        border: '1px solid rgba(var(--overlay-rgb), 0.1)',
                                        borderRadius: 4, color: 'rgba(var(--overlay-rgb), 0.4)', cursor: 'pointer',
                                    }}
                                    onClick={() => setHprDeg({ heading: 0, pitch: 0, roll: 180 })}
                                >
                                    기본값 리셋
                                </button>
                            )}
                        </div>

                        {/* ── Z 높이 보정 ────────────────────────── */}
                        <div style={{
                            background: 'rgba(var(--overlay-rgb), 0.02)',
                            border: '1px solid rgba(var(--overlay-rgb), 0.07)',
                            borderRadius: 8, padding: '10px 12px', marginBottom: 14,
                        }}>
                            <div style={{
                                fontSize: 11, color: 'var(--accent-text)', fontWeight: 600,
                                letterSpacing: '0.3px', marginBottom: 8,
                            }}>
                                높이 보정 (Z-offset)
                            </div>
                            <HprRow
                                label="Z-offset"
                                value={zOffset}
                                min={-10} max={10} step={0.5} unit="m"
                                onChange={v => setZOffset(v)}
                                disabled={isReadOnly}
                            />
                            <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                                단위: m · 양수=위로, 음수=아래로
                            </div>
                        </div>

                        {/* ── 기본 필드 ─────────────────────────── */}
                        <div className={styles.formField}>
                            <label className={styles.formLabel}>모델 이름</label>
                            <input
                                type="text" value={name}
                                onChange={e => setName(e.target.value)}
                                readOnly={isReadOnly}
                                placeholder="예: 승용차 모델 A"
                                className={styles.formInput}
                            />
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>차량 타입</label>
                            <select
                                value={vehicleTypeId}
                                onChange={e => setVehicleTypeId(e.target.value)}
                                disabled={isReadOnly}
                                className={styles.formInput}
                            >
                                <option value="">선택안함</option>
                                {vtOptions.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>색상</label>
                            <input
                                type="color" value={color}
                                onChange={e => setColor(e.target.value)}
                                disabled={isReadOnly}
                                style={{
                                    height: 30, padding: 2, borderRadius: 4,
                                    background: 'transparent',
                                    border: '1px solid rgba(var(--overlay-rgb), 0.1)',
                                    cursor: isReadOnly ? 'default' : 'pointer',
                                }}
                            />
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>길이 (m)</label>
                            <input
                                type="number" value={length} step="0.1"
                                onChange={e => setLength(e.target.value)}
                                readOnly={isReadOnly}
                                className={styles.formInput}
                            />
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>3D 모델 (.glb)</label>
                            <FileInput value={file} onChange={handleFileChange} readOnly={isReadOnly} />
                        </div>

                    </form>
                </div>

                {/* ── Footer (스크롤 영역 밖 – 항상 표시) ── */}
                <div className={styles.formFooter}>
                    {mode === 'view' && (
                        <button type="button" className={styles.editBtn}
                            onClick={e => { e.preventDefault(); onEditMode('edit', targetId!); }}>
                            편집
                        </button>
                    )}
                    {mode === 'edit' && (
                        <>
                            <button type="submit" form="vehicle-model-form" className={styles.submitBtn}>저장</button>
                            <button type="button" className={styles.cancelBtn}
                                onClick={e => { e.preventDefault(); onEditMode('view', targetId!); }}>
                                취소
                            </button>
                        </>
                    )}
                    {mode === 'create' && (
                        <button type="submit" form="vehicle-model-form" className={styles.submitBtn}>등록</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VehicleModelForm;
