import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";

const TYPE_COLORS: Record<string, [number, number, number]> = {
    'CAR':     [100, 160, 255],
    'TAXI':    [255, 220,   0],
    'BUS':     [255,  90,  90],
    'TRUCK':   [180, 120,  60],
    'MOTO':    [ 80, 220, 130],
    'default': [251, 188,  96],
};

export default class VehicleFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    private speed: number;
    private running: boolean;
    private animationId: number | null = null;
    private positions: number[][] = [];
    private prevPositions: number[][] = [];
    private lerpStartTime: number = 0;
    private readonly LERP_DURATION = 50;
    public readonly vehicleType: string;

    constructor(vehicleRoute: any[], vectorSource: VectorSource, speed: number, running: boolean, vehicleType: string = 'default') {
        const [r, g, b] = TYPE_COLORS[vehicleType] ?? TYPE_COLORS['default']!;

        super({
            source: vectorSource,
            visible: false,
            style: {
                "circle-radius": ["var", "pointRadius"],
                "circle-fill-color": ["color", r, g, b, ["var", "pointOpacity"]],
                "circle-stroke-color": "rgba(0,0,0,0.5)",
                "circle-stroke-width": 1,
            },
            variables: { pointRadius: 4, pointOpacity: 0.9 },
            zIndex: 550,
            disableHitDetection: true,
        });

        this.vehicleType = vehicleType;
        this.source = vectorSource;
        this.speed = speed;
        this.running = running;

        this.createResources(vehicleRoute);

        if (running) this.start();
    }

    private convertToEPSG3857(position: number[]): number[] {
        try {
            const carto = Cartographic.fromCartesian(
                { x: position[0], y: position[1], z: position[2] } as any,
                Ellipsoid.WGS84,
            );
            return fromLonLat([
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude),
            ]);
        } catch {
            return fromLonLat([0, 0]);
        }
    }

    private createResources(vehicleRoute: any[]) {
        this.features = vehicleRoute.map((route, idx) => {
            let initialPosition: number[] = [0, 0, 0];
            for (let i = 0; i < route.length; i += 4) {
                if (route[i] === 0) {
                    initialPosition = [route[i + 1], route[i + 2], route[i + 3]];
                    break;
                }
            }

            const coord = this.convertToEPSG3857(initialPosition);
            const feature = new Feature<Point>({ geometry: new Point(coord) });
            feature.setId(`vehicle${idx}`);
            this.source.addFeature(feature);
            return feature;
        });
    }

    setLatestPositions(latestPositions: { positions: (number[] | undefined)[]; headings?: (number | null)[] }) {
        const converted = latestPositions.positions.map((pos, idx) => {
            if (!pos) return this.positions[idx] ?? null;
            try {
                return this.convertToEPSG3857(pos);
            } catch {
                return this.positions[idx] ?? null;
            }
        });

        this.prevPositions = this.positions.length > 0 ? this.positions : converted;
        this.positions = converted;
        this.lerpStartTime = performance.now();

        if (!this.running) {
            this._syncFeatures();
        } else if (this.animationId === null && this.positions.length > 0) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        }
    }

    private _syncFeatures() {
        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            const target = this.positions[index];
            if (!geom || !target) return;
            geom.setCoordinates(target);
        });
    }

    private updateAnimation = () => {
        const t = Math.min((performance.now() - this.lerpStartTime) / this.LERP_DURATION, 1.0);

        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            const target = this.positions[index];
            if (!geom || !target) return;

            const prev = this.prevPositions[index];
            if (prev && t < 1.0) {
                const dx = target[0] - prev[0];
                const dy = target[1] - prev[1];
                if (dx * dx + dy * dy > 1e10) {
                    geom.setCoordinates(target);
                } else {
                    geom.setCoordinates([prev[0] + dx * t, prev[1] + dy * t]);
                }
            } else {
                geom.setCoordinates(target);
            }
        });

        if (this.running) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else {
            this.animationId = null;
        }
    };

    setPointStyle(radius: number, opacity: number) {
        this.updateStyleVariables({ pointRadius: radius, pointOpacity: opacity });
    }

    setSpeed(speed: number) { this.speed = speed; }
    setStatus(isRunning: boolean) {
        this.running = isRunning;
        if (isRunning && this.animationId === null) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else if (!isRunning && this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    start() { this.setStatus(true); }
    stop()  { this.setStatus(false); }

    destroy() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.source.clear();
        this.running = false;
    }
}
