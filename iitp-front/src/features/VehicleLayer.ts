import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";

export default class VehicleLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    private speed: number;
    private running: boolean;
    private animationId: number | null = null;
    private lastUpdateTime: number = performance.now();
    private positions: number[][] = [];

    constructor(vehicleRoute: any[], vectorSource, speed: number, running: boolean) {

        super({
            source: vectorSource,
            visible: true,
            style: {
                "circle-radius": 4,
                "circle-fill-color": "rgb(251,188,96)",
            },
            zIndex: 110,
        });

        this.source = vectorSource;
        this.speed = speed;
        this.running = running;
        this.lastUpdateTime = performance.now();

        this.createResources(vehicleRoute);

        // 초기 위치 설정
        if (vehicleRoute && vehicleRoute.length > 0) {
            const initialPositions = vehicleRoute.map(route => route[0]); // 각 vehicle의 첫 번째 위치
            this.setLatestPositions(initialPositions);
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
            console.warn("[VehicleLayer] Failed to convert position:", error);
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
            pointFeature.set("initialCoordinate", coord);

            this.source.addFeature(pointFeature);
            return pointFeature;
        });
    }

    setLatestPositions(latestPositions: number[][]) {
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

        const converted = latestPositions.map((pos, idx) => {
            try {
                const validPos = handleUndefined(pos, idx);
                return validPos ? this.convertToEPSG3857(validPos) : null;
            } catch (err) {
                // 에러 발생 시 이전 위치 유지
                return this.positions[idx] || fromLonLat([0, 0]);
            }
        }).filter(p => p !== null) as number[][];

        this.positions = converted;
    }

    private updateAnimation = () => {
        // 위치 업데이트는 항상 수행하고, 애니메이션은 running 상태에 따라 결정
        const features = this.source.getFeatures();

        features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            const target = this.positions[index];
            if (!geom || !target) return;
            geom.setCoordinates(target);
            feature.changed();
        });

        // 애니메이션이 필요한 경우에만 다음 프레임을 요청
        if (this.running && this.positions.length > 0) {
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
        console.log("[VehicleLayer] start() called");
        this.setStatus(true);
    }

    public stop() {
        console.log("[VehicleLayer] stop() called");
        this.setStatus(false);
    }

    public destroy() {
        console.log("[VehicleLayer] Destroying layer");
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.source.clear();
        this.source.refresh();
        this.running = false;
    }
}
