import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";

/** 보관할 최대 위치 점 수 */
const TRAIL_LENGTH = 80;

/**
 * 연속 tick 간 허용 최대 이동 거리² (EPSG:3857 ≈ 미터).
 * 이 거리 이상이면 차량이 순간이동(시뮬 재시작 등)한 것으로 보고 trail을 초기화한다.
 * 일반 차량: 100 km/h × speed=50 × 0.05s = 70m → 10 000m 이면 충분히 안전.
 */
const MAX_JUMP_SQ = 10_000 * 10_000;

/** VehicleFeatureLayer / TailPrimitive 와 동일한 색상 */
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
    public readonly vehicleType: string;
    public readonly sparsePositions = true;

    /** vehicle index → EPSG:3857 [x, y] 좌표 배열 (sliding window) */
    private trails = new Map<number, number[][]>();
    /** vehicle index → OL Feature */
    private trailFeatures = new Map<number, Feature<LineString>>();
    /** 직전 tick에서 null 이었던 인덱스 — 재활성 시 이전 trail 제거용 */
    private prevNullSet = new Set<number>();

    constructor(_vehicleRoute: number[][][], _speed: number, running: boolean, vehicleType = 'default') {
        const source = new VectorSource();
        super({
            source,
            style: buildTrailStyle(vehicleType),
            visible: useLayerStore.getState().activeLayerName?.includes("trip") ?? false,
            zIndex: 500,
            disableHitDetection: true,
        });
        this.source = source;
        this.running = running;
        this.vehicleType = vehicleType;
        if (running) this.start();
    }

    // ── 좌표 변환 ──────────────────────────────────────────────────
    private toEPSG3857(pos: Cartesian3Like | number[]): number[] | null {
        try {
            const c = Array.isArray(pos)
                ? new Cartesian3(pos[0], pos[1], pos[2])
                : new Cartesian3(pos.x, pos.y, pos.z);
            const carto = Cartographic.fromCartesian(c, Ellipsoid.WGS84);
            if (!carto) return null;
            const lon = CesiumMath.toDegrees(carto.longitude);
            const lat = CesiumMath.toDegrees(carto.latitude);
            if (!isFinite(lon) || !isFinite(lat)) return null;
            return fromLonLat([lon, lat]);
        } catch {
            return null;
        }
    }

    // ── Feature 헬퍼 ──────────────────────────────────────────────
    private removeTrail(idx: number): void {
        const f = this.trailFeatures.get(idx);
        if (f) {
            this.source.removeFeature(f);
            this.trailFeatures.delete(idx);
        }
        this.trails.delete(idx);
    }

    private updateOrCreate(idx: number, trail: number[][]): void {
        const n = trail.length;
        const xymCoords = trail.map((coord, i) => [coord[0]!, coord[1]!, i / (n - 1)]);
        if (this.trailFeatures.has(idx)) {
            this.trailFeatures.get(idx)!.getGeometry()!.setCoordinates(xymCoords, "XYM");
        } else {
            const feature = new Feature({ geometry: new LineString(xymCoords, "XYM") });
            this.trailFeatures.set(idx, feature);
            this.source.addFeature(feature);
        }
    }

    // ── 메인 업데이트 ─────────────────────────────────────────────
    public setLatestPositions(data: PositionData): void {
        if (!this.running) return;

        const positions: Array<Cartesian3Like | number[] | null | undefined> = Array.isArray(data)
            ? data
            : (data as { positions: Array<Cartesian3Like | null> }).positions;
        if (!positions) return;

        const nextNullSet = new Set<number>();

        positions.forEach((pos, idx) => {
            // ── null: 비활성 차량 → 꼬리 앞쪽부터 한 점씩 제거(fade-out)
            if (!pos) {
                nextNullSet.add(idx);
                const trail = this.trails.get(idx);
                if (!trail || trail.length === 0) return;
                trail.shift();
                if (trail.length >= 2) {
                    this.updateOrCreate(idx, trail);
                } else {
                    this.removeTrail(idx);
                }
                return;
            }

            // ── null → 활성 전환: 이전 trail 잔재 제거
            if (this.prevNullSet.has(idx)) {
                this.removeTrail(idx);
            }

            const xy = this.toEPSG3857(pos as Cartesian3Like | number[]);
            if (!xy) return;

            if (!this.trails.has(idx)) this.trails.set(idx, []);
            const trail = this.trails.get(idx)!;

            // 순간이동 감지(시뮬 재시작 등) → trail 초기화
            if (trail.length > 0) {
                const last = trail[trail.length - 1]!;
                const dx = xy[0]! - last[0]!;
                const dy = xy[1]! - last[1]!;
                if (dx * dx + dy * dy > MAX_JUMP_SQ) {
                    this.removeTrail(idx);
                    this.trails.set(idx, []);
                }
            }
            const currentTrail = this.trails.get(idx)!;

            currentTrail.push(xy);
            if (currentTrail.length > TRAIL_LENGTH) currentTrail.shift();
            if (currentTrail.length < 2) return;

            this.updateOrCreate(idx, currentTrail);
        });

        this.prevNullSet = nextNullSet;
    }

    // ── 상태 제어 ──────────────────────────────────────────────────
    public setSpeed(_speed: number): void { /* trail 길이는 고정 */ }
    public setStatus(isRunning: boolean): void { this.running = isRunning; }

    public start(): void {
        this.trails.clear();
        this.trailFeatures.forEach(f => this.source.removeFeature(f));
        this.trailFeatures.clear();
        this.prevNullSet.clear();
        this.running = true;
    }

    public stop(): void {
        this.running = false;
        this.trails.clear();
        this.trailFeatures.forEach(f => this.source.removeFeature(f));
        this.trailFeatures.clear();
        this.prevNullSet.clear();
    }

    public destroy(): void {
        this.stop();
    }
}
