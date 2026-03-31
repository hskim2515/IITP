import Heatmap from "ol/layer/Heatmap";
import VectorSource from "ol/source/Vector";
import { useLayerStore } from "@stores/useLayerStore";
import { Feature } from "ol";
import { Point } from "ol/geom";

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

    public setLatestPositions(latestPositions) {

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
