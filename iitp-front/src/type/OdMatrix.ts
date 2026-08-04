export interface DemandEntry {
    source: string;
    sink: string;
    flow: number;
    dist?: string;
}

export type VehicleMix = Record<string, number>;

export interface OdMatrixItem {
    id: number;
    startTime: string;
    duration: number;
    demands: DemandEntry[];
    /** 화면 편집용 구성비. XML에는 속성으로 저장하지 않고 유형별 flow로 변환한다. */
    vehicleMix: VehicleMix;
}

export interface OdMatrixData {
    odMatrices: OdMatrixItem[];
}
