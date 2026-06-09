import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

const NUM_PARTICLES = 760;
const MAX_AGE = 420;
const REBUILD_MIN_MS = 1200;
const MAX_EMA_SAT = 8.0;
const MIN_ACTIVE_EMA = 0.18;
const PARTICLE_ALTITUDE = 6;
const GLYPH_ALTITUDE = 6;
const WIND_TRAIL_TYPE = "VectorFieldWindTrailMaterial";
const SIDE_OFFSET_BANDS_M = [6.5, 10.5, 14.5];
const SIDE_OFFSET_JITTER_M = 1.8;
const SIDE_WAVE_AMPLITUDE_M = 1.4;
const SIDE_WAVE_LENGTH_M = 58;

type PathCoord = { lon: number; lat: number; };

type StreamPath = {
    linkId: number;
    coords: PathCoord[];
    cumulativeM: number[];
    totalLengthM: number;
    ema: number;
    vehicleCount: number;
};

type StreamParticle = {
    pathIndex: number;
    progressM: number;
    speedM: number;
    trailLengthM: number;
    sideBandM: number;
    sideOffsetM: number;
    wavePhase: number;
    waveAmpM: number;
    age: number;
    maxAge: number;
    polyline: Cesium.Polyline;
    material: Cesium.Material;
};

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpColor(a: Cesium.Color, b: Cesium.Color, t: number): Cesium.Color {
    return new Cesium.Color(
        lerp(a.red, b.red, t),
        lerp(a.green, b.green, t),
        lerp(a.blue, b.blue, t),
        lerp(a.alpha, b.alpha, t),
    );
}

function flowColor(ema: number, colors: Cesium.Color[]): Cesium.Color {
    const t = Math.min(ema / MAX_EMA_SAT, 1);
    const base = colors[0] ?? Cesium.Color.fromCssColorString("#2d7bff");
    const mid = colors[1] ?? Cesium.Color.fromCssColorString("#60cfff");
    const tip = colors[3] ?? Cesium.Color.fromCssColorString("#f5fdff");
    if (t < 0.58) return lerpColor(base, mid, t / 0.58);
    return lerpColor(mid, tip, (t - 0.58) / 0.42);
}

function meterDistance(a: PathCoord, b: PathCoord): number {
    const midLatRad = ((a.lat + b.lat) * 0.5 * Math.PI) / 180;
    const dx = (b.lon - a.lon) * 111320 * Math.cos(midLatRad);
    const dy = (b.lat - a.lat) * 111320;
    return Math.sqrt(dx * dx + dy * dy);
}

function buildCumulative(coords: PathCoord[]): number[] {
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += meterDistance(coords[i]!, coords[i + 1]!);
        cumulative.push(total);
    }
    return cumulative;
}

function sampleCoordAt(path: StreamPath, distM: number): PathCoord | null {
    if (path.coords.length < 2 || path.totalLengthM <= 0) return null;

    const clamped = Math.max(0, Math.min(path.totalLengthM, distM));
    for (let i = 0; i < path.cumulativeM.length - 1; i++) {
        const segStart = path.cumulativeM[i]!;
        const segEnd = path.cumulativeM[i + 1]!;
        if (clamped > segEnd && i < path.cumulativeM.length - 2) continue;

        const segLen = Math.max(segEnd - segStart, 1e-6);
        const t = Math.max(0, Math.min(1, (clamped - segStart) / segLen));
        const a = path.coords[i]!;
        const b = path.coords[i + 1]!;
        return {
            lon: lerp(a.lon, b.lon, t),
            lat: lerp(a.lat, b.lat, t),
        };
    }
    return path.coords[path.coords.length - 1] ?? null;
}

function buildPathSlice(path: StreamPath, startM: number, endM: number): PathCoord[] {
    if (path.coords.length < 2 || endM <= startM) return [];

    const points: PathCoord[] = [];
    const from = Math.max(0, Math.min(path.totalLengthM, startM));
    const to = Math.max(0, Math.min(path.totalLengthM, endM));
    if (to <= from) return [];

    const head = sampleCoordAt(path, from);
    if (head) points.push(head);

    for (let i = 1; i < path.cumulativeM.length - 1; i++) {
        const d = path.cumulativeM[i]!;
        if (d > from && d < to) {
            points.push(path.coords[i]!);
        }
    }

    const tail = sampleCoordAt(path, to);
    if (tail) {
        const last = points[points.length - 1];
        if (!last || last.lon !== tail.lon || last.lat !== tail.lat) {
            points.push(tail);
        }
    }

    return points;
}

function offsetCoordAlongPath(
    points: PathCoord[],
    index: number,
    sideOffsetM: number,
    wavePhase: number,
    waveAmpM: number,
    progressRatio: number,
): PathCoord {
    const base = points[index]!;
    const prev = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const dxM = meterDistance(
        { lon: prev.lon, lat: base.lat },
        { lon: next.lon, lat: base.lat },
    ) * Math.sign(next.lon - prev.lon);
    const dyM = meterDistance(
        { lon: base.lon, lat: prev.lat },
        { lon: base.lon, lat: next.lat },
    ) * Math.sign(next.lat - prev.lat);
    const len = Math.sqrt(dxM * dxM + dyM * dyM) || 1;
    const perpXM = -dyM / len;
    const perpYM = dxM / len;
    const metersToLon = 1 / (111320 * Math.cos((base.lat * Math.PI) / 180));
    const metersToLat = 1 / 111320;
    const waveOffsetM = Math.sin(progressRatio * Math.PI * 2 + wavePhase) * waveAmpM;
    const totalOffsetM = sideOffsetM + waveOffsetM;
    return {
        lon: base.lon + perpXM * totalOffsetM * metersToLon,
        lat: base.lat + perpYM * totalOffsetM * metersToLat,
    };
}

function ensureWindTrailMaterialRegistered() {
    const cache = (Cesium.Material as any)._materialCache;
    if (cache.getMaterial(WIND_TRAIL_TYPE)) return;

    cache.addMaterial(WIND_TRAIL_TYPE, {
        fabric: {
            type: WIND_TRAIL_TYPE,
            uniforms: {
                color: Cesium.Color.WHITE,
                speed: 0.22,
                alpha: 1.0,
            },
            source: `
czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);
    float s = materialInput.st.s;
    float t = materialInput.st.t;
    float time = float(czm_frameNumber) * 0.016;

    float body = 1.0 - smoothstep(0.10, 0.96, abs(t * 2.0 - 1.0));
    float drift = fract(s - time * speed);
    float head = smoothstep(0.0, 0.08, drift) * (1.0 - smoothstep(0.22, 0.46, drift));
    float tail = pow(max(1.0 - s, 0.0), 1.28);
    float intensity = body * (tail * 0.76 + head * 0.62);

    mat.diffuse = color.rgb * (0.24 + intensity * 0.72);
    mat.emission = color.rgb * intensity * 0.34;
    mat.alpha = intensity * color.a * alpha;
    return mat;
}`,
        },
        translucent: () => true,
    });
}

export default class VectorFieldCesiumLayer {
    layer = "vectorField";
    layerGroup = "";
    destroyed = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private _linkSegments: LinkSegment[] = [];
    private _emaByLink = new Map<number, number>();
    private _latestCountByLink = new Map<number, number>();
    private _streamPaths: StreamPath[] = [];
    private _streamWeights: number[] = [];
    private _glyphs: Cesium.PolylineCollection;
    private _trails: Cesium.PolylineCollection;
    private _particles: StreamParticle[] = [];
    private _fieldColors: Cesium.Color[] = [
        Cesium.Color.fromCssColorString("#2d7bff"),
        Cesium.Color.fromCssColorString("#60cfff"),
        Cesium.Color.fromCssColorString("#b7efff"),
        Cesium.Color.fromCssColorString("#f5fdff"),
    ];
    private _glyphVisible = false;
    private _particleVisible = true;
    private _glyphScale = 1.1;
    private _glyphStep = 2;
    private _particleOpacity = 0.34;
    private _trailWidth = 2.6;
    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount = 0;
    private _needsRebuild = false;
    private _lastRebuildTime = 0;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        this._glyphs.show = val && this._glyphVisible;
        this._trails.show = val && this._particleVisible;
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        ensureWindTrailMaterialRegistered();

        this._glyphs = new Cesium.PolylineCollection();
        this._glyphs.show = false;
        this._trails = new Cesium.PolylineCollection();
        this._trails.show = false;

        this._scene.primitives.add(this._glyphs);
        this._scene.primitives.add(this._trails);

        this._applyInitialSettings();
        this._initParticlePool();
        this._buildFromStore();
    }

    private _applyInitialSettings() {
        const { vectorField } = useAnalysisSettingStore.getState();
        this.setGlyphVisible(vectorField.showGlyphs);
        this.setParticleVisible(vectorField.showParticles);
        this.setGlyphScale(vectorField.glyphScale);
        this.setGlyphStep(vectorField.glyphStep);
        this.setParticleOpacity(vectorField.particleOpacity);
        this.setTrailWidth(vectorField.trailWidth);
        this.setColors(vectorField.colors);
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
                      ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;
        this._links = network.links as Link[];
        this._linkSegments = buildLinkSegments(this._links);
        this._emaByLink.clear();
        this._latestCountByLink.clear();
        this._links.forEach((l) => {
            this._emaByLink.set(l.id, 0);
            this._latestCountByLink.set(l.id, 0);
        });
    }

    private _initParticlePool() {
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const material = Cesium.Material.fromType(WIND_TRAIL_TYPE, {
                color: this._fieldColors[0],
                speed: 0.22,
                alpha: this._particleOpacity,
            });
            const polyline = this._trails.add({
                positions: [],
                width: this._trailWidth,
                material,
                show: false,
            });

            this._particles.push({
                pathIndex: -1,
                progressM: 0,
                speedM: 0,
                trailLengthM: 0,
                sideBandM: SIDE_OFFSET_BANDS_M[0]!,
                sideOffsetM: SIDE_OFFSET_BANDS_M[0]!,
                wavePhase: Math.random() * Math.PI * 2,
                waveAmpM: 0,
                age: 0,
                maxAge: MAX_AGE,
                polyline,
                material,
            });
        }
    }

    private _rebuildStreamPaths() {
        const paths: StreamPath[] = [];
        for (const link of this._links) {
            const ema = this._emaByLink.get(link.id) ?? 0;
            if (ema < MIN_ACTIVE_EMA) continue;

            const coords = (link.coordinates ?? [])
                .map((c) => ({ lon: c.lng, lat: c.lat }))
                .filter((_, idx, arr) => idx === 0 || meterDistance(arr[idx - 1]!, arr[idx]!) > 0.8);

            if (coords.length < 2) continue;

            const cumulativeM = buildCumulative(coords);
            const totalLengthM = cumulativeM[cumulativeM.length - 1] ?? 0;
            if (totalLengthM < 20) continue;

            paths.push({
                linkId: link.id,
                coords,
                cumulativeM,
                totalLengthM,
                ema,
                vehicleCount: this._latestCountByLink.get(link.id) ?? 0,
            });
        }

        this._streamPaths = paths;
        this._streamWeights = [];
        let cumulative = 0;
        for (const path of paths) {
            cumulative += Math.max(0.001, path.ema * (0.35 + path.totalLengthM / 120));
            this._streamWeights.push(cumulative);
        }
        this._rebuildGlyphs();
    }

    private _rebuildGlyphs() {
        this._glyphs.removeAll();
        if (!this._glyphVisible) return;

        const step = Math.max(1, Math.floor(this._glyphStep));
        for (let i = 0; i < this._streamPaths.length; i += step) {
            const path = this._streamPaths[i]!;
            const mid = sampleCoordAt(path, path.totalLengthM * 0.5);
            const ahead = sampleCoordAt(path, Math.min(path.totalLengthM, path.totalLengthM * 0.5 + 12));
            const behind = sampleCoordAt(path, Math.max(0, path.totalLengthM * 0.5 - 12));
            if (!mid || !ahead || !behind) continue;

            const dx = ahead.lon - behind.lon;
            const dy = ahead.lat - behind.lat;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1e-8) continue;

            const unitX = dx / len;
            const unitY = dy / len;
            const perpX = -unitY;
            const perpY = unitX;
            const normEma = Math.min(path.ema / MAX_EMA_SAT, 1);
            const lengthM = 22 * this._glyphScale + normEma * 28 * this._glyphScale;
            const headLenM = Math.max(8, lengthM * 0.28);
            const headWidthM = Math.max(4, lengthM * 0.12);
            const shaftHalfM = lengthM * 0.34;
            const color = flowColor(path.ema, this._fieldColors).withAlpha(0.74);
            const metersToLon = 1 / (111320 * Math.cos((mid.lat * Math.PI) / 180));
            const metersToLat = 1 / 111320;

            const tailLon = mid.lon - unitX * shaftHalfM * metersToLon;
            const tailLat = mid.lat - unitY * shaftHalfM * metersToLat;
            const headLon = mid.lon + unitX * shaftHalfM * metersToLon;
            const headLat = mid.lat + unitY * shaftHalfM * metersToLat;
            const baseLon = headLon - unitX * headLenM * metersToLon;
            const baseLat = headLat - unitY * headLenM * metersToLat;
            const leftLon = baseLon + perpX * headWidthM * metersToLon;
            const leftLat = baseLat + perpY * headWidthM * metersToLat;
            const rightLon = baseLon - perpX * headWidthM * metersToLon;
            const rightLat = baseLat - perpY * headWidthM * metersToLat;

            this._glyphs.add({
                positions: [
                    Cesium.Cartesian3.fromDegrees(tailLon, tailLat, GLYPH_ALTITUDE),
                    Cesium.Cartesian3.fromDegrees(headLon, headLat, GLYPH_ALTITUDE),
                ],
                width: 1.4 + normEma * 1.6,
                material: Cesium.Material.fromType("Color", { color }),
                show: this._show && this._glyphVisible,
            });
            this._glyphs.add({
                positions: [
                    Cesium.Cartesian3.fromDegrees(leftLon, leftLat, GLYPH_ALTITUDE),
                    Cesium.Cartesian3.fromDegrees(headLon, headLat, GLYPH_ALTITUDE),
                ],
                width: 1.3 + normEma * 1.2,
                material: Cesium.Material.fromType("Color", { color }),
                show: this._show && this._glyphVisible,
            });
            this._glyphs.add({
                positions: [
                    Cesium.Cartesian3.fromDegrees(rightLon, rightLat, GLYPH_ALTITUDE),
                    Cesium.Cartesian3.fromDegrees(headLon, headLat, GLYPH_ALTITUDE),
                ],
                width: 1.3 + normEma * 1.2,
                material: Cesium.Material.fromType("Color", { color }),
                show: this._show && this._glyphVisible,
            });
        }
    }

    private _samplePathIndex(): number {
        if (!this._streamWeights.length) return -1;
        const total = this._streamWeights[this._streamWeights.length - 1] ?? 0;
        if (total <= 0) return -1;
        const r = Math.random() * total;
        let lo = 0;
        let hi = this._streamWeights.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            this._streamWeights[mid]! < r ? (lo = mid + 1) : (hi = mid);
        }
        return lo;
    }

    private _seedParticle(p: StreamParticle) {
        const pathIndex = this._samplePathIndex();
        if (pathIndex < 0) {
            p.pathIndex = -1;
            p.polyline.positions = [];
            p.polyline.show = false;
            p.age = 0;
            return;
        }

        const path = this._streamPaths[pathIndex]!;
        const normEma = Math.min(path.ema / MAX_EMA_SAT, 1);
        const baseBand = SIDE_OFFSET_BANDS_M[Math.floor(Math.random() * SIDE_OFFSET_BANDS_M.length)] ?? SIDE_OFFSET_BANDS_M[0]!;
        const sideSign = Math.random() > 0.5 ? 1 : -1;
        p.pathIndex = pathIndex;
        p.progressM = Math.random() * path.totalLengthM;
        p.speedM = 3.0 + normEma * 5.2;
        p.trailLengthM = Math.min(path.totalLengthM * 0.38, 20 + normEma * 42 + Math.random() * 14);
        p.sideBandM = baseBand;
        p.sideOffsetM = (baseBand + Math.random() * SIDE_OFFSET_JITTER_M) * sideSign;
        p.wavePhase = Math.random() * Math.PI * 2;
        p.waveAmpM = (SIDE_WAVE_AMPLITUDE_M * (0.55 + Math.random() * 0.45)) * sideSign;
        p.age = Math.ceil(MAX_AGE * (0.45 + Math.random() * 0.55));
        p.maxAge = p.age;
        p.polyline.positions = [];
        p.polyline.show = false;
    }

    private _updateParticleTrails() {
        for (const particle of this._particles) {
            if (particle.age <= 0 || particle.pathIndex < 0 || !this._streamPaths[particle.pathIndex]) {
                this._seedParticle(particle);
                continue;
            }

            const path = this._streamPaths[particle.pathIndex]!;
            const normEma = Math.min(path.ema / MAX_EMA_SAT, 1);
            particle.age--;
            particle.progressM += particle.speedM;
            if (particle.progressM > path.totalLengthM) {
                this._seedParticle(particle);
                continue;
            }

            const startM = Math.max(0, particle.progressM - particle.trailLengthM);
            const coords = buildPathSlice(path, startM, particle.progressM);
            if (coords.length < 2) {
                particle.polyline.positions = [];
                particle.polyline.show = false;
                continue;
            }

            const positions = coords.map((_, index) => {
                const ratio = coords.length <= 1 ? 0 : index / (coords.length - 1);
                const shifted = offsetCoordAlongPath(
                    coords,
                    index,
                    particle.sideOffsetM,
                    particle.wavePhase + (particle.progressM / SIDE_WAVE_LENGTH_M),
                    particle.waveAmpM,
                    ratio,
                );
                return Cesium.Cartesian3.fromDegrees(shifted.lon, shifted.lat, PARTICLE_ALTITUDE);
            });
            const lifeAlpha = Math.min(particle.age / (particle.maxAge * 0.24), 1) * this._particleOpacity;
            const color = flowColor(path.ema, this._fieldColors).withAlpha(Math.max(0.10, lifeAlpha));

            particle.material.uniforms.color = color;
            particle.material.uniforms.alpha = lifeAlpha;
            particle.material.uniforms.speed = 0.10 + normEma * 0.12;
            const widthBoost = 0.84 + Math.abs(particle.sideBandM) / 26;
            particle.polyline.width = Math.max(1.0, this._trailWidth * widthBoost);
            particle.polyline.positions = positions;
            particle.polyline.show = this._show && this._particleVisible;
        }
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const cart3 = new Cesium.Cartesian3(pos[0]!, pos[1]!, pos[2]!);
            const c = Cartographic.fromCartesian(cart3, Ellipsoid.WGS84);
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch {
            return null;
        }
    }

    private _updateEMA(positions: (number[] | null)[]) {
        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const countByLink = new Map<number, number>();

        for (const pos of positions) {
            if (!pos) continue;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const id = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (id < 0) continue;
            countByLink.set(id, (countByLink.get(id) ?? 0) + 1);
        }

        for (const [linkId] of this._emaByLink) {
            const count = countByLink.get(linkId) ?? 0;
            const prev = this._emaByLink.get(linkId) ?? 0;
            this._emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + count * (1 - TRAFFIC_EMA_DECAY));
            this._latestCountByLink.set(linkId, count);
        }
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        this._pendingPositions = data.positions;
    }

    public setColors(colors: string[]) {
        this._fieldColors = colors.map((color) => Cesium.Color.fromCssColorString(color));
        this._rebuildGlyphs();
    }

    public setGlyphVisible(visible: boolean) {
        this._glyphVisible = visible;
        this._glyphs.show = this._show && visible;
    }

    public setParticleVisible(visible: boolean) {
        this._particleVisible = visible;
        this._trails.show = this._show && visible;
        if (!visible) {
            for (const p of this._particles) p.polyline.show = false;
        }
    }

    public setGlyphScale(scale: number) {
        this._glyphScale = Math.max(0.4, scale);
        this._rebuildGlyphs();
    }

    public setGlyphStep(step: number) {
        this._glyphStep = Math.max(1, Math.floor(step));
        this._rebuildGlyphs();
    }

    public setParticleOpacity(opacity: number) {
        this._particleOpacity = Cesium.Math.clamp(opacity, 0, 1);
    }

    public setTrailWidth(width: number) {
        this._trailWidth = Cesium.Math.clamp(width, 1.0, 10);
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    update(_frameState: any) {
        if (this.destroyed) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }

        this._frameCount++;
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions);
            this._needsRebuild = true;
        }

        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            this._rebuildStreamPaths();
            this._lastRebuildTime = now;
            this._needsRebuild = false;
        }

        this._updateParticleTrails();
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (!this._glyphs.isDestroyed()) this._scene.primitives.remove(this._glyphs);
        if (!this._trails.isDestroyed()) this._scene.primitives.remove(this._trails);
    }
}
