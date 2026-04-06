import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";

const TYPE_COLORS: Record<string, [number, number, number, number]> = {
    'CAR':     [100, 160, 255, 0.92],
    'TAXI':    [255, 220,   0, 0.92],
    'BUS':     [255,  90,  90, 0.92],
    'TRUCK':   [180, 120,  60, 0.92],
    'MOTO':    [ 80, 220, 130, 0.92],
    'default': [251, 188,  96, 0.92],
};

// 차종별 크기: [길이, 폭]
const TYPE_REAL: Record<string, [number, number]> = {
    'CAR':   [4.5, 1.8],
    'TAXI':  [4.5, 1.8],
    'BUS':   [12,  2.5],
    'TRUCK': [8,   2.5],
    'MOTO':  [2.2, 0.8],
};

// canvas roundRect 아이콘 기본 해상도(px) — 길이 방향
const BASE_LEN = 32;

/** 차종별 둥근 직사각형 아이콘을 canvas로 생성하여 data URL 반환 */
function buildVehicleIcon(vehicleType: string): string {
    const [r, g, b, a] = TYPE_COLORS[vehicleType] ?? TYPE_COLORS['default']!;
    const [realLen, realW] = TYPE_REAL[vehicleType] ?? TYPE_REAL['CAR']!;
    const aspect = realW / realLen;

    const w = Math.round(BASE_LEN * aspect);
    const h = BASE_LEN;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const radius = Math.min(w, h) * 0.25;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radius);
    ctx.fill();

    return canvas.toDataURL();
}

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
        const iconSrc = buildVehicleIcon(vehicleType);
        const [realLen] = TYPE_REAL[vehicleType] ?? TYPE_REAL['CAR']!;

        super({
            source: vectorSource,
            visible: false,
            style: {
                "icon-src": iconSrc,
                // 실세계 크기 유지: resolution(m/px) 기준 스케일
                "icon-scale": [
                    "clamp",
                    ["/", realLen / 2, ["*", BASE_LEN / 2, ["resolution"]]],
                    0.25,
                    5.0,
                ],
                // zoom 15 이하(resolution > 5 m/px)에서 페이드아웃
                "icon-opacity": [
                    "interpolate", ["linear"], ["resolution"],
                    3, 1,
                    5, 0,
                ],
                // heading 회전 (North=0, CW 라디안)
                "icon-rotation": ["get", "heading"],
                "icon-rotation-alignment": "map",
            },
            zIndex: 350,
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
            feature.set("vehicleType", this.vehicleType);
            feature.set("heading", 0);

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

        // heading 업데이트
        if (latestPositions.headings) {
            latestPositions.headings.forEach((h, idx) => {
                if (h != null && this.features[idx]) {
                    this.features[idx]!.set("heading", h);
                }
            });
        }

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
