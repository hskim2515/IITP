type ApiEndpoint = {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | '';
    useFormData?: boolean;
};

type ApiConfig = {
    [key: string]: {
        [action: string]: ApiEndpoint;
    };
};
export const apiConfig:ApiConfig = {
    VEHICLE_TYPE: {
        list:    { url: '/vehicle-types',       method: 'GET', useFormData: false },
        optionList: { url: '/',       method: '', useFormData: false },
        detail:  { url: '/vehicle-types/{id}',  method: 'GET', useFormData: false },
        create:  { url: '/vehicle-types',       method: 'POST', useFormData: false },
        update:  { url: '/vehicle-types/{id}',  method: 'PUT', useFormData: false },
        delete:  { url: '/vehicle-types/delete',  method: 'POST', useFormData: false },
    },
    VEHICLE_MODEL: {
        list:    { url: '/vehicle-models',       method: 'GET', useFormData: false },
        optionList: { url: '/vehicle-types',       method: 'GET', useFormData: false },
        detail:  { url: '/vehicle-models/{id}',  method: 'GET', useFormData: false },
        create:  { url: '/vehicle-models',       method: 'POST', useFormData: true },
        update:  { url: '/vehicle-models/{id}',  method: 'PUT', useFormData: true  },
        delete:  { url: '/vehicle-models/delete',  method: 'POST', useFormData: false },
    },
    BUS_STATION: {
        list:        { url: '/public-transit/station/bus',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/station/bus',           method: 'POST', useFormData: false },
        create:      { url: '/public-transit/station/bus',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/station/bus/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/station/bus/origin',    method: 'GET',  useFormData: false },
    },
    RAIL_STATION: {
        list:        { url: '/public-transit/station/rail',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/station/rail',           method: 'POST', useFormData: false },
        create:      { url: '/public-transit/station/rail',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/station/rail/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/station/rail/origin',    method: 'GET',  useFormData: false },
    },
    NETWORK: {
        list:        { url: '/network',           method: 'GET',  useFormData: false },
        update:      { url: '/network',           method: 'POST', useFormData: false },
        historyList: { url: '/network/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/network/origin',    method: 'GET',  useFormData: false },
    },
    PAVEMENT_MARKING: {
        list:        { url: '/pavement-marking',            method: 'GET',  useFormData: false },
        update:      { url: '/pavement-marking',            method: 'POST', useFormData: false },
        create:      { url: '/pavement-marking',            method: 'POST', useFormData: false },
        historyList: { url: '/pavement-marking/histories',  method: 'GET',  useFormData: false },
        origin:      { url: '/pavement-marking/origin',     method: 'GET',  useFormData: false },
    },
    SCHEMA_SETTING: {
        list:    { url: '/schema', method: 'GET',   useFormData: false },
        update:  { url: '/schema/{layer-key}', method: 'POST',  useFormData: false },
    },
    SIGNAL: {
        list:        { url: '/signal',            method: 'GET',  useFormData: false },
        update:      { url: '/signal',            method: 'POST', useFormData: false },
        create:      { url: '/signal',            method: 'POST', useFormData: false },
        historyList: { url: '/signal/histories',  method: 'GET',  useFormData: false },
        origin:      { url: '/signal/origin',     method: 'GET',  useFormData: false },
    },
    MENU: {
        tree: {url: '/menu/tree', method: 'GET', useFormData: false},
    },
    BUS_PT_LINE: {
        list:        { url: '/public-transit/line/bus',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/line/bus',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/line/bus/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/line/bus/origin',    method: 'GET',  useFormData: false },
    },
    BUS_PT_LINE_WEEKDAY: {
        list:        { url: '/public-transit/line/bus/weekday',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/line/bus/weekday',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/line/bus/weekday/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/line/bus/weekday/origin',    method: 'GET',  useFormData: false },
    },
    BUS_PT_LINE_WEEKEND: {
        list:        { url: '/public-transit/line/bus/weekend',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/line/bus/weekend',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/line/bus/weekend/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/line/bus/weekend/origin',    method: 'GET',  useFormData: false },
    },
    RAIL_PT_LINE: {
        list:        { url: '/public-transit/line/rail',           method: 'GET',  useFormData: false },
        update:      { url: '/public-transit/line/rail',           method: 'POST', useFormData: false },
        historyList: { url: '/public-transit/line/rail/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/public-transit/line/rail/origin',    method: 'GET',  useFormData: false },
    },
    SIGNAL_TOD: {
        list:        { url: '/signal-tod',           method: 'GET',  useFormData: false },
        update:      { url: '/signal-tod',           method: 'POST', useFormData: false },
        historyList: { url: '/signal-tod/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/signal-tod/origin',    method: 'GET',  useFormData: false },
    },
    SIMULATION_SCENARIO: {
        list:        { url: '/simulation-scenario',           method: 'GET',  useFormData: false },
        update:      { url: '/simulation-scenario',           method: 'POST', useFormData: false },
        historyList: { url: '/simulation-scenario/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/simulation-scenario/origin',    method: 'GET',  useFormData: false },
    },
    SCENARIO_VERSION: {
        create: { url: '/scenario', method: 'POST', useFormData: false },
    },
    OD_MATRIX: {
        list:        { url: '/od-matrix',           method: 'GET',  useFormData: false },
        update:      { url: '/od-matrix',           method: 'POST', useFormData: false },
        historyList: { url: '/od-matrix/histories', method: 'GET',  useFormData: false },
        origin:      { url: '/od-matrix/origin',    method: 'GET',  useFormData: false },
    },

} as const;

export type ApiMap = typeof apiConfig;
export type ApiMenuKey = keyof ApiMap;
