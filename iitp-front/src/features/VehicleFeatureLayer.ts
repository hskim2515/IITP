import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid } from "cesium";
import * as Cesium from "cesium";
import { buffer, containsXY, getHeight, getWidth, type Extent } from "ol/extent";
import { VEHICLE_CULLING } from "@utils/lodConstants";

const DEFAULT_VEHICLE_COLOR: [number, number, number] = [251, 188, 96];

function hexToRgb255(hex: string): [number, number, number] | null {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m || !m[1] || !m[2] || !m[3]) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export default class VehicleFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private features: Feature<Point>[] = [];
    private speed: number;
    private running: boolean;
    private animationId: number | null = null;
    private positions: (number[] | null)[] = [];
    private prevPositions: (number[] | null)[] = [];
    private lerpStartTime: number = 0;
    private readonly LERP_DURATION = 50;
    public readonly vehicleType: string;

    // viewport culling: 화면 밖 차량은 좌표 업데이트/렌더 건너뜀 (VEHICLE_CULLING.ENABLED)
    private cullExtent: Extent | null = null;
    private cullExtentAt = 0;
    private hiddenIdx: Set<number> = new Set();

    constructor(vehicleRoute: any[], vectorSource: VectorSource, speed: number, running: boolean, vehicleType: string = 'default', modelColor?: string) {
        const [r, g, b] = (modelColor ? hexToRgb255(modelColor) : null) ?? DEFAULT_VEHICLE_COLOR;

        super({
            source: vectorSource,
            visible: false,
            style: {
                "circle-radius": ["var", "pointRadius"],
                "circle-fill-color": ["color", r, g, b, ["var", "pointOpacity"]],
                "circle-stroke-color": "rgba(0,0,0,0.5)",
                "circle-stroke-width": 1,
            },
            variables: { pointRadius: 4, pointOpacity: 0.9 },
            zIndex: 550,
            disableHitDetection: true,
        });

        this.vehicleType = vehicleType;
        this.source = vectorSource;
        this.speed = speed;
        this.running = running;

        this.createResources(vehicleRoute);

        if (running) this.start();
    }

    private convertToEPSG3857(position: number[]): number[] {
        try {
            const carto = Cartographic.fromCartesian(
                { x: position[0], y: position[1], z: position[2] } as any,
                Ellipsoid.WGS84,
            );
            return fromLonLat([
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude),
            ]);
        } catch {
            return fromLonLat([0, 0]);
        }
    }

    private createResources(vehicleRoute: any[]) {
        this.features = vehicleRoute.map((route, idx) => {
            let initialPosition: number[] = [0, 0, 0];
            for (let i = 0; i < route.length; i += 4) {
                if (route[i] === 0) {
                    initialPosition = [route[i + 1], route[i + 2], route[i + 3]];
                    break;
                }
            }

            const coord = this.convertToEPSG3857(initialPosition);
            const feature = new Feature<Point>({ geometry: new Point(coord) });
            feature.setId(`vehicle${idx}`);
            this.source.addFeature(feature);
            return feature;
        });
    }

    setLatestPositions(latestPositions: { positions: (number[] | undefined)[]; headings?: (number | null)[] }) {
        // 화면 밖 차량은 좌표 변환(convertToEPSG3857: 측지 연산, 1000대면 16ms) 자체를 스킵 →
        // 줌인 시 화면 내 소수만 변환. 이전 3857 위치로 화면 판정(margin 포함 cullExtent).
        this.refreshCullExtent();
        const converted = latestPositions.positions.map((pos, idx) => {
            // ⚠️ 예전엔 위치가 없으면(gap 등) 마지막 위치를 그대로 유지했는데, 3D(Cesium
            // VehiclePrimitive)는 같은 프레임에 그 차량을 압축 배열에서 아예 빼버려(=그 프레임엔
            // 안 그림) 서로 다르게 동작했다 — 2D는 옛 위치에 얼어붙어 계속 보이거나, 그 얼어붙은
            // 위치가 하필 그 시점에 culling(화면 밖 판정)에 걸리면 이후 갱신도 안 와서 영영 안
            // 보이는 상태로 남았다("사라진 차량" 원인). 이제 3D와 동일하게 위치 없음=이번 프레임
            // 렌더 제외로 통일한다 — 실제 위치가 다시 오면 자연히 복구된다.
            if (!pos) return null;
            const prev = this.positions[idx];
            if (prev && this.isCulled(prev)) return prev; // 화면 밖: 변환 생략, 이전 위치 유지
            try {
                return this.convertToEPSG3857(pos);
            } catch {
                return prev ?? null;
            }
        });

        this.prevPositions = this.positions.length > 0 ? this.positions : converted;
        this.positions = converted;
        this.lerpStartTime = performance.now();

        if (!this.running) {
            this._syncFeatures();
        } else if (this.animationId === null && this.positions.length > 0) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        }
    }

    /** 현재 viewport extent(+margin) 갱신. 비활성/맵없음 시 null → culling 안 함 */
    private refreshCullExtent(): void {
        if (!VEHICLE_CULLING.ENABLED) { this.cullExtent = null; return; }
        const now = performance.now();
        if (now - this.cullExtentAt < 250 && this.cullExtent) return; // 짧은 throttle
        this.cullExtentAt = now;
        const map = this.getMapInternal();
        const size = map?.getSize();
        const view = map?.getView();
        if (!map || !size || !view) { this.cullExtent = null; return; }
        const raw = view.calculateExtent(size);
        const margin = Math.max(getWidth(raw), getHeight(raw)) * VEHICLE_CULLING.MARGIN_RATIO;
        this.cullExtent = buffer(raw, margin);
    }

    /** target 좌표가 viewport 밖이면 true (culling 대상). extent 없으면 항상 false */
    private isCulled(target: number[]): boolean {
        if (!this.cullExtent) return false;
        return !containsXY(this.cullExtent, target[0]!, target[1]!);
    }

    private _syncFeatures() {
        this.refreshCullExtent();
        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            if (!geom) return;
            const target = this.positions[index];
            // 이번 프레임에 위치가 없으면(gap 등) 3D와 동일하게 숨긴다 — 옛 좌표에 그대로
            // 두면 얼어붙은 채 계속 보이거나, 하필 그 좌표가 culling 판정을 받은 뒤로는
            // 다시는 안 보이는 상태로 남을 수 있다(setLatestPositions 주석 참고).
            if (!target) { this.hideFeature(feature, index); return; }
            if (this.applyCull(feature, index, target)) return;
            geom.setCoordinates(target);
        });
    }

    /** 빈 좌표로 설정해 렌더에서 제외 (culling·위치 없음 공용) */
    private hideFeature(feature: Feature<Point>, index: number): void {
        if (!this.hiddenIdx.has(index)) {
            (feature.getGeometry() as Point)?.setCoordinates([]);
            this.hiddenIdx.add(index);
        }
    }

    /** culling 적용: 화면 밖이면 feature 숨김(빈 geometry) 후 true. 화면 안이면 복원 후 false */
    private applyCull(feature: Feature<Point>, index: number, target: number[]): boolean {
        if (!this.cullExtent) {
            if (this.hiddenIdx.size > 0) this.hiddenIdx.clear();
            return false;
        }
        if (this.isCulled(target)) {
            this.hideFeature(feature, index);
            return true;
        }
        if (this.hiddenIdx.has(index)) this.hiddenIdx.delete(index);
        return false;
    }

    private updateAnimation = () => {
        const t = Math.min((performance.now() - this.lerpStartTime) / this.LERP_DURATION, 1.0);
        this.refreshCullExtent();

        this.features.forEach((feature, index) => {
            const geom = feature.getGeometry() as Point;
            if (!geom) return;
            const target = this.positions[index];
            if (!target) { this.hideFeature(feature, index); return; }
            if (this.applyCull(feature, index, target)) return;

            const prev = this.prevPositions[index];
            if (prev && t < 1.0) {
                const dx = target[0]! - prev[0]!;
                const dy = target[1]! - prev[1]!;
                if (dx * dx + dy * dy > 1e10) {
                    geom.setCoordinates(target);
                } else {
                    geom.setCoordinates([prev[0]! + dx * t, prev[1]! + dy * t]);
                }
            } else {
                geom.setCoordinates(target);
            }
        });

        // 보간이 완료(t>=1.0)되면 다음 위치가 도착(setLatestPositions)할 때까지 루프를 멈춘다.
        // 같은 좌표를 매 프레임 재설정/재렌더하던 idle 스핀을 제거 (양쪽 지도 공통 절감).
        if (this.running && t < 1.0) {
            this.animationId = requestAnimationFrame(this.updateAnimation);
        } else {
            this.animationId = null;
        }
    };

    setPointStyle(radius: number, opacity: number) {
        this.updateStyleVariables({ pointRadius: radius, pointOpacity: opacity });
    }

    setSpeed(speed: number) { this.speed = speed; }
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
    stop()  { this.setStatus(false); }

    destroy() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.source.clear();
        this.running = false;
    }
}
