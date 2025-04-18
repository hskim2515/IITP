export interface FormField {
    name: string;
    label: string;
    type?: string;
}

export interface PropertyFormSchemaProps {
    fields: FormField[];
}

/**
 * MENU_CODE: {
 *     fields: []
 * }
 */
export const propertyFormSchema: Record<string, PropertyFormSchemaProps> = {
    NETWORK_IMPORT: {
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
    },
    DEMAND_IMPORT: {
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
    },
    SIGNAL_IMPORT: {
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
    },
    EXPORT: {
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
    },

    ROAD: {
        fields: [
            { name: "ffspeed", label: "Freeflow speed (km/h)", type: "number" },
            { name: "waveSpeed", label: "Wave speed (km/h)", type: "number" },
            { name: "numLane", label: "Num lane", type: "number" },
            { name: "laneWidth", label: "Lane width (m)", type: "number" },
            { name: "stopLine", label: "Stop line (m)", type: "number" },
            { name: "roadType", label: "straight | multiple", type: "text" },
            { name: "extrudeLength", label: "ExtrudeLength (m)", type: "number" },
            { name: "extrudeLengthLeft", label: "ExtrudeLengthLeft (m)", type: "number" },
            { name: "pedestrianRoad", label: "pedestrianRoad (0,1)", type: "number" },
        ],
    },
    CONNECTION: {
        fields: [
            { name: "inLink", label: "InLink", type: "number" },
            { name: "outLink", label: "OutLink", type: "number" },
            { name: "incomingLane", label: "Incoming Lane", type: "number" },
            { name: "outgoingLane", label: "Outgoing Lane", type: "number" },
            { name: "turnType", label: "Turn Type (left/right/straight)", type: "text" },
        ],
    },
    SIGNAL: {
        fields: [
            { name: "assignedTime", label: "Assigned Time (s)", type: "number" },
            { name: "phase", label: "Phase", type: "text" },
            { name: "offset", label: "Offset (s)", type: "number" },
        ],
    },
    PT_BUS_STATION: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
    },
    PT_DRT_STATION: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "schedule", label: "스케줄 (Schedule)", type: "text" },
        ],
    },
    PT_RAIL_STATION: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
    },
    PT_TRAM_STATION: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
    },
    PT_BUS_GARAGE: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "parkingLots", label: "주차 가능 수 (Parking Lots)", type: "number" },
        ],
    },
    PT_TRAM_GARAGE: {
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "parkingLots", label: "주차 가능 수 (Parking Lots)", type: "number" },
            { name: "railWidth", label: "레일 폭 (Rail Width)", type: "number" },
        ],
    },
    PAVEMENT_MARKING: {
        fields: [],
    },
    BUS_PT_LINE: {
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
    },
    RAIL_PT_LINE: {
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
    },
    TRAM_PT_LINE: {
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
    },
    SIMULATION_LEVEL: {
        fields: [
        ],
    },
};
