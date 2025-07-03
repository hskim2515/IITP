export interface FormField {
    name: string;
    label: string;
    type?: string;
    options?: (string | { value: string; label: string })[];
}

export interface PropertyFormSchemaProps {
    type: string;
    layer?: string;
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

    NETWORK: {
        type:"table",
        layer: "network",
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
        type:"table",
        layer: "busStation",
        fields: [
            { name: "id", label: "id", type: "number" },
            { name: "linkRef", label: "정류장 위치 링크", type: "number" },
            { name: "laneRef", label: "정류장 위치 차로", type: "number" },
            { name: "transitMode", label: "대중교통 수단", type: "text" },
            { name: "type", label: "정류장 형태", type: "text" },
            { name: "offset", label: "정류장 위치 링크 오프셋", type: "number" },
            { name: "address", label: "사물주소", type: "text" },
            { name: "parkingLots", label: "주정차 가능 대수", type: "number" },
            { name: "geometryType", label: "geometryType", type: "text" },
            { name: "crs", label: "crs", type: "text" },
            { name: "lon", label: "lon", type: "number" },
            { name: "lat", label: "lat", type: "number" },
        ],
        inputFields: [
        ],
        rowFields: []
    },
    PT_DRT_STATION: {
        type:"table",
        fields: [
            { name: "id", label: "id", type: "number" },
            { name: "linkRef", label: "정류장 위치 링크", type: "number" },
            { name: "laneRef", label: "정류장 위치 차로", type: "number" },
            { name: "offset", label: "정류장 위치 범위 오프셋", type: "number" },
        ],
        inputFields: [
        ],
        rowFields: []
    },
    PT_RAIL_STATION: {
        type:"table",
        fields: [
            { name: "id", label: "id", type: "number" },
            { name: "transitMode", label: "대중교통 수단", type: "text" },
            { name: "type", label: "정류장 형태", type: "text" },
            { name: "address", label: "사물주소", type: "text" },
        ],
        inputFields: [
        ],
        rowFields: []
    },
    PT_TRAM_STATION: {
        type:"table",
        fields: [
            { name: "id", label: "id", type: "number" },
            { name: "transitMode", label: "대중교통 수단", type: "text" },
            { name: "type", label: "정류장 형태", type: "text" },
            { name: "address", label: "사물주소", type: "text" },
        ],
        inputFields: [
        ],
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
        type:"table",
        layer: "pavementMarking",
        fields: [
            { name: "id", label: "id", type: "number" },
            { name: "markingType", label: "Marking Type", type: "text" },
            { name: "linkRef", label: "Link ID", type: "text" },
            { name: "laneRef", label: "Lane ID", type: "text" },
            { name: "cellId", label: "Cell ID", type: "text" },
            { name: "offset", label: "offset", type: "text" },
            // { name: "geometryType", label: "geometryType", type: "text" },
            { name: "angle", label: "angle", type: "number" },
            // { name: "lon", label: "lon", type: "number" },
            // { name: "lat", label: "lat", type: "number" },
        ],
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
            { name: "maxPax", label: "최대 탑승 승객 수", type: "number" },
        ],
        inputFields: [
            { name: "mean", label: "평균값", type: "float" },
            { name: "sd", label: "표준편차", type: "float" },
            { name: "min", label: "최소값", type: "float" },
            { name: "max", label: "최대값", type: "float" },
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
            { name: "length", label: "length", type: "number" },
            { name: "filePath", label: "file3D", type: "file" },
        ],
        inputFields: [
            // { name: "id", label: "model ID", type: "text" },
            { name: "name", label: "model name", type: 'select'},
            { name: "color", label: "color", type: "color" },
            { name: "length", label: "length", type: "number" },
            { name: "filePath", label: "file3D", type: "file" },
        ],
        rowFields: []
    }
};
