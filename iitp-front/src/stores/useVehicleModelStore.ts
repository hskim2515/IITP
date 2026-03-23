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

/** 타입별 기본 보정값 (radians). GLB 모델의 좌표계에 따라 조정 필요. */
export const DEFAULT_CORRECTIONS: Record<string, CorrectionHpr> = {
    CAR:   { heading: 0, pitch: 0, roll: Math.PI },
    TAXI:  { heading: 0, pitch: 0, roll: Math.PI },
    BUS:   { heading: 0, pitch: 0, roll: Math.PI },
    TRUCK: { heading: 0, pitch: 0, roll: Math.PI },
    MOTO:  { heading: 0, pitch: 0, roll: Math.PI },
};

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

/** 차량 유형별 파일 서버 모델 기본 매핑 (buildFileUrl 경유) */
const TYPE_LOCAL_MODEL_MAP: Record<string, string> = {
    'CAR':     '/models/model_12.glb',
    'TAXI':    '/models/tusan.glb',
    'BUS':     '/models/CesiumMilkTruck.glb',
    'TRUCK':   '/models/CesiumMilkTruck.glb',
    'MOTO':    '/models/model_12.glb',
};

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

/**
 * 모델의 GLB URL을 반환합니다.
 * 우선순위: DB 모델 filePath(프록시 URL) > 차량 유형별 로컬 모델 > 기본 모델
 */
export function resolveGlbUrl(model: VehicleModelItem | null, vehicleType?: string): string {
    // DB 모델 경로가 있으면 buildFileUrl로 프록시 URL 생성
    if (model?.filePath) {
        const url = buildFileUrl(model.filePath);
        if (url) return url;
    }

    // 차량 유형별 파일 서버 모델 매핑
    if (vehicleType) {
        const localModel = TYPE_LOCAL_MODEL_MAP[vehicleType.toUpperCase()];
        if (localModel) return buildFileUrl(localModel);
    }

    // 기본 모델
    return buildFileUrl('/models/model_12.glb');
}
