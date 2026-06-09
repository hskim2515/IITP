import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString } from "ol/geom";
import { Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { Map as OLMap } from "ol";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useVisualLayerSettingStore } from "@stores/useVisualLayerSettingStore";
import { Link } from "@type/Network";

const GLOW_WIDTH = 18;
const CORE_WIDTH = 6;
const SCAN_WIDTH = 2.4;
const SUB_SCAN_WIDTH = 1.2;
const FLOW_SPEED = 64;
const SUB_FLOW_SPEED = 28;
const DASH_LEN = 18;
const GAP_LEN = 52;
const PERIOD = DASH_LEN + GAP_LEN;
const CHEVRON_SPACING = 92;
const CHEVRON_SIZE = 7;

function hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    return [
        parseInt(normalized.slice(1, 3), 16),
        parseInt(normalized.slice(3, 5), 16),
        parseInt(normalized.slice(5, 7), 16),
    ];
}

function getPathLength(pixels: number[][]): number {
    let total = 0;
    for (let i = 0; i < pixels.length - 1; i++) {
        const ax = pixels[i]![0]!, ay = pixels[i]![1]!;
        const bx = pixels[i + 1]![0]!, by = pixels[i + 1]![1]!;
        total += Math.hypot(bx - ax, by - ay);
    }
    return total;
}

function walkPath(
    pixels: number[][],
    phase: number,
    spacing: number,
    cb: (x: number, y: number, angle: number) => void,
): void {
    let walked = 0;
    let nextDist = phase;

    for (let i = 0; i < pixels.length - 1; i++) {
        const ax = pixels[i]![0]!, ay = pixels[i]![1]!;
        const bx = pixels[i + 1]![0]!, by = pixels[i + 1]![1]!;
        const dx = bx - ax;
        const dy = by - ay;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;
        const angle = Math.atan2(dy, dx);

        while (nextDist <= walked + segLen) {
            const t = (nextDist - walked) / segLen;
            cb(ax + dx * t, ay + dy * t, angle);
            nextDist += spacing;
        }
        walked += segLen;
    }
}

function drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    strokeStyle: string,
    lineWidth: number,
): void {
    const s = CHEVRON_SIZE;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s * 0.55);
    ctx.lineTo(s * 0.42, 0);
    ctx.lineTo(-s * 0.6, s * 0.55);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
}

export default class GuidewayFeatureLayer extends VectorLayer<VectorSource> {
    private readonly _source: VectorSource;
    private readonly _map: OLMap | null;
    private _color = useVisualLayerSettingStore.getState().guidewayColor;
    private _settingsUnsubscribe: (() => void) | null = null;

    constructor(map?: OLMap) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 520,
            style: (feature) => this._styleForFeature(feature as Feature<LineString>),
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this._source = source;
        this._map = map ?? null;
        this._buildFromStore();

        this._settingsUnsubscribe = (useVisualLayerSettingStore as any).subscribe(
            (s: any) => [s.guidewayColor],
            ([color]: [string]) => {
                this.setGuidewayColor(color);
            },
        );

        this.on("postrender", this._onPostRender);
    }

    private _buildFromStore(): void {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;

        const features: Feature<LineString>[] = [];

        for (const link of network.links as Link[]) {
            if (!link.coordinates || link.coordinates.length < 2) continue;
            const coords = link.coordinates.map((c) => fromLonLat([c.lng, c.lat]));
            const feature = new Feature<LineString>(new LineString(coords));
            feature.setId(`guideway-${link.id}`);
            feature.set("linkId", link.id);
            features.push(feature);
        }

        this._source.clear();
        this._source.addFeatures(features);
    }

    private _styleForFeature(_feature: Feature<LineString>): Style {
        return new Style({
            renderer: (pixelCoordinates: any, state: any) => {
                const pixels = Array.isArray(pixelCoordinates?.[0]?.[0])
                    ? pixelCoordinates[0] as number[][]
                    : pixelCoordinates as number[][];
                if (!Array.isArray(pixels) || pixels.length < 2) return;

                const ctx = state.context as CanvasRenderingContext2D | undefined;
                if (!ctx || typeof ctx.setLineDash !== "function") return;

                const [r, g, b] = hexToRgb(this._color);
                const now = Date.now();
                const phase = -((now * FLOW_SPEED) / 1000) % PERIOD;
                const subPhase = -((now * SUB_FLOW_SPEED) / 1000) % PERIOD;
                const pulse = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(now * 0.0018));
                const shimmer = 0.92 + 0.08 * (0.5 + 0.5 * Math.sin(now * 0.0032));
                const zoom = state.resolution && this._map
                    ? (this._map.getView().getZoom() ?? 0)
                    : (this._map?.getView().getZoom() ?? 0);
                const zoomFade = Math.max(0.2, Math.min(1, (zoom - 11) / 5));
                const farFade = 0.35 + zoomFade * 0.65;
                const widthScale = 0.72 + zoomFade * 0.28;
                const totalLength = getPathLength(pixels);
                if (totalLength < 12) return;

                ctx.save();
                ctx.globalCompositeOperation = "screen";

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                ctx.strokeStyle = `rgba(${r},${g},${b},${(0.08 + pulse * 0.05) * farFade})`;
                ctx.lineWidth = GLOW_WIDTH * widthScale;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.setLineDash([]);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                ctx.strokeStyle = `rgba(${r},${g},${b},${(0.18 + pulse * 0.08) * farFade})`;
                ctx.lineWidth = CORE_WIDTH * widthScale;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                ctx.strokeStyle = `rgba(255,255,255,${(0.12 + shimmer * 0.07) * farFade})`;
                ctx.lineWidth = Math.max(0.8, 1.1 * widthScale);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                ctx.strokeStyle = `rgba(${r},${g},${b},${(0.30 + pulse * 0.08) * farFade})`;
                ctx.lineWidth = SCAN_WIDTH * widthScale;
                ctx.setLineDash([DASH_LEN, GAP_LEN]);
                ctx.lineDashOffset = phase;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(pixels[0]![0]!, pixels[0]![1]!);
                for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i]![0]!, pixels[i]![1]!);
                ctx.strokeStyle = `rgba(255,255,255,${(0.08 + shimmer * 0.04) * farFade})`;
                ctx.lineWidth = Math.max(0.8, SUB_SCAN_WIDTH * widthScale);
                ctx.setLineDash([8, 74]);
                ctx.lineDashOffset = subPhase;
                ctx.stroke();

                if (zoom >= 14 && totalLength >= CHEVRON_SPACING * 0.7) {
                    ctx.setLineDash([]);
                    const chevronPhase = ((now * 0.045) % CHEVRON_SPACING);
                    walkPath(pixels, chevronPhase, CHEVRON_SPACING, (x, y, angle) => {
                        drawChevron(ctx, x, y, angle, `rgba(255,255,255,${(0.10 + shimmer * 0.06) * farFade})`, 1.1);
                        drawChevron(ctx, x, y, angle, `rgba(${r},${g},${b},${(0.18 + pulse * 0.06) * farFade})`, 2.1);
                    });
                }

                ctx.restore();
            },
        });
    }

    private readonly _onPostRender = (event: any): void => {
        if (this.getVisible()) this._map?.render();
    };

    setGuidewayColor(hex: string) {
        this._color = hex;
        if (this.getVisible()) this._map?.render();
    }

    public destroy() {
        this._settingsUnsubscribe?.();
        this.un("postrender", this._onPostRender);
        this._source.clear();
    }
}
