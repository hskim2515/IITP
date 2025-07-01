export const SNAP_LAYER = "network" as const
export const SNAP_FEATURE_TYPE = "lane-edit" as const
export const BUS_STATION_SNAP_FIELDS = [ 'id','linkRef', 'laneRef', 'offset', 'lng', 'lat', '__guid' ] as const;
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
    id: string;
    transitMode: string;
    linkRef: number;
    laneRef: number;
    offset: number;
    type: string;
    address: string;
    lng: number;
    lat: number;
}

export type BusStationSnapProperties = Pick<BusStationData, BusStationSnapFields>;