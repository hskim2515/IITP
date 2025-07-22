
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
