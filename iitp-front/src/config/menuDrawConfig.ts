
export const menuDrawRequirements: Record<string, { requiresType: boolean; typeKey?: string }> = {
    PAVEMENT_MARKING: { requiresType: true, typeKey: "PAVEMENT_MARKING" },
    // BUS_STATION: { requiresType: true, typeKey: "BUS_STATION" },
    // RAIL_STATION: { requiresType: true, typeKey: "RAIL_STATION" },
    //DRT_STOP: { requiresType: true, typeKey: "stationType" },
};

export const typeOptionsMap: Record<string, string[]> = {
    PAVEMENT_MARKING: ["Diamond", "LeftTurn", "RightTurn", "Straight", "StraightRight", "StraightLeft", "UTurn" ],
    // BUS_STATION: ["island", "side"],
    // RAIL_STATION: ["railStations", "exits"]
    //DRT_STOP: [""],
};

/** 타입별 썸네일 이미지 경로 (buildFileUrl에 전달할 상대경로) */
export const typeImageMap: Record<string, Record<string, string>> = {
    PAVEMENT_MARKING: {
        Diamond:       "models/Diamond.png",
        LeftTurn:      "models/LeftTurn.png",
        RightTurn:     "models/RightTurn.png",
        Straight:      "models/Straight.png",
        StraightRight: "models/StraightRight.png",
        StraightLeft:  "models/StraightLeft.png",
        UTurn:         "models/UTurn.png",
    },
};

/** DrilldownGrid의 handleAdd에서 타입 선택이 필요한 featureType 목록 */
export const featureTypeDrawRequirements: Record<string, { typeKey: string }> = {
    pavementMarkings: { typeKey: "PAVEMENT_MARKING" },
};
