export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const
export const PAVEMENT_MARKING_SNAP_FIELDS = [ 'linkRef', 'laneRef', 'offset', 'coordinates', 'markingType', 'cellId', 'angle'] as const;
export type PavementMarkingSnapFields = typeof PAVEMENT_MARKING_SNAP_FIELDS[number];

export const FEATURE_TYPE = {
    PAVEMENT_MARKING: 'pavementMarkings',
}

export const PavementMarkingType = {
    Diamond: 'Diamond.png',
    LeftTurn: 'LeftTurn.png',
    RightTurn: 'RightTurn.png',
    Straight: 'Straight.png',
    StraightLeft: 'StraightLeft.png',
    StraightRight: 'StraightRight.png',
    UTurn: 'UTurn.png',
} as const;

export interface PavementMarkingData {
    __guid: string;
    featureType: string;
    id: string | undefined;
    angle: number | null;
    linkRef: number | null;
    laneRef: number | null;
    offset: number | null;
    markingType: string | null;
    coordinates: [{
        lng: number | null,
        lat: number | null,
    }],

}

export type PavementMarkingSnapProperties = Pick<PavementMarkingData, PavementMarkingSnapFields>;