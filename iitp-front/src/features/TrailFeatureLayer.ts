import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";

export default class TrailFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private running: boolean;
    private animationId: number | null = null;
    private speed: number;

    constructor(vehicleRoute: number[][][], speed: number, running: boolean) {
        const source = new VectorSource();

        const style = {
            "circle-radius": [
                "interpolate", ["linear"], ["get", "life"],
                0.0, 0.0,
                1.0, 2.0
            ],
            "circle-fill-color": [
                "interpolate", ["linear"], ["get", "life"],
                0.0, 'rgb(149,122,112, 0.0)',
                0.5, 'rgb(214,90,42, 0.5)',
                1.0, 'rgb(255,149,108)'
            ]
        };

        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        const isVisible = activeLayerName?.includes("trip") ?? false;

        super({
            source,
            style,
            visible: isVisible,
            zIndex: 130,
            disableHitDetection: true,
        });

        this.source = source;
        this.running = running;
        this.speed = speed;
        this.startTime = performance.now();

        if (running) {
            this.start();
        }
    }

    private convertToEPSG3857(position: number[]): number[] | null {
        if (!position || position.length !== 3) return null;
        try {
            const carto = Cartographic.fromCartesian(
                { x: position[0], y: position[1], z: position[2] },
                Ellipsoid.WGS84
            );
            const lon = CesiumMath.toDegrees(carto.longitude);
            const lat = CesiumMath.toDegrees(carto.latitude);
            return fromLonLat([lon, lat]);
        } catch (err) {
            console.warn("[TrailFeatureLayer] Conversion failed", err);
            return null;
        }
    }

    public setLatestPositions(latestPositions: Array<number[] | undefined>) {
        latestPositions.forEach((pos) => {
            if (!pos || pos.length < 3) return;
            const coord = this.convertToEPSG3857(pos);
            if (!coord) return;

            const pointFeature = new Feature({ geometry: new Point(coord) });
            pointFeature.set("life", 1.0);
            this.source.addFeature(pointFeature);
        });
    }

    private updateAnimation = () => {
        if (!this.running) return;

        const decayRate = 0.01; // 1초당 0.01씩 감소
        const toRemove: Feature[] = [];

        this.source.getFeatures().forEach((f) => {
            let life = f.get("life") ?? 1.0;
            life -= decayRate;
            if (life <= 0) {
                toRemove.push(f);
            } else {
                f.set("life", life);
            }
        });

        toRemove.forEach((f) => this.source.removeFeature(f));

        this.animationId = requestAnimationFrame(this.updateAnimation);
    };

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {
        this.running = isRunning;
        if (isRunning && this.animationId === null) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else if (!isRunning && this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public start() {
        this.setStatus(true);
    }

    public stop() {
        this.setStatus(false);
    }

    public destroy() {
        this.stop();
        this.source.clear();
    }
}
