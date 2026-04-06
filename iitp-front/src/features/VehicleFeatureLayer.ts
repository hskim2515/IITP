import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";

const TYPE_COLORS: Record<string, string> = {
    'CAR':     'rgb(100, 160, 255)',
    'TAXI':    'rgb(255, 220, 0)',
    'BUS':     'rgb(255, 90, 90)',
    'TRUCK':   'rgb(180, 120, 60)',
    'MOTO':    'rgb(80, 220, 130)',
    'default': 'rgb(251, 188, 96)',
};

export default class VehicleFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    private speed: number;
    private running: boolean;
    private animationId: number | null = null;
    private lastUpdateTime: number = performance.now();
    private positions: number[][] = [];        // 목표 위치 (worker에서 수신)
    private prevPositions: number[][] = [];    // 이전 위치 (보간 시작점)
    private lerpStartTime: number = 0;         // 마지막 위치 수신 시각
    private readonly LERP_DURATION = 50;       // worker 전송 주기(ms)와 동기화
    private vehicleType: string;

    constructor(vehicleRoute: any[], vectorSource, speed: number, running: boolean, vehicleType: string = 'default') {
        const color = TYPE_COLORS[vehicleType] ?? TYPE_COLORS['default'];
        const radius = (vehicleType === 'BUS' || vehicleType === 'TRUCK') ? 6 : 4;

        super({
            source: vectorSource,
            visible: false,
            style: {
                "circle-radius": radius,
                "circle-fill-color": color,
            },
            zIndex: 350,
        });
        this.vehicleType = vehicleType;

        this.source = vectorSource;
        this.speed = speed;
        this.running = running;
        this.lastUpdateTime = performance.now();

        this.createResources(vehicleRoute);

        // 초기 위치 설정
        if (vehicleRoute && vehicleRoute.length > 0) {
            const initialPositions = vehicleRoute.map(route => route[0]); // 각 vehicle의 첫 번째 위치
            this.setLatestPositions({positions: initialPositions});
        }

        if (running) {
            this.start();
        }
    }

    private convertToEPSG3857(position: number[]): number[] {
        if (!position || position.length !== 3) {
            // 기본값으로 0,0,0 사용
            position = [0, 0, 0];
        }

        // 유효한 Cartesian3 좌표인지 확인
        try {
            const carto = Cartographic.fromCartesian({ x: position[0], y: position[1], z: position[2] }, Ellipsoid.WGS84);
            if (!carto) {
                // 유효하지 않은 좌표인 경우 기본값으로 처리
                return fromLonLat([0, 0]);
            }
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            return fromLonLat([lon, lat]);
        } catch (error) {
            console.warn("[VehicleFeatureLayer] Failed to convert position:", error);
            // 에러 발생 시 기본값으로 처리
            return fromLonLat([0, 0]);
        }
    }

    private createResources(vehicleRoute: any[]) {

        this.features = vehicleRoute.map((route, idx) => {
            // 🟡 t === 0인 좌표만 찾기
            let initialPosition: number[] = [0, 0, 0];
            for (let i = 0; i < route.length; i += 4) {
                const t = route[i];
                const x = route[i + 1];
                const y = route[i + 2];
                const z = route[i + 3];

                if (t === 0) {
                    initialPosition = [x, y, z];
                    break;
                }
            }

            const coord = this.convertToEPSG3857(initialPosition);

            const pointFeature = new Feature<Point>({
                geometry: new Point(coord),
            });

            pointFeature.setId(`vehicle${idx}`);
            pointFeature.set("vehicleType", this.vehicleType);
            pointFeature.set("initialCoordinate", coord);

            this.source.addFeature(pointFeature);
            return pointFeature;
        });
    }

    setLatestPositions(latestPositions) {
        const handleUndefined = (pos: number[] | undefined, idx: number): number[] | null => {
            if (!pos) {
                const prevPos = this.positions[idx];
                if (prevPos) {
                    return prevPos;
                }
                return fromLonLat([0, 0]);
            }
            return pos;
        };

        const converted = latestPositions.positions.map((pos, idx) => {
            if (!pos) {
                // 비활성 차량: 이전 위치 유지 (null 반환하면 인덱스 불일치 발생)
                return this.positions[idx] ?? null;
            }
            try {
                return this.convertToEPSG3857(pos);
            } catch {
                return this.positions[idx] ?? null;
            }
        });

        // lerp 시작점: 이전 위치가 없으면 현재와 동일하게(순간이동 방지)
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
        // source.getFeatures()는 공간인덱스 순서로 반환 → this.features 직접 사용
        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            const target = this.positions[index];
            if (!geom || !target) return;
            geom.setCoordinates(target);
            feature.changed();
        });
    }

    private updateAnimation = () => {
        const t = Math.min((performance.now() - this.lerpStartTime) / this.LERP_DURATION, 1.0);

        // source.getFeatures()는 공간인덱스 순서 → this.features 직접 사용
        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            const target = this.positions[index];
            if (!geom || !target) return;

            const prev = this.prevPositions[index];
            if (prev && t < 1.0) {
                const dx = target[0] - prev[0];
                const dy = target[1] - prev[1];
                const distSq = dx * dx + dy * dy;
                if (distSq > 1e10) {
                    geom.setCoordinates(target);
                } else {
                    geom.setCoordinates([prev[0] + dx * t, prev[1] + dy * t]);
                }
            } else {
                geom.setCoordinates(target);
            }
            feature.changed();
        });

        if (this.running) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else {
            this.animationId = null;
        }
    };

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {
        this.running = isRunning;
        if (isRunning && this.animationId === null) {
            this.lastUpdateTime = performance.now();
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else if (!isRunning && this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    public start() {
        console.log("[VehicleFeatureLayer] start() called");
        this.setStatus(true);
    }

    public stop() {
        console.log("[VehicleFeatureLayer] stop() called");
        this.setStatus(false);
    }

    public destroy() {
        console.log("[VehicleFeatureLayer] Destroying layer");
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.source.clear();
        this.source.refresh();
        this.running = false;
    }
}
