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
    private trailMap: Map<number, Feature<LineString>> = new Map();
    private maxTrailLength: number = 30;
    private startTime: number;

    constructor(vehicleRoute: number[][][], speed: number, running: boolean) {
        const source = new VectorSource();

        const style = {
            "stroke-color": "rgba(255,149,108,0.8)",
            "stroke-width": 2,
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
        } catch {
            return null;
        }
    }

    public setLatestPositions(latestPositions) {
        // 먼저 모든 차량 인덱스를 순회
        latestPositions.positions.forEach((pos, idx) => {
            const coord = pos && pos.length >= 3 ? this.convertToEPSG3857(pos) : null;

            let feature = this.trailMap.get(idx);

            if (!feature && coord) {
                // 신규 차량 trail 생성
                feature = new Feature(new LineString([coord]));
                feature.setId(`trail-${idx}`);
                this.trailMap.set(idx, feature);
                this.source.addFeature(feature);
            } else if (feature) {
                const geom = feature.getGeometry() as LineString;
                const coords = geom.getCoordinates();

                if (coord) {
                    // 새 좌표가 있는 경우 추가
                    coords.push(coord);
                } else {
                    // 좌표가 없는 경우 가장 오래된 좌표(앞쪽)부터 제거 (꼬리가 점점 짧아짐)
                    if (coords.length > 0) {
                        coords.splice(0, 1);
                    }
                }

                // 최대 길이 제한
                if (coords.length > this.maxTrailLength) {
                    coords.splice(0, coords.length - this.maxTrailLength);
                }

                if (coords.length === 0) {
                    // 좌표가 모두 없어지면 feature 제거
                    this.source.removeFeature(feature);
                    this.trailMap.delete(idx);
                } else {
                    geom.setCoordinates(coords);
                }
            }
        });
    }


    private updateAnimation = () => {
        if (!this.running) return;

        this.animationId = requestAnimationFrame(this.updateAnimation);
    };

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {
        this.running = isRunning;
        if (isRunning && this.animationId === null) {
            this.startTime = performance.now();
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
        this.trailMap.clear();
        this.source.clear();
    }
}
