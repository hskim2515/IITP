import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point, LineString } from "ol/geom";

export default class VehicleFactory {

    private vehicleSource: VectorSource;
    private tripSource: VectorSource;

    private running: boolean;
    private animationId: number | null;

    private readonly MAX_TRAIL_LENGTH = 200;

    constructor(features, vehicleSource: VectorSource, tripSource: VectorSource, status: boolean) {
        this.vehicleSource = vehicleSource;
        this.tripSource = tripSource;

        this.running = status;
        this.animationId = null;

        this.updateAnimation = this.updateAnimation.bind(this);

        if (this.running) {
            this.start();
        }

        this.initializeTrailLine(features);
    }

    private initializeTrailLine(features) {
        features.forEach((idx) => {
            const vehicleFeature = this.vehicleSource.getFeatureById(`vehicle${idx}`);
            if (!vehicleFeature) return;

            const initialCoordinate = vehicleFeature.get("initialCoordinate");
            if (!initialCoordinate || initialCoordinate.length !== 2) return;

            const vehicleId = vehicleFeature.getId();
            const coordKey = `${vehicleId}_coords`;

            // 빈 Trail 좌표 배열 초기화
            vehicleFeature.set(coordKey, [initialCoordinate]);

            const trailSegment = new Feature({
                geometry: new LineString([initialCoordinate, initialCoordinate])
            });
            trailSegment.setId(`${vehicleId}_trail_segment_0`); // 초기값
            trailSegment.set("index", 0); // 초기값

            this.tripSource.addFeature(trailSegment);
        });
    }

    private updateAnimation() {
        if (!this.running) return;

        this.vehicleSource.getFeatures().forEach((vehicle) => {
            const id = vehicle.getId();
            if (typeof id === "string" && id.startsWith("vehicle") && !id.endsWith("trail")) {
                this.updateTrailLine(vehicle);
            }
        });

        this.animationId = requestAnimationFrame(this.updateAnimation);
    }

    private updateTrailLine(vehicle: Feature) {
        const vehicleId = vehicle.getId();
        if (!vehicleId) return;

        const point = vehicle.getGeometry() as Point;
        const currentCoord = point.getCoordinates();

        const coordKey = `${vehicleId}_coords`;
        const coords = (vehicle.get(coordKey) ?? []) as number[][];
        coords.push(currentCoord);

        // Trail 길이 제한
        if (coords.length > this.MAX_TRAIL_LENGTH) coords.shift();
        vehicle.set(coordKey, coords);

        // 기존 TrailSegment 제거
        this.tripSource.getFeatures()
            .filter(f => f.getId()?.toString().startsWith(`${vehicleId}_trail_segment`))
            .forEach(f => this.tripSource.removeFeature(f));

        // 새로운 세그먼트 추가
        for (let i = 1; i < coords.length; i++) {
            const segment = new Feature({
                geometry: new LineString([coords[i - 1], coords[i]])
            });
            segment.setId(`${vehicleId}_trail_segment_${i}`);
            segment.set("index", i / (coords.length - 1));

            this.tripSource.addFeature(segment);
        }
    }

    start() {
        if(this.running && this.animationId != null) return;
        this.running = true;
        this.animationId = requestAnimationFrame(this.updateAnimation);
    }

    stop() {
        if(this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.running = false
    }

    setStatus(isRunning: boolean) {
        this.running = isRunning;
        if(isRunning) {
            this.start()
        } else {
            this.stop()
        }
    }
    destroy() {
        this.stop();
    }
}