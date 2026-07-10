import { create } from 'zustand';
import { buildFileUrl } from '@utils/fileUrl';

export interface VehicleModelItem {
    id: number;
    name: string;
    filePath: string;       // 백엔드에서 반환하는 파일 경로
    color?: string;
    length?: number;
    vehicleTypeId?: number; // vehicle_type 테이블 FK
    /** GLTF 모델 좌표계 보정값: DB에서 JSON 문자열로 오거나, 파싱된 객체일 수 있음 */
    correctionHpr?: string | { heading: number; pitch: number; roll: number };
    /** ENU Up 방향 높이 보정(m). 양수=위로 올림, 음수=아래로 내림 */
    zOffset?: number;
}

export interface VehicleTypeRef {
    id: number;
    vehicleId: string; // 예: "CAR", "BUS", "TAXI"
    name: string;
}

export interface CorrectionHpr {
    heading: number; // radians
    pitch:   number;
    roll:    number;
}

/**
 * 타입별 기본 보정값 (radians).
 *
 * VehiclePrimitive는 raw glTF(Y-up) 정점을 그대로 사용하므로 Cesium의 Z-up
 * 로컬 프레임으로 보정이 필요하다. roll=+90°(π/2)는 (x,y,z)→(x,-z,y) 변환으로
 * glTF의 "위" 축(Y)을 Cesium의 "위" 축(Z)으로 맞춰준다 — 보정이 없으면(roll=0)
 * 차량 모델이 옆으로 누운 채 절반은 도로 아래, 절반은 공중으로 솟아오른 것처럼
 * 보인다("뒤집힘"/"공중에 뜸" 증상의 근본 원인).
 *
 * heading은 모델별 "정면" 축에 따라 추가 조정이 필요할 수 있다. heading=+90°를
 * 시도한 결과 회전 오차가 90°→180°로 더 커지고 공중에 뜨는 증상까지 재발하는
 * 것으로 확인되어(즉 +π/2는 잘못된 방향) 일단 0으로 되돌렸다. 설정 > 차량 모델 >
 * 차량 방향 보정 패널에서 heading을 ±90°/180° 단위로 라이브 조정해 정확한 값을
 * 찾은 뒤 이 기본값을 갱신할 것.
 */
export const DEFAULT_CORRECTIONS: Record<string, CorrectionHpr> = {
    CAR:   { heading: -Math.PI / 2, pitch: 0, roll: Math.PI / 2 },
    TAXI:  { heading: -Math.PI / 2, pitch: 0, roll: Math.PI / 2 },
    BUS:   { heading: -Math.PI / 2, pitch: 0, roll: Math.PI / 2 },
    TRUCK: { heading: -Math.PI / 2, pitch: 0, roll: Math.PI / 2 },
    MOTO:  { heading: -Math.PI / 2, pitch: 0, roll: Math.PI / 2 },
};

/** DB 모델에 zOffset이 없을 때 사용하는 기본 높이 보정(m). 차량이 노면보다 1.5m 위에 위치. */
export const DEFAULT_Z_OFFSET = 0.2;

interface VehicleModelState {
    models: VehicleModelItem[];
    selectedModel: VehicleModelItem | null;
    vehicleTypes: VehicleTypeRef[];
    /** 차량 타입별 방향 보정값 (radians). DEFAULT_CORRECTIONS를 초기값으로 사용. */
    correctionByType: Record<string, CorrectionHpr>;
    setModels: (models: VehicleModelItem[]) => void;
    setSelectedModel: (model: VehicleModelItem | null) => void;
    setVehicleTypes: (types: VehicleTypeRef[]) => void;
    setCorrectionForType: (vehicleType: string, correction: CorrectionHpr) => void;
}

export const useVehicleModelStore = create<VehicleModelState>((set) => ({
    models: [],
    selectedModel: null,
    vehicleTypes: [],
    correctionByType: { ...DEFAULT_CORRECTIONS },
    setModels: (models) => set({ models }),
    setSelectedModel: (model) => set({ selectedModel: model }),
    setVehicleTypes: (vehicleTypes) => set({ vehicleTypes }),
    setCorrectionForType: (vehicleType, correction) =>
        set((s) => ({ correctionByType: { ...s.correctionByType, [vehicleType]: correction } })),
}));

/** 차량 유형 문자열(예: "CAR")로 해당 VehicleModelItem을 반환합니다. */
export function resolveModelByVehicleType(
    vehicleTypeStr: string,
    models: VehicleModelItem[],
    vehicleTypes: VehicleTypeRef[]
): VehicleModelItem | null {
    const vt = vehicleTypes.find(t => t.vehicleId?.toUpperCase() === vehicleTypeStr?.toUpperCase());
    if (!vt) return null;
    return models.find(m => m.vehicleTypeId === vt.id) ?? null;
}

/** DB vehicle_type_model.file_path 기반 GLB URL을 반환합니다. */
export function resolveGlbUrl(model: VehicleModelItem | null): string {
    if (model?.filePath) return buildFileUrl(model.filePath);
    return buildFileUrl('/models/model_12.glb');
}
