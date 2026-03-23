import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature, Map as OLMap } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";

const TYPE_COLORS: Record<string, string> = {
    'CAR':     'rgba(100, 160, 255, 0.92)',
    'TAXI':    'rgba(255, 220, 0,   0.92)',
    'BUS':     'rgba(255, 90,  90,  0.92)',
    'TRUCK':   'rgba(180, 120, 60,  0.92)',
    'MOTO':    'rgba(80,  220, 130, 0.92)',
    'default': 'rgba(251, 188, 96,  0.92)',
};

const TYPE_SIZE: Record<string, { len: number; wid: number }> = {
    'CAR':     { len: 4.5, wid: 1.8 },
    'TAXI':    { len: 4.5, wid: 1.8 },
    'BUS':     { len: 12,  wid: 2.5 },
    'TRUCK':   { len: 8,   wid: 2.5 },
    'MOTO':    { len: 2.2, wid: 0.8 },
    'default': { len: 4.5, wid: 1.8 },
};

/**
 * canvas로 둥근 직사각형 data URL 생성 (생성자에서 차종당 1회만 호출).
 * height = len (길이 방향 = OL 아이콘 기본 방향 위쪽), width = wid.
 */
function createVehicleDataUrl(lenPx: number, widPx: number, color: string): string {
    const canvas = document.createElement('canvas');
    canvas.width  = widPx;
    canvas.height = lenPx;
    const ctx = canvas.getContext('2d')!;
    const r = Math.min(widPx, lenPx) * 0.28;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(0, 0, widPx, lenPx, r);
    ctx.fill();
    return canvas.toDataURL();
}

export default class VehicleFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    /** feature geometry 캐시 — getGeometry() 반복 호출 방지 */
    private geometries: Point[] = [];
    private running: boolean;
    private animationId: number | null = null;
    private positions: number[][] = [];
    private headings: (number | null)[] = [];
    /** 새 위치가 도착했을 때만 true → rAF 프레임 스킵 */
    private dirty: boolean = false;
    private olMap: OLMap | null = null;
    public readonly vehicleType: string;

    constructor(
        vehicleRoute: any[],
        vectorSource: VectorSource,
        _speed: number,
        running: boolean,
        vehicleType: string = 'default',
    ) {
        const size  = TYPE_SIZE[vehicleType]  ?? TYPE_SIZE['default'];
        const color = TYPE_COLORS[vehicleType] ?? TYPE_COLORS['default'];

        // canvas 픽셀 종횡비 = 실세계 종횡비 (기준 길이 32px)
        const BASE_LEN = 32;
        const canvasWid = Math.round(BASE_LEN * (size.wid / size.len));
        const dataUrl   = createVehicleDataUrl(BASE_LEN, canvasWid, color);

        // icon-scale: 실세계 길이(m) / (canvas 픽셀 수 × 해상도(m/px))
        // clamp으로 최소·최대 화면 크기 제한
        const iconScale = ["clamp",
            ["/", size.len / 2, ["*", BASE_LEN / 2, ["resolution"]]],
            0.25, 5.0,
        ] as any;

        // resolution > 4 m/px(≈zoom 15 이하)에서 페이드아웃 → 완전 투명
        const iconOpacity = ["interpolate", ["linear"], ["resolution"],
            3, 1,
            5, 0,
        ] as any;

        super({
            source: vectorSource,
            visible: false,
            style: {
                "icon-src":              dataUrl,
                "icon-rotation":         ["get", "heading"] as any,
                "icon-rotate-with-view": false,
                "icon-anchor":           [0.5, 0.5],
                "icon-anchor-x-units":   "fraction",
                "icon-anchor-y-units":   "fraction",
                "icon-scale":            iconScale,
                "icon-opacity":          iconOpacity,
            },
            zIndex: 110,
            disableHitDetection: true,
        });

        this.vehicleType = vehicleType;
        this.source   = vectorSource;
        this.running  = running;

        this.createFeatures(vehicleRoute);

        if (vehicleRoute.length > 0) {
            const initPos = vehicleRoute.map(route => route[0]);
            this.setLatestPositions({ positions: initPos, headings: [] });
        }

        if (running) this.start();
    }

    private createFeatures(vehicleRoute: any[]) {
        this.features = vehicleRoute.map((route, idx) => {
            let initPos: number[] = [0, 0, 0];
            for (let i = 0; i < route.length; i += 4) {
                if (route[i] === 0) { initPos = [route[i + 1], route[i + 2], route[i + 3]]; break; }
            }
            const coord = this.toEPSG3857(initPos);
            const geom = new Point(coord);
            const f = new Feature<Point>({ geometry: geom });
            f.setId(`vehicle-${this.vehicleType}-${idx}`);
            f.set('heading', 0);
            this.geometries[idx] = geom;
            this.source.addFeature(f);
            return f;
        });
    }

    private toEPSG3857(pos: number[]): number[] {
        if (!pos || pos.length < 3) return fromLonLat([0, 0]);
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any,
                Ellipsoid.WGS84,
            );
            if (!c) return fromLonLat([0, 0]);
            return fromLonLat([Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]);
        } catch { return fromLonLat([0, 0]); }
    }

    setLatestPositions(data: { positions: any[]; headings?: any[] }) {
        if (!this.running) return;

        const inHeadings = data.headings ?? [];

        data.positions.forEach((pos, idx) => {
            if (!pos) return;
            const xy = this.toEPSG3857(pos);
            const h  = (inHeadings[idx] != null ? inHeadings[idx] : this.headings[idx]) ?? 0;
            this.positions[idx] = xy;
            this.headings[idx]  = h as number;
        });

        this.dirty = true;
    }

    private updateAnimation = () => {
        if (this.dirty) {
            this.dirty = false;
            let changed = false;
            this.features.forEach((feature, i) => {
                const geom = this.geometries[i];
                const xy   = this.positions[i];
                const h    = this.headings[i] ?? 0;
                if (!geom || !xy) return;
                geom.flatCoordinates[0] = xy[0];
                geom.flatCoordinates[1] = xy[1];
                feature.set('heading', h, true);
                changed = true;
            });
            if (changed) {
                this.source.changed();
                // source.changed() 이후 명시적으로 render 요청 —
                // 드래그 중 OL이 이미 렌더 중이더라도 갱신된 버퍼를 즉시 반영
                this.olMap?.render();
            }
        }

        if (this.running) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else {
            this.animationId = null;
        }
    };

    override setMap(map: OLMap | null) {
        super.setMap(map);
        this.olMap = map;
    }

    setSpeed(_speed: number) {}

    setStatus(isRunning: boolean) {
        this.running = isRunning;
        if (isRunning && this.animationId === null) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else if (!isRunning && this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    start() { this.setStatus(true); }

    stop() {
        this.setStatus(false);
        // 정지 시 피처를 화면 밖으로 이동 — 이전 위치가 다음 재생 전까지 남지 않도록
        this.positions = [];
        this.headings  = [];
        this.geometries.forEach(geom => {
            if (!geom) return;
            geom.flatCoordinates[0] = 0;
            geom.flatCoordinates[1] = 0;
        });
        this.source.changed();
    }
    destroy() {
        this.stop();
        this.source.clear();
    }
}