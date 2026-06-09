import * as Cesium from "cesium";
import { useVisualLayerSettingStore } from "@stores/useVisualLayerSettingStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";

const TRAIL_LEN = 5;
const SPARK_SIZES = [11, 7.5, 5, 3, 1.5];
const SPARK_OUTLINE_W = [4, 2, 1, 0, 0];

function mixColor(a: Cesium.Color, b: Cesium.Color, t: number): Cesium.Color {
    return new Cesium.Color(
        a.red * (1 - t) + b.red * t,
        a.green * (1 - t) + b.green * t,
        a.blue * (1 - t) + b.blue * t,
        a.alpha * (1 - t) + b.alpha * t,
    );
}

function buildTrailColors(hex: string): Cesium.Color[] {
    const base = Cesium.Color.fromCssColorString(hex);
    const light = new Cesium.Color(
        Math.min(base.red * 1.3 + 0.3, 1),
        Math.min(base.green * 1.3 + 0.3, 1),
        Math.min(base.blue * 1.3 + 0.3, 1),
    );
    const head = mixColor(light, base, 0.35);
    const dark = new Cesium.Color(base.red * 0.4, base.green * 0.4, base.blue * 0.4);
    const vdark = new Cesium.Color(base.red * 0.1, base.green * 0.1, base.blue * 0.1);
    return [
        head.withAlpha(0.98),
        light.withAlpha(0.72),
        base.withAlpha(0.42),
        dark.withAlpha(0.18),
        vdark.withAlpha(0.06),
    ];
}

const SCALE_BY_DIST = new Cesium.NearFarScalar(150, 1.5, 6000, 0.3);

export default class TraceVehicleCesiumLayer {
    layer = "";
    layerGroup = "";
    destroyed = false;

    private _show = false;
    private _baseColor: string;
    private _trailColors: Cesium.Color[];
    private _scene: Cesium.Scene;
    private _pc: Cesium.PointPrimitiveCollection;
    private _history: (Cesium.Cartesian3 | null)[][] = [];
    private _points: (Cesium.PointPrimitive | null)[][] = [];
    private _highlightType = useAnalysisSettingStore.getState().vehicle.highlightedType;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        this._pc.show = val;
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._baseColor = useVisualLayerSettingStore.getState().traceVehicleColor;
        this._trailColors = buildTrailColors(this._baseColor);
        this._pc = new Cesium.PointPrimitiveCollection();
        this._pc.show = false;
        this._scene.primitives.add(this._pc);
    }

    setLatestPositions(data: { positions: (number[] | null)[]; types?: string[] }) {
        if (this.destroyed) return;
        if (!this._show) return;
        const positions = data.positions;
        const types = data.types ?? [];
        const count = positions.length;

        while (this._history.length < count) {
            this._history.push(new Array(TRAIL_LEN).fill(null));
        }
        while (this._points.length < count) {
            this._points.push([]);
        }

        for (let i = 0; i < count; i++) {
            const hist = this._history[i]!;
            for (let t = TRAIL_LEN - 1; t > 0; t--) {
                hist[t] = hist[t - 1] ?? null;
            }
            const p = positions[i];
            const type = types[i] ?? 'default';
            const visible = this._highlightType === 'ALL' || this._highlightType === type;
            hist[0] = p && visible ? new Cesium.Cartesian3(p[0], p[1], p[2]) : null;
        }

        this._syncPoints(count);
    }

    private _syncPoints(count: number) {
        for (let i = 0; i < count; i++) {
            const pts = this._points[i]!;
            const hist = this._history[i]!;

            while (pts.length < TRAIL_LEN) {
                const slot = pts.length;
                const outlineC = slot === 0
                    ? this._trailColors[1]!.withAlpha(0.8)
                    : Cesium.Color.TRANSPARENT;
                pts.push(this._pc.add({
                    position: Cesium.Cartesian3.ZERO,
                    color: Cesium.Color.TRANSPARENT,
                    pixelSize: 0,
                    show: false,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: SCALE_BY_DIST,
                    outlineColor: outlineC,
                    outlineWidth: SPARK_OUTLINE_W[slot] ?? 0,
                }));
            }

            for (let t = 0; t < TRAIL_LEN; t++) {
                const pos = hist[t];
                const pt = pts[t]!;

                if (!pos) {
                    pt.show = false;
                    continue;
                }

                pt.show = this._show;
                pt.position = pos;
                pt.color = this._trailColors[t]!;
                if (t === 0) pt.outlineColor = this._trailColors[1]!.withAlpha(0.8);
                pt.pixelSize = SPARK_SIZES[t]!;
            }
        }

        for (let i = count; i < this._points.length; i++) {
            for (const pt of this._points[i]!) {
                if (pt) pt.show = false;
            }
        }
    }

    setTraceVehicleColor(hex: string) {
        this._baseColor = hex;
        this._trailColors = buildTrailColors(hex);
        const outlineC = Cesium.Color.fromCssColorString(hex).withAlpha(0.55);
        for (let i = 0; i < this._points.length; i++) {
            const pts = this._points[i]!;
            for (let t = 0; t < pts.length; t++) {
                const pt = pts[t];
                if (!pt) continue;
                pt.color = pt.show ? this._trailColors[t]! : Cesium.Color.TRANSPARENT;
                if (t === 0) pt.outlineColor = outlineC;
            }
        }
    }

    setHighlightType(type: string) {
        this._highlightType = type;
    }

    update(_frameState: any) {}
    setSpeed(_v: number) {}
    setStatus(_s: any) {}

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (!this._pc.isDestroyed()) {
            this._scene.primitives.remove(this._pc);
        }
    }
}
