export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const
export const RAIL_SNAP_FEATURE_TYPE = "link-edit" as const

export const BUS_STATION_SNAP_FIELDS = [ 'linkRef', 'laneRef', 'offset', 'coordinates'] as const;
export const RAIL_STATION_SNAP_FIELDS = [ 'linkRef', 'address', 'coordinates'] as const;
export const RAIL_STATION_EXIT_SNAP_FIELDS = [ 'linkRef', 'exitRef', 'offset', 'accessTime', 'coordinates'] as const;

export type BusStationSnapFields = typeof BUS_STATION_SNAP_FIELDS[number];
export type RailStationSnapFields = typeof RAIL_STATION_SNAP_FIELDS[number];
export type RailStationExitSnapFields = typeof RAIL_STATION_EXIT_SNAP_FIELDS[number];

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
}
export type TransitMode = typeof TRANSIT_MODE[keyof typeof TRANSIT_MODE];

export interface Coordinates {
    coordinates: [{
        lng: number | null,
        lat: number | null,
    }],
}

export interface BusStationData {
    __guid: string;
    featureType: string;
    id: string | undefined;
    transitMode: string;
    linkRef: number | null;
    laneRef: number | null;
    offset: number | null;
    type: string | null;
    address: string | null;
    coordinates: [{
        lng: number | null,
        lat: number | null,
    }],
    parkingLots: number | null;
    menuCode: string
}
export type BusStationFeature  = BusStationData;

export interface RailStationData {
    __guid: string;
    featureType: typeof FEATURE_TYPE.RAIL_STATION;
    id: string | undefined;
    transitMode: TransitMode;
    linkRef: string | undefined;
    address: string | null;
    coordinates: [{
        lng: number | null;
        lat: number | null;
    }];
    exits: RailStationExitData | null
    menuCode: string
}
export type RailStationFeature = Omit<RailStationData, 'exits'>

export interface RailStationExitData {
    __guid: string | null;
    featureType: typeof FEATURE_TYPE.RAIL_STATION_EXIT;
    id: number | undefined;
    linkRef: string | null;
    exitRef: number | undefined;
    offset: number | null;
    accessTime: number | null;
    coordinates: [{
        lng: number | null;
        lat: number | null;
    }];
    menuCode: string
}
export type RailStationExitFeature  = RailStationExitData;

export type BusStationSnapProperties = Pick<BusStationData, BusStationSnapFields>;
export type RailStationSnapProperties = Pick<RailStationFeature, RailStationSnapFields>;
export type RailStationExitSnapProperties = Pick<RailStationExitFeature, RailStationExitSnapFields>;

