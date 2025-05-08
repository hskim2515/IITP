import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';
import Polygon from 'ol/geom/Polygon';
import { Style } from 'ol/style';
import { Coordinate } from 'ol/coordinate';
import { fromLonLat } from "ol/proj";
import * as Cesium from "cesium";

export interface ODCellInfo {
    fromKey: string;
    toKey: string;
    fromCenter: Cesium.Cartesian3;
    toCenter: Cesium.Cartesian3;
    fromCoord: [number, number]; // 경도, 위도
    toCoord: [number, number];
    density: number;
}
const warmColors = [
    'rgba(255, 99, 71, 0.5)',
    'rgba(255, 140, 0, 0.5)',
    'rgba(255, 165, 0, 0.5)',
    'rgba(255, 215, 0, 0.5)',
    'rgba(255, 160, 122, 0.5)',
    'rgba(255, 105, 97, 0.5)',
];
export default class ODMatrixFactory {
    private source: VectorSource;
    private data: ODCellInfo[];
    private isRunning: boolean;

    constructor(data: ODCellInfo[], source: VectorSource, isRunning: boolean) {
        this.source = source;
        this.data = data;
        this.isRunning = isRunning;
        this.createODFeatures();
    }

    createODPolygon(start: Coordinate, end: Coordinate): Coordinate[] {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return [start, start, start, start, start];

        const norm = [dx / len, dy / len];
        const normal = [-norm[1], norm[0]];

        const offset = 100; // 폭 설정
        const startLeft: Coordinate = [start[0] + normal[0] * offset, start[1] + normal[1] * offset];
        const startRight: Coordinate = [start[0] - normal[0] * offset, start[1] - normal[1] * offset];
        const endPoint: Coordinate = end;
        return [startLeft, endPoint, startRight, startLeft];
    }
    getStableColor(fromKey: string, toKey: string): string {
        const hash = Array.from((fromKey + toKey))
            .reduce((acc, char) => acc + char.charCodeAt(0), 0);

        const warmColors = [
            'rgba(255, 99, 71, 0.5)',
            'rgba(255, 140, 0, 0.5)',
            'rgba(255, 165, 0, 0.5)',
            'rgba(255, 215, 0, 0.5)',
            'rgba(255, 160, 122, 0.5)',
            'rgba(255, 105, 97, 0.5)',
        ];

        return warmColors[hash % warmColors.length];
    }

    createODFeatures(): void {
        const features = this.data.map(cell => {
            const start = fromLonLat(cell.fromCoord);
            const end = fromLonLat(cell.toCoord);
            const polygonCoords = this.createODPolygon(start, end);

            const polygon = new Polygon([polygonCoords]);
            const feature = new Feature({ geometry: polygon });
            const color = this.getStableColor(cell.fromKey, cell.toKey);
            feature.set('color', color);

            return feature;
        });

        this.source.clear();
        this.source.addFeatures(features);
    }



    setStatus(isRunning: boolean) {
        this.isRunning = isRunning;
    }

    destroy() {
        this.source.clear();
    }
}
