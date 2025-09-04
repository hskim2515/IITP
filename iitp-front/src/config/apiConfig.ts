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
        //delete:  { url: '/vehicle-models/{id}',  method: 'DELETE' },
        delete:  { url: '/vehicle-models/delete',  method: 'POST', useFormData: false },
    },
    BUS_STATION: {
        list: {url: '/public-transit/station/bus', method: 'GET', useFormData: false },
        update: {url: '/public-transit/station/bus', method: 'POST', useFormData: false },
        create: {url: '/public-transit/station/bus', method: 'POST', useFormData: false },
        historyList: {url: '/public-transit/station/bus/history', method: 'GET', useFormData: false },
    },
    RAIL_STATION: {
        list: {url: '/public-transit/station/rail', method: 'GET', useFormData: false },
        update: {url: '/public-transit/station/rail', method: 'POST', useFormData: false },
        create: {url: '/public-transit/station/rail', method: 'POST', useFormData: false },
        historyList: {url: '/public-transit/station/rail/history', method: 'GET', useFormData: false },
    },
    NETWORK: {
        list: {url: '/network', method: 'GET', useFormData: false },
        update: {url: '/network/{id}', method: 'PUT', useFormData: true },
        create: {url: '/network', method: 'POST', useFormData: true },
        delete: {url: '/network/{id}', method: 'DELETE', useFormData: false },
        historyList: {url: '/network/history', method: 'GET', useFormData: false },
    },
    PAVEMENT_MARKING: {
        list:    { url: '/pavement-marking',       method: 'GET', useFormData: false },
        update:  { url: '/pavement-marking', method: 'POST', useFormData: false },
        create:  { url: '/pavement-marking', method: 'POST', useFormData: false },
        historyList: { url: '/pavement-marking/histories', method: 'GET', useFormData: false },
    },
    SCHEMA_SETTING: {
        list:    { url: '/schema', method: 'GET',   useFormData: false },
        update:  { url: '/schema/{layer-key}', method: 'POST',  useFormData: false },
    },
    SIGNAL: {
        list:    { url: '/signal',       method: 'GET', useFormData: false },
        update:  { url: '/signal', method: 'POST', useFormData: false },
        create:  { url: '/signal', method: 'POST', useFormData: false },
        historyList: { url: '/signal/histories', method: 'GET', useFormData: false },
    }

} as const;

export type ApiMenuKey = keyof typeof apiConfig;