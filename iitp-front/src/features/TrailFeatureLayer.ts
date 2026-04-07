import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";

const MAX_TRAIL_LENGTH = 80;

/** VehicleFeatureLayer 의 TYPE_COLORS 와 동일한 값 유지 */
const TYPE_COLORS: Record<string, [number, number, number, number]> = {
    'CAR':     [100, 160, 255, 0.92],
    'TAXI':    [255, 220,   0, 0.92],
    'BUS':     [255,  90,  90, 0.92],
    'TRUCK':   [180, 120,  60, 0.92],
    'MOTO':    [ 80, 220, 130, 0.92],
    'default': [251, 188,  96, 0.92],
};

function buildTrailStyle(vehicleType: string) {
    const [r, g, b, a] = TYPE_COLORS[vehicleType] ?? TYPE_COLORS['default'];
    return {
        "stroke-color": [
            "interpolate", ["linear"], ["line-metric"],
            0.0, [r, g, b, 0],
            0.5, [r, g, b, +(a * 0.5).toFixed(2)],
            1.0, [r, g, b, a],
        ],
        "stroke-width": [
            "interpolate", ["linear"], ["line-metric"],
            0.0, 0,
            1.0, 3,
        ],
    };
}

type Cartesian3Like = { x: number; y: number; z: number };
type PositionData =
    | { positions: Array<Cartesian3Like | null> }
    | Array<Cartesian3Like | number[] | null | undefined>;

export default class TrailFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private running: boolean;
    private speed: number;
    public readonly vehicleType: string;
    /** sparse positions 배열(원본 인덱스 보존)이 필요함을 dispatch 측에 알림 */
    public readonly sparsePositions = true;

    /** vehicle index → accumulated EPSG:3857 [x, y] coords (sliding window) */
    private trails = new Map<number, number[][]>();
    /** vehicle index → OL Feature */
    private trailFeatures = new Map<number, Feature<LineString>>();
    /** 진행 중인 drain rAF ID — start() 시 취소용 */
    private drainRafId: number | null = null;

    constructor(vehicleRoute: number[][][], speed: number, running: boolean, vehicleType = 'default') {
        const source = new VectorSource();
        const style  = buildTrailStyle(vehicleType);

        const isVisible = useLayerStore.getState().activeLayerName?.includes("trip") ?? false;

        super({
            source,
            style,
            visible: isVisible,
            zIndex: 500,
            disableHitDetection: true,
        });

        this.source = source;
        this.running = running;
        this.speed = speed;
        this.vehicleType = vehicleType;

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
            if (!pos) {
                // 해당 vehicle이 멈춘 경우: worker tick마다 꼬리 한 점 제거 (자연 drain)
                const trail = this.trails.get(idx);
                if (!trail || trail.length === 0) return;
                trail.shift();
                if (trail.length >= 2) {
                    const n = trail.length;
                    const xymCoords = trail.map((coord, i) => [coord[0]!, coord[1]!, i / (n - 1)]);
                    this.trailFeatures.get(idx)?.getGeometry()?.setCoordinates(xymCoords, "XYM");
                } else {
                    const f = this.trailFeatures.get(idx);
                    if (f) {
                        this.source.removeFeature(f);
                        this.trailFeatures.delete(idx);
                    }
                    this.trails.delete(idx);
                }
                return;
            }

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
        // 진행 중인 drain 애니메이션 취소 — drain과 새 위치 데이터 충돌 방지
        if (this.drainRafId !== null) {
            cancelAnimationFrame(this.drainRafId);
            this.drainRafId = null;
        }
        // 이전 trail 데이터 완전 초기화 — 종료 위치에서 새 시작 위치로의 점프 방지
        this.trails.clear();
        this.trailFeatures.clear();
        this.source.clear();
        this.setStatus(true);
    }

    public stop() {
        this.setStatus(false);
        if (this.drainRafId !== null) {
            cancelAnimationFrame(this.drainRafId);
            this.drainRafId = null;
        }
        this.trails.clear();
        this.trailFeatures.clear();
        this.source.clear();
    }

    /**
     * 자연 종료 시 trail을 시간 순서대로 앞쪽(꼬리)부터 순차 제거.
     * TailPrimitive의 원형 버퍼 count 감소 방식과 동일한 50ms 간격.
     */
    public drain() {
        this.setStatus(false);
        const DRAIN_INTERVAL = 50;
        let last = performance.now();

        const step = () => {
            // start()가 호출되어 drainRafId가 null이 됐으면 즉시 중단
            if (this.drainRafId === null) return;

            const now = performance.now();
            if (now - last < DRAIN_INTERVAL) {
                this.drainRafId = requestAnimationFrame(step);
                return;
            }
            last = now;

            let anyLeft = false;
            this.trails.forEach((trail, idx) => {
                if (trail.length === 0) return;
                trail.shift(); // 가장 오래된 점(꼬리) 제거
                anyLeft = true;

                if (trail.length >= 2) {
                    const n = trail.length;
                    const xymCoords = trail.map((coord, i) =>
                        [coord[0]!, coord[1]!, i / (n - 1)]
                    );
                    this.trailFeatures.get(idx)?.getGeometry()
                        ?.setCoordinates(xymCoords, 'XYM');
                } else {
                    const f = this.trailFeatures.get(idx);
                    if (f) {
                        this.source.removeFeature(f);
                        this.trailFeatures.delete(idx);
                    }
                    trail.length = 0;
                }
            });
            this.source.changed();

            if (anyLeft) {
                this.drainRafId = requestAnimationFrame(step);
            } else {
                this.drainRafId = null;
                this.trails.clear();
                this.trailFeatures.clear();
            }
        };

        this.drainRafId = requestAnimationFrame(step);
    }

    public destroy() {
        this.stop();
    }
}