import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";

const MAX_TRAIL_LENGTH = 80;

export default class TrailFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private running: boolean;
    private speed: number;
    // 차량별 [x, y] 좌표 이력 (M 값 재계산을 위해 별도 관리)
    private trailCoords: Map<number, [number, number][]> = new Map();
    private trailFeatures: Map<number, Feature<LineString>> = new Map();

    constructor(
        vehicleRoute: number[][][],
        speed: number,
        running: boolean,
    ) {
        const source = new VectorSource();

        // line-metric = M 컴포넌트 (0.0: 꼬리/투명 → 1.0: 머리/불투명)
        const style = {
            "stroke-width": [
                "interpolate", ["linear"], ["line-metric"],
                0.0, 1.0,
                1.0, 4.0
            ],
            "stroke-color": [
                "interpolate", ["linear"], ["line-metric"],
                0.0, ["color", 149, 122, 112, 0.0],
                0.4, ["color", 214, 90, 42, 0.5],
                1.0, ["color", 255, 149, 108, 1.0]
            ]
        };

        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        const isVisible = activeLayerName?.includes("trip") ?? false;

        super({
            source,
            style,
            visible: isVisible,
            zIndex: 130
        });

        this.source = source;
        this.running = running;
        this.speed = speed;

        if (running) {
            this.start();
        }
    }

    private convertToEPSG3857(position: number[]): [number, number] | null {
        if (!position || position.length !== 3) return null;
        try {
            const carto = Cartographic.fromCartesian(
                { x: position[0], y: position[1], z: position[2] },
                Ellipsoid.WGS84
            );
            const lon = CesiumMath.toDegrees(carto.longitude);
            const lat = CesiumMath.toDegrees(carto.latitude);
            const xy = fromLonLat([lon, lat]);
            return [xy[0], xy[1]];
        } catch (err) {
            console.warn("[TrailFeatureLayer] Conversion failed", err);
            return null;
        }
    }

    public setLatestPositions(latestPositions: Array<number[] | undefined>) {
        if (!this.running) return;

        latestPositions.forEach((pos, index) => {
            if (!pos || pos.length < 3) return;
            const xy = this.convertToEPSG3857(pos);
            if (!xy) return;

            // 좌표 이력 관리
            let coords = this.trailCoords.get(index);
            if (!coords) {
                coords = [];
                this.trailCoords.set(index, coords);
            }
            coords.push(xy);
            if (coords.length > MAX_TRAIL_LENGTH) {
                coords.splice(0, coords.length - MAX_TRAIL_LENGTH);
            }

            // M 값 정규화: index 0(꼬리) = 0.0, 마지막(머리) = 1.0
            const n = coords.length;
            const xymCoords: [number, number, number][] = coords.map(
                (c, i) => [c[0], c[1], n > 1 ? i / (n - 1) : 1.0]
            );

            // LineString은 최소 2점 필요
            if (xymCoords.length < 2) {
                xymCoords.push([...xymCoords[0]]);
            }

            let feature = this.trailFeatures.get(index);
            if (!feature) {
                const geometry = new LineString(xymCoords, "XYM");
                feature = new Feature<LineString>({ geometry });
                this.trailFeatures.set(index, feature);
                this.source.addFeature(feature);
            } else {
                feature.getGeometry()!.setCoordinates(xymCoords, "XYM");
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
    }

    public reset() {
        this.trailCoords.clear();
        this.trailFeatures.clear();
        this.source.clear();
    }

    public destroy() {
        this.stop();
        this.reset();
    }
}
