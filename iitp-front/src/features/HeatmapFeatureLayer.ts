import Heatmap from "ol/layer/Heatmap";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";

// WGS84 constants for ECEF → lon/lat conversion
const WGS84_A  = 6378137.0;
const WGS84_E2 = 0.00669437999014;

function ecefToOlCoord(x: number, y: number, z: number): [number, number] {
    const lon = Math.atan2(y, x) * (180 / Math.PI);
    const p   = Math.sqrt(x * x + y * y);
    let lat   = Math.atan2(z, p * (1 - WGS84_E2));
    for (let i = 0; i < 5; i++) {
        const sinLat = Math.sin(lat);
        const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
        lat = Math.atan2(z + WGS84_E2 * N * sinLat, p);
    }
    return fromLonLat([lon, lat * (180 / Math.PI)]) as [number, number];
}

export default class HeatmapFeatureLayer extends Heatmap {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    private speed: number;
    private running: boolean;
    private animationId: number | null = null;

    constructor(
        vehicleRoute: any[],
        vectorSource,
        speed: number,
        running: boolean,
        colors: string[],
        blur: number = 15
    ) {
        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        const isVisible = activeLayerName?.includes("heatmap") ?? false;

        super({
            source: vectorSource,
            blur,
            radius: blur,
            gradient: colors,
            weight: () => 0.9,
            visible: isVisible,
            zIndex: 220,
        });

        this.source = vectorSource;
        this.speed = speed;
        this.running = running;

        if (running) {
            this.start();
        }
    }

    public setLatestPositions(data: { positions: (number[] | undefined)[] }) {
        const source = this.getSource();
        if (!source) return;

        source.clear();
        const newFeatures: Feature<Point>[] = [];
        for (const pos of data.positions) {
            if (!pos) continue;
            const coord = ecefToOlCoord(pos[0], pos[1], pos[2]);
            newFeatures.push(new Feature(new Point(coord)));
        }
        source.addFeatures(newFeatures);
    }

    public setColors(colors: string[]) {
        this.setGradient(colors);
    }

    public setExaggeration(ex: number) {
        // weight는 고정 1이라 무시되지만 구조 유지
        const source = this.getSource();
        if (!source) return;

        source.getFeatures().forEach((f: any) => {
            f.set("weight", 1);
        });

        this.changed();
    }

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {

    }

    public start() {
        this.setStatus(true);
    }

    public stop() {
        this.setStatus(false);
    }


    public destroy() {

        this.features.forEach((f) => this.source.removeFeature(f));
        this.features = [];
        this.source.clear();
        this.running = false;
    }
}
