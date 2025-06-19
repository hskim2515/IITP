
export const apiConfig = {
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
    PT_BUS_STATION: {
        list: {url: '/public-transit/station/bus', method: 'GET', useFormData: false },
        update: {url: '/public-transit/station/bus/2', method: 'POST', useFormData: false },
        create: {url: '/public-transit/station/bus/2', method: 'POST', useFormData: false },
    },
    ROAD: {
        list: {url: '/network', method: 'GET', useFormData: false },
    },
} as const;

export type ApiMenuKey = keyof typeof apiConfig;