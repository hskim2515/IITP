export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const

export const PavementMarkingType = {
    Diamond: 'Diamond.png',
    LeftTurn: 'LeftTurn.png',
    RightTurn: 'RightTurn.png',
    Straight: 'Straight.png',
    StraightLeft: 'StraightLeft.png',
    StraightRight: 'StraightRight.png',
    UTurn: 'UTurn.png',
} as const;

export const FEATURE_TYPE = {
    PAVEMENT_MARKING: 'pavementMarking',
}