
export const menuDrawRequirements: Record<string, { requiresType: boolean; typeKey?: string }> = {
    PAVEMENT_MARKING: { requiresType: true, typeKey: "PAVEMENT_MARKING" },
    //PT_BUS_STATION: { requiresType: false, typeKey: "stationType" },
    //DRT_STOP: { requiresType: true, typeKey: "stationType" },
};

export const typeOptionsMap: Record<string, string[]> = {
    PAVEMENT_MARKING: ["Diamond", "LeftTurn", "RightTurn", "Straight", "StraightRight", "StraightLeft", "UTurn" ],
    //PT_BUS_STATION: [""],
    //DRT_STOP: [""],
};
