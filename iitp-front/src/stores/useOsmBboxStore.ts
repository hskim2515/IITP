import { create } from 'zustand';

export interface OsmBbox {
    south: number;
    west: number;
    north: number;
    east: number;
}

/** WGS84 폴리곤 링 하나 — [lon,lat] 좌표 배열 (GeoJSON 좌표 순서와 동일) */
export type BoundaryRing = number[][];

interface OsmBboxState {
    /** OSM 임포트 전용 사각형(DragBox) 그리기 모드 — KTDB 폴리곤 그리기(selectingPolygon)와 별개 */
    selecting: boolean;
    bbox: OsmBbox | null;
    /** KTDB 임포트 전용 폴리곤 그리기 모드 */
    selectingPolygon: boolean;
    /** KTDB 임포트 경계 — 폴리곤 그리기 또는 SHP/GeoJSON 업로드로 세팅. 여러 링이면 합집합. */
    polygons: BoundaryRing[] | null;
    setSelecting: (v: boolean) => void;
    setBbox: (bbox: OsmBbox | null) => void;
    setSelectingPolygon: (v: boolean) => void;
    /** 링 목록을 세팅하고, 그 전체 min/max로 bbox(읽기전용 envelope 표시용)를 함께 계산한다. */
    setPolygons: (rings: BoundaryRing[] | null) => void;
}

function envelopeOf(rings: BoundaryRing[]): OsmBbox | null {
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const ring of rings) {
        for (const pt of ring) {
            const lon = pt[0], lat = pt[1];
            if (lon == null || lat == null) continue;
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        }
    }
    if (!isFinite(south) || !isFinite(west) || !isFinite(north) || !isFinite(east)) return null;
    return { south, west, north, east };
}

export const useOsmBboxStore = create<OsmBboxState>((set) => ({
    selecting: false,
    bbox: null,
    selectingPolygon: false,
    polygons: null,
    setSelecting: (selecting) => set({ selecting }),
    setBbox: (bbox) => set({ bbox, selecting: false }),
    setSelectingPolygon: (selectingPolygon) => set({ selectingPolygon }),
    setPolygons: (rings) => set({
        polygons: rings,
        bbox: rings && rings.length > 0 ? envelopeOf(rings) : null,
        selectingPolygon: false,
    }),
}));
