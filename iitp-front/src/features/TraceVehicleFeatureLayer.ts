import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { MultiPoint } from "ol/geom";
import { Style } from "ol/style";
import { Map as OLMap } from "ol";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useVisualLayerSettingStore } from "@stores/useVisualLayerSettingStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";

const TRAIL_LEN = 5;
const SPARK_SIZES = [5.4, 3.8, 2.5, 1.5, 0.75];

function hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    return [
        parseInt(normalized.slice(1, 3), 16),
        parseInt(normalized.slice(3, 5), 16),
        parseInt(normalized.slice(5, 7), 16),
    ];
}

type TrailColor = { fill: string; stroke: string; };

function buildTrailPalette(hex: string): TrailColor[] {
    const [r, g, b] = hexToRgb(hex);
    return [
        { fill: `rgba(${Math.min(r + 72, 255)},${Math.min(g + 72, 255)},${Math.min(b + 72, 255)},0.96)`, stroke: `rgba(${r},${g},${b},0.72)` },
        { fill: `rgba(${Math.min(r + 40, 255)},${Math.min(g + 40, 255)},${Math.min(b + 40, 255)},0.66)`, stroke: "rgba(255,255,255,0.24)" },
        { fill: `rgba(${r},${g},${b},0.38)`, stroke: "rgba(255,255,255,0.10)" },
        { fill: `rgba(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)},0.17)`, stroke: "rgba(0,0,0,0)" },
        { fill: `rgba(${Math.round(r * 0.25)},${Math.round(g * 0.25)},${Math.round(b * 0.25)},0.06)`, stroke: "rgba(0,0,0,0)" },
    ];
}

export default class TraceVehicleFeatureLayer extends VectorLayer<VectorSource> {
    private readonly _source: VectorSource;
    private readonly _map: OLMap | null;
    private _color = useVisualLayerSettingStore.getState().traceVehicleColor;
    private _trailPalette = buildTrailPalette(this._color);
    private _history: (number[] | null)[][] = [];
    private _features: Feature<MultiPoint>[] = [];
    private _settingsUnsubscribe: (() => void) | null = null;
    private _highlightType = useAnalysisSettingStore.getState().vehicle.highlightedType;

    constructor(map?: OLMap) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 980,
            style: (feature) => this._styleForFeature(feature as Feature<MultiPoint>),
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this._source = source;
        this._map = map ?? null;

        this._settingsUnsubscribe = (useVisualLayerSettingStore as any).subscribe(
            (s: any) => [s.traceVehicleColor],
            ([color]: [string]) => {
                this.setTraceVehicleColor(color);
            },
        );

        this.on("postrender", this._onPostRender);
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any,
                Ellipsoid.WGS84,
            );
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch {
            return null;
        }
    }

    private _styleForFeature(_feature: Feature<MultiPoint>): Style {
        return new Style({
            renderer: (pixelCoordinates: any, state: any) => {
                const points = Array.isArray(pixelCoordinates?.[0]?.[0])
                    ? pixelCoordinates[0] as number[][]
                    : pixelCoordinates as number[][];
                if (!Array.isArray(points) || points.length === 0) return;

                const ctx = state.context as CanvasRenderingContext2D | undefined;
                if (!ctx) return;

                const zoom = this._map?.getView().getZoom() ?? 0;
                const zoomFade = Math.max(0.28, Math.min(1, (zoom - 11) / 5));
                const pulse = 0.92 + 0.08 * (0.5 + 0.5 * Math.sin(Date.now() * 0.004));

                ctx.save();
                ctx.globalCompositeOperation = "screen";

                for (let t = Math.min(points.length, TRAIL_LEN) - 1; t >= 0; t--) {
                    const point = points[t];
                    if (!point) continue;
                    const x = point[0]!;
                    const y = point[1]!;
                    const palette = this._trailPalette[t]!;
                    const radius = (SPARK_SIZES[t] ?? 2) * (0.7 + zoomFade * 0.3) * (t === 0 ? pulse : 1);

                    ctx.beginPath();
                    ctx.fillStyle = palette.fill;
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();

                    if (t <= 1) {
                        ctx.beginPath();
                        ctx.strokeStyle = palette.stroke;
                        ctx.lineWidth = t === 0 ? 1.0 : 0.5;
                        ctx.arc(x, y, radius + (t === 0 ? 0.55 : 0.28), 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }

                ctx.restore();
            },
        });
    }

    private readonly _onPostRender = (event: any): void => {
        if (this.getVisible()) this._map?.render();
    };

    public setLatestPositions(data: { positions: (number[] | null)[]; types?: string[] }) {
        if (!this.getVisible()) return;
        const positions = data?.positions ?? [];
        const types = data?.types ?? [];
        while (this._history.length < positions.length) {
            this._history.push(new Array(TRAIL_LEN).fill(null));
        }
        while (this._features.length < positions.length) {
            const feature = new Feature<MultiPoint>(new MultiPoint([]));
            feature.setId(`trace-vehicle-${this._features.length}`);
            this._features.push(feature);
            this._source.addFeature(feature);
        }

        for (let i = 0; i < positions.length; i++) {
            const hist = this._history[i]!;
            for (let t = TRAIL_LEN - 1; t > 0; t--) {
                hist[t] = hist[t - 1] ?? null;
            }
            const pos = positions[i];
            const type = types[i] ?? 'default';
            const visible = this._highlightType === 'ALL' || this._highlightType === type;
            hist[0] = pos && visible ? this._ecefToOl(pos) : null;

            const feature = this._features[i]!;
            const geometry = feature.getGeometry() as MultiPoint | undefined;
            const coords = hist.filter((p): p is number[] => !!p);
            if (geometry) {
                geometry.setCoordinates(coords);
            } else {
                feature.setGeometry(new MultiPoint(coords));
            }
        }

        for (let i = positions.length; i < this._history.length; i++) {
            const hist = this._history[i]!;
            for (let t = 0; t < TRAIL_LEN; t++) hist[t] = null;
            const feature = this._features[i];
            const geometry = feature?.getGeometry() as MultiPoint | undefined;
            geometry?.setCoordinates([]);
        }

        this._source.changed();
        if (this.getVisible()) this._map?.render();
    }

    public setTraceVehicleColor(hex: string) {
        this._color = hex;
        this._trailPalette = buildTrailPalette(hex);
        if (this.getVisible()) this._map?.render();
    }

    public setHighlightType(type: string) {
        this._highlightType = type;
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    public destroy() {
        this._settingsUnsubscribe?.();
        this.un("postrender", this._onPostRender);
        this._features = [];
        this._source.clear();
    }
}
