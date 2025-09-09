import { Cartesian3 } from "cesium";

export const FEATURE_TYPE = {
    NODE: 'node',
    PORT: 'port',
    CONNECTION: 'connection',
    LINK: 'link',
    LANE: 'lane',
    CELL: 'cell',
    SEGMENT: 'segment',
} as const;

export interface Network {
    name: string | null
    links: Link[]
    nodes: Node[]
}

export interface Node {
    __guid? : string
    id: number | string
    type: string
    numPort: number
    numConnection: number
    v2x: string
    center: string
    coordinates: Coordinates
    ports: Port[]
    connections: Connection[]
}

export interface Port {
    __guid? : string
    linkId: number | string
    direction: number
    type: number | string
}

export interface Connection {
    __guid? : string
    id: number | string
    fromLink: number | string
    fromLane: number
    fromLaneCoordinates: Coordinates
    toLink: number | string
    toLane: number
    toLaneCoordinates: Coordinates
    turning: string
    length: number
    width: number
    ffSpd: number
    shape: string
    coordinates: Coordinates[]
}

export interface Link {
    __guid? : string
    id: number
    fromNode: number
    toNode: number
    numLane: number
    length: number
    width: number
    maxSpd: number
    minSpd:number
    ffSpd: number
    waveSpd: number
    qmax:number
    maxVeh:number
    simType: number | string
    type: string
    layer: string
    stopLine:number
    shape: string
    coordinates: Coordinates[]
    lanes: Lane[]
}

export interface Lane {
    __guid? : string
    id: number | string
    leftLaneId: number | string
    rightLaneId: number | string
    numCell: number
    rightLC: boolean
    leftLC: boolean
    laneAccessType: string | null
    shape: string
    coordinates: Coordinates[]
    segments: Segment[]
    cells: Cell[]
    laneSource: Cartesian3
    laneTarget: Cartesian3

}

export interface Cell {
    __guid? : string
    id: number | string
    length: number
    offset: number
}

export interface Segment {
    __guid? : string
    block: boolean
    endPoint: number
    id: number | string
    initPoint: number
}

export interface Coordinates {
    lat: number
    lng: number
}