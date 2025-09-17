import { BusStationResponse, ExitResponse, RailStationResponse } from "@type/openapi.gen";

export const MENU_CODE = {
    BUS_STATION: 'BUS_STATION',
    RAIL_STATION: 'RAIL_STATION',
}

export const TRANSIT_MODE = {
    BUS: 'bus',
    SUBWAY: 'subway',
    TRAM: 'tram',
    DRT: 'drt',
} as const;
export const FEATURE_TYPE = {
    BUS_STATION: 'busStations',
    RAIL_STATION: 'railStations',
    RAIL_STATION_EXIT: 'exits',
} as const;

export type TransitMode = typeof TRANSIT_MODE[keyof typeof TRANSIT_MODE];

export interface BusStationData extends BusStationResponse{
    __guid: string;
    featureType: string;
    menuCode: string
}

export interface BusPublicStationResponse {
    busStations: BusStationData[]
}

export interface RailPublicStationResponse {
    railStations: RailStationData[]
}

export interface RailStationData extends RailStationResponse {
    __guid: string;
    featureType: typeof FEATURE_TYPE.RAIL_STATION;
    menuCode: string
}

export interface RailStationExitData extends ExitResponse{
    __guid: string | null;
    featureType: typeof FEATURE_TYPE.RAIL_STATION_EXIT;
    menuCode: string
}

