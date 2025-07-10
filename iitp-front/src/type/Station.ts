export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const
export const BUS_STATION_SNAP_FIELDS = [ 'linkRef', 'laneRef', 'offset', 'lng', 'lat'] as const;
export type BusStationSnapFields = typeof BUS_STATION_SNAP_FIELDS[number];
export const TRANSIT_MODE = {
    BUS: 'bus',
    SUBWAY: 'subway',
    TRAM: 'tram',
    DRT: 'drt',
} as const;
export const FEATURE_TYPE = {
    BUS_STATION: 'busStations',
}
export type TransitMode = typeof TRANSIT_MODE[keyof typeof TRANSIT_MODE];

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
    lng: number | null;
    lat: number | null;
}

export type BusStationSnapProperties = Pick<BusStationData, BusStationSnapFields>;