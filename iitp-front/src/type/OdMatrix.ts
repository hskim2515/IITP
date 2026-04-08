export interface DemandEntry {
    source: string;
    sink: string;
    flow: number;
    dist?: string;
}

export interface OdMatrixItem {
    id: number;
    startTime: string;
    duration: number;
    demands: DemandEntry[];
}

export interface OdMatrixData {
    odMatrices: OdMatrixItem[];
}
