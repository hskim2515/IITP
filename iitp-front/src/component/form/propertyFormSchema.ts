export interface FormField {
    name: string;
    label: string;
    type?: string;
    options?: (string | { value: string; label: string })[];
}

export interface PropertyFormSchemaProps {
    type: String;
    fields: FormField[];
    inputFields: FormField[];
    rowFields: FormField[];
}

/**
 * MENU_CODE: {
 *     fields: []
 * }
 */
export const propertyFormSchema: Record<string, PropertyFormSchemaProps> = {
    NETWORK_IMPORT: {
        type:"",
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    DEMAND_IMPORT: {
        type:"",
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    SIGNAL_IMPORT: {
        type:"",
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    EXPORT: {
        type:"",
        fields: [
            { name: "filePath", label: "filePath", type: "text" },
            { name: "fileFormat", label: "fileFormat", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },

    ROAD: {
        type:"table",
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
        inputFields: [
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
        rowFields: []
    },
    CONNECTION: {
        type:"table",
        fields: [
            { name: "inLink", label: "InLink", type: "number" },
            { name: "outLink", label: "OutLink", type: "number" },
            { name: "incomingLane", label: "Incoming Lane", type: "number" },
            { name: "outgoingLane", label: "Outgoing Lane", type: "number" },
            { name: "turnType", label: "Turn Type (left/right/straight)", type: "text" },
        ],
        inputFields: [
            { name: "inLink", label: "InLink", type: "number" },
            { name: "outLink", label: "OutLink", type: "number" },
            { name: "incomingLane", label: "Incoming Lane", type: "number" },
            { name: "outgoingLane", label: "Outgoing Lane", type: "number" },
            { name: "turnType", label: "Turn Type (left/right/straight)", type: "text" },
        ],
        rowFields: []
    },
    SIGNAL: {
        type:"",
        fields: [
            { name: "assignedTime", label: "Assigned Time (s)", type: "number" },
            { name: "phase", label: "Phase", type: "text" },
            { name: "offset", label: "Offset (s)", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_BUS_STATION: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_DRT_STATION: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "schedule", label: "스케줄 (Schedule)", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_RAIL_STATION: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_TRAM_STATION: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_BUS_GARAGE: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "parkingLots", label: "주차 가능 수 (Parking Lots)", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    PT_TRAM_GARAGE: {
        type:"",
        fields: [
            { name: "position", label: "위치 (Position)", type: "number" },
            { name: "name", label: "정류장명 (Stop Name)", type: "text" },
            { name: "parkingLots", label: "주차 가능 수 (Parking Lots)", type: "number" },
            { name: "railWidth", label: "레일 폭 (Rail Width)", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    PAVEMENT_MARKING: {
        type:"",
        fields: [],
        inputFields: [],
        rowFields: []
    },
    BUS_PT_LINE: {
        type:"",
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    RAIL_PT_LINE: {
        type:"",
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    TRAM_PT_LINE: {
        type:"",
        fields: [
            { name: "linkseq", label: "Link Sequence", type: "text" },
            { name: "nodeseq", label: "Node Sequence", type: "text" },
            { name: "stationseq", label: "Station Sequence", type: "text" },
            { name: "mode", label: "Mode", type: "text" },
            { name: "time", label: "Time", type: "number" },
        ],
        inputFields: [],
        rowFields: []
    },
    SIMULATION_LEVEL: {
        type:"",
        fields: [
        ],
        inputFields: [],
        rowFields: []
    },
    VEHICLE_TYPE : {
        type: "table",
        fields: [
            { name: "vehicleId", label: "차종 ID", type: "text" },
            { name: "name", label: "이름", type: "text" },
            { name: "v2x", label: "v2x", type: "select" , options: ['on', 'off'] },
            { name: "drt", label: "drt", type: "select" , options: ['0', '1'] },
            { name: "maxPax", label: "최대 탑승 승객 수", type: "text" },
        ],
        inputFields: [
            { name: "mean", label: "평균값", type: "text" },
            { name: "sd", label: "표준편차", type: "text" },
            { name: "min", label: "최소값", type: "text" },
            { name: "max", label: "최대값", type: "text" },
            { name: "dist", label: "분포종류", type: "select", options: ['normal', 'lognormal'] },
        ],
        rowFields: [
            { name: "veh_len", label: "차량 길이", type: "text" },
            { name: "jamgap", label: "차간 최소거리", type: "text" },
            { name: "vf", label: "최대 속도", type: "text" },
            { name: "reaction_time", label: "반응속도", type: "text" },
            { name: "max_acc", label: "최대 가속도", type: "text" },
            { name: "max_dec", label: "최대 감속도", type: "text" },
            { name: "lc_param1", label: "차로변경 파라미터 1", type: "text" },
            { name: "lc_param2", label: "차로변경 파라미터 2", type: "text" },
            { name: "lc_sensitivity", label: "차로변경 민감도", type: "text" }
        ]
    },
    VEHICLE_MODEL: {
        type:"table",
        fields: [
            // { name: "id", label: "model ID", type: "text" },
            { name: "name", label: "model name", type: "text" },
            { name: "color", label: "color", type: "color" },
            { name: "length", label: "length", type: "text" },
            { name: "filePath", label: "file3D", type: "file" },
        ],
        inputFields: [
            // { name: "id", label: "model ID", type: "text" },
            { name: "name", label: "model name", type: 'select'},
            { name: "color", label: "color", type: "color" },
            { name: "length", label: "length", type: "text" },
            { name: "filePath", label: "file3D", type: "file" },
        ],
        rowFields: []
    }
};
