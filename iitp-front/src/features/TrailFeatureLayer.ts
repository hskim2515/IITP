import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";

const MAX_TRAIL_LENGTH = 80;

type Cartesian3Like = { x: number; y: number; z: number };
type PositionData =
    | { positions: Array<Cartesian3Like | null> }
    | Array<Cartesian3Like | number[] | null | undefined>;

export default class TrailFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private running: boolean;
    private speed: number;

    /** vehicle index → accumulated EPSG:3857 [x, y] coords (sliding window) */
    private trails = new Map<number, number[][]>();
    /** vehicle index → OL Feature */
    private trailFeatures = new Map<number, Feature<LineString>>();

    constructor(vehicleRoute: number[][][], speed: number, running: boolean) {
        const source = new VectorSource();

        const style = {
            "stroke-color": [
                "interpolate", ["linear"], ["line-metric"],
                0.0, [149, 122, 112, 0],
                0.5, [214, 90, 42, 0.5],
                1.0, [255, 149, 108, 1],
            ],
            "stroke-width": [
                "interpolate", ["linear"], ["line-metric"],
                0.0, 0,
                1.0, 3,
            ],
        };

        const isVisible = useLayerStore.getState().activeLayerName?.includes("trip") ?? false;

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

        if (running) this.start();
    }

    private toEPSG3857(pos: Cartesian3Like | number[]): number[] | null {
        try {
            const c = Array.isArray(pos)
                ? new Cartesian3(pos[0], pos[1], pos[2])
                : new Cartesian3(pos.x, pos.y, pos.z);
            const carto = Cartographic.fromCartesian(c, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)]);
        } catch {
            return null;
        }
    }

    public setLatestPositions(data: PositionData) {
        if (!this.running) return;

        const positions: Array<Cartesian3Like | number[] | null | undefined> = Array.isArray(data)
            ? data
            : (data as { positions: Array<Cartesian3Like | null> }).positions;

        if (!positions) return;

        positions.forEach((pos, idx) => {
            if (!pos) return;

            const xy = this.toEPSG3857(pos as Cartesian3Like | number[]);
            if (!xy) return;

            if (!this.trails.has(idx)) this.trails.set(idx, []);
            const trail = this.trails.get(idx)!;

            trail.push(xy);
            if (trail.length > MAX_TRAIL_LENGTH) trail.splice(0, trail.length - MAX_TRAIL_LENGTH);

            if (trail.length < 2) return;

            // XYM 좌표: M = i/(n-1), 0.0=꼬리, 1.0=머리
            const n = trail.length;
            const xymCoords: number[][] = trail.map((coord, i) => [coord[0]!, coord[1]!, i / (n - 1)]);

            if (!this.trailFeatures.has(idx)) {
                const feature = new Feature({ geometry: new LineString(xymCoords, "XYM") });
                this.trailFeatures.set(idx, feature);
                this.source.addFeature(feature);
            } else {
                this.trailFeatures.get(idx)!.getGeometry()!.setCoordinates(xymCoords, "XYM");
            }
        });
    }

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {
        this.running = isRunning;
    }

    public start() {
        this.setStatus(true);
    }

    public stop() {
        this.setStatus(false);
        this.trails.clear();
        this.trailFeatures.clear();
        this.source.clear();
    }

    public destroy() {
        this.stop();
    }
}