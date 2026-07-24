import shp from 'shpjs';
import type { BoundaryRing } from '@stores/useOsmBboxStore';

/**
 * KTDB 임포트 경계 파일(SHP/GeoJSON) → 폴리곤 링 목록(WGS84 [lon,lat]).
 * 파일에 다각형이 여러 개(피처 여러 개, MultiPolygon 등) 있으면 전부 뽑아 하나의 목록으로
 * 평탄화한다 — 필터링 시 "여러 링 중 하나라도 내부"로 합집합 취급되므로 진짜 지오메트리
 * union은 불필요. 홀(구멍)은 경계 필터 용도상 의미가 없어 무시하고 외곽 링만 사용한다.
 */
export async function parseBoundaryFile(file: File): Promise<BoundaryRing[]> {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'geojson' || ext === 'json') {
        const text = await file.text();
        const geojson = JSON.parse(text);
        return extractRings(geojson);
    }
    if (ext === 'shp' || ext === 'zip') {
        const buffer = await file.arrayBuffer();
        const result = await shp(buffer);
        const collections = Array.isArray(result) ? result : [result];
        return collections.flatMap((fc) => extractRings(fc));
    }
    throw new Error(`지원하지 않는 파일 형식입니다: .${ext} (geojson/json/shp/zip만 가능)`);
}

/** GeoJSON FeatureCollection/Feature/Geometry 어떤 형태든 재귀적으로 Polygon/MultiPolygon 외곽 링만 뽑는다. */
function extractRings(node: any): BoundaryRing[] {
    if (!node) return [];
    switch (node.type) {
        case 'FeatureCollection':
            return (node.features ?? []).flatMap((f: any) => extractRings(f));
        case 'Feature':
            return extractRings(node.geometry);
        case 'Polygon':
            // coordinates[0] = 외곽 링, [1..] = 홀 — 홀은 경계 필터 용도상 무시
            return node.coordinates?.[0] ? [node.coordinates[0] as BoundaryRing] : [];
        case 'MultiPolygon':
            return (node.coordinates ?? [])
                .map((poly: number[][][]) => poly[0])
                .filter((ring: BoundaryRing | undefined): ring is BoundaryRing => !!ring);
        case 'GeometryCollection':
            return (node.geometries ?? []).flatMap((g: any) => extractRings(g));
        default:
            return [];
    }
}
