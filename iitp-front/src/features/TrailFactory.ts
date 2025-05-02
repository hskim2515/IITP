import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point, LineString } from "ol/geom";

export default class VehicleFactory {

    private source: VectorSource;

    private running: boolean;
    private animationId: number | null;

    private MAX_TRAIL_LENGTH: number;

    constructor(features, source: VectorSource, status: boolean) {
        this.source = source;

        this.running = status;
        this.animationId = null;

        this.MAX_TRAIL_LENGTH = 200;

        this.updateAnimation = this.updateAnimation.bind(this);

        if (this.running) {
            this.start();
        }

        this.initializeTrailLine(features)
    }

    initializeTrailLine(features) {
        const trailFeatures = features.map((feature, idx)=> {
            const vehicleFeature = this.source.getFeatureById(`vehicle${idx}`)
            const initialCoordinate = vehicleFeature.get("initialCoordinate")
            const trailLine = new Feature({ geometry: new LineString([initialCoordinate, initialCoordinate])})
            trailLine.setId(`vehicle${idx}_trail`);
            return trailLine;
        })
        this.source.addFeatures(trailFeatures)
    }

    updateAnimation() {
        if (!this.running) return;

        this.source.getFeatures().forEach((feature) => {
            const id = feature.getId();
            if (typeof id === "string" && id.startsWith("vehicle") && !id.endsWith("trail")){
                this.updateTrailLine(feature);
            }
        });

        this.animationId = requestAnimationFrame(this.updateAnimation);
    }

    // 현재 차량 위치 추가
    updateTrailLine(vehiclePoint: Feature) {
        if(!vehiclePoint) return;
        const currentPoint = vehiclePoint.getGeometry() as Point;
        const coord = currentPoint.getCoordinates();
        const vehicleId = vehiclePoint.getId();
        const trailId = vehicleId+"_trail";
        if(!trailId) return;
        let trailFeature = this.source.getFeatureById(trailId) as Feature<LineString>;
        if (!trailFeature) {
            trailFeature = new Feature(new LineString([coord,coord]));
            trailFeature.setId(trailId);
            this.source.addFeature(trailFeature);
            return;
        }

        const line = trailFeature.getGeometry() as LineString;
        const coords = line.getCoordinates();

        coords.push(coord);
        if (coords.length > this.MAX_TRAIL_LENGTH) coords.shift();

        line.setCoordinates(coords);
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