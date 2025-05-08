import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import * as olProj from "ol/proj";
import { getDistance } from "ol/sphere";

export default class VehicleFactory {

    private source: VectorSource;
    private speed: number;
    private running: boolean;
    private animationId: number | null;
    private lastUpdateTime: number;

    constructor(features, source: VectorSource, speed:number, status: boolean) {
        this.source = source;
        this.speed = speed;
        this.running = status;
        this.animationId = null;
        this.lastUpdateTime = performance.now();

        this.updateAnimation = this.updateAnimation.bind(this);

        if (this.running) {
            this.start();
        }

        this.initializeVehiclePoint(features)

    }

    initializeVehiclePoint(features) {
        const vehicleFeatures = features.map((feature, idx) => {
            const initialCoordinate = olProj.fromLonLat(feature.geometry.coordinates[0]);
            const originalRoute = feature.geometry.coordinates;
            const projectedRoute = originalRoute.map(coord => olProj.fromLonLat(coord))
            const distanceCache = originalRoute.slice(0, -1).map((coord, i) =>
                getDistance(coord, originalRoute[i + 1])
            );

            const vehiclePoint = new Feature({ geometry: new Point(initialCoordinate) });
            vehiclePoint.set("initialCoordinate", initialCoordinate);
            vehiclePoint.set("originalRoute", originalRoute);
            vehiclePoint.set("projectedRoute", projectedRoute);
            vehiclePoint.set("distanceCache", distanceCache);
            vehiclePoint.set("currentIndex", 0);
            vehiclePoint.set("progress", 0);
            vehiclePoint.setId(`vehicle${idx}`);
            return vehiclePoint;
        });

        this.source.addFeatures(vehicleFeatures);
    }

    updateAnimation() {
        if (!this.running) return;

        const now = performance.now();
        const deltaTime = (now - (this.lastUpdateTime || now)) / 1000; // 초 단위
        this.lastUpdateTime = now;

        this.source.getFeatures().forEach((feature) => {
            const id = feature.getId();
            if (typeof id === "string" && id.startsWith("vehicle") && !id.endsWith("trail")){
                this.updateVehiclePosition(feature, deltaTime);
            }
        });

        this.animationId = requestAnimationFrame(this.updateAnimation);
    }

    updateVehiclePosition(feature: Feature, deltaTime: number) {
        const projectedRoute: number[][] = feature.get("projectedRoute");
        let currentIndex: number = feature.get("currentIndex");
        let progress: number = feature.get("progress");
        let distanceCache: number[] = feature.get("distanceCache");

        if (!projectedRoute || projectedRoute.length < 2) return;
        if (currentIndex >= projectedRoute.length - 1) return;
        if (!distanceCache || distanceCache.length <= currentIndex) {
            console.warn(`[VehicleFactory] Invalid distanceCache for feature ${feature.getId()}`);
            return;
        }

        const speedMps = this.speed / 3.6;

        let timeToTravel = distanceCache[currentIndex] / speedMps;
        progress += deltaTime / (timeToTravel);

        while (progress >= 1 && currentIndex < projectedRoute.length - 1) {
            progress -= 1;
            currentIndex++;
        }

        const startProj = projectedRoute[currentIndex];
        const endProj = projectedRoute[Math.min(currentIndex + 1, projectedRoute.length - 1)];

        const interpX = startProj[0] + (endProj[0] - startProj[0]) * progress;
        const interpY = startProj[1] + (endProj[1] - startProj[1]) * progress;

        const geom = feature.getGeometry() as Point;
        if (geom) {
            geom.setCoordinates([interpX, interpY]);
        } else {
            feature.setGeometry(new Point([interpX, interpY]));
        }

        feature.set("currentIndex", currentIndex);
        feature.set("progress", progress);
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

    setSpeed(speed: number) {
        this.speed = speed;
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