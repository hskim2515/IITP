export interface PassengerDemandEntry {
    origin: string;
    dest: string;
    flow: number;
    dist?: string;
}

export interface PassengerData {
    demands: PassengerDemandEntry[];
}
