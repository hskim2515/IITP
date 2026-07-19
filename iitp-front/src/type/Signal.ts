export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const
export const SIGNAL_SNAP_FIELDS = [ 'nodeId', 'turning', 'type', 'connectionId'] as const;
export type SignalSnapFields = typeof SIGNAL_SNAP_FIELDS[number];

export const FEATURE_TYPE = {
    SIGNAL: 'signal',
}

export interface SignalPhase {
    id: string;
    duration: string;
    turnList: string;
}

export interface SignalPlan {
    id: string;
    cycle: string;
    offset: string;
    phases: SignalPhase[];
}

export interface SignalData {
    __guid: string | undefined;
    featureType: string;
    id: string | undefined;
    nodeId: string | undefined;
    turnId?: string;
    turning: string | null;
    type: string | null;
    connectionId: string | undefined;
    plans?: SignalPlan[];

}

export type SignalSnapProperties = Pick<SignalData, SignalSnapFields>;