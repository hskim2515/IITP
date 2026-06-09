import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { fromLonLat } from "ol/proj";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useHeatmapSettingStore } from "@stores/useHeatmapSettingStore";
import { useAnalysisSettingStore } from "@stores/useAnalysisSettingStore";
import { Link } from "@type/Network";
import {
    TRAFFIC_EMA_DECAY,
    TRAFFIC_SNAP_DIST_M,
    TRAFFIC_UPDATE_INTERVAL,
    NUM_TRAFFIC_BUCKETS,
    emaToBucket,
    buildLinkSegments,
    findNearestLink,
    LinkSegment,
} from "@features/TrafficHeatmapFeatureLayer";

const TRAFFIC_HEIGHT_OFFSET_M = 1.6;
const FLOW_CORRIDOR_WIDTH_M = 20;  // 모든 링크 고정 너비 (도로 폭 비례 방지)
const REBUILD_MIN_MS = 1200;
const FLOW_MATERIAL_TYPE = "TrafficFlowBarMaterial";
const FLOW_BG_ALPHA = 0.48;
const FLOW_SPEED = 1.4;        // 한 주기(전체 링크 통과)에 걸리는 속도
const FLOW_ARROW_WIDTH = 0.07; // 링크 길이 대비 화살촉 폭 (7%)
const DWELL_SPEED_THRESHOLD_MPS = 2.0;
const DWELL_GRACE_SEC = 8;
const DWELL_ACCUM_FACTOR = 0.4;

type FlowMetric = 'volume' | 'avgSpeed' | 'dwell';
type VehicleState = {
    lastPos: number[] | null;
    lastTs: number;
    currentLinkId: number;
    slowAccumSec: number;
};

type LinkFlowSegment = {
    linkId: number;
    positions: Cesium.Cartesian3[];
    projectedCoords: number[][];
    avgTerrainHeight: number;
    width: number;
};

function ensureFlowMaterialRegistered() {
    const material = Cesium.Material as any;
    if (material._materialCache.getMaterial(FLOW_MATERIAL_TYPE)) return;

    material._materialCache.addMaterial(FLOW_MATERIAL_TYPE, {
        fabric: {
            type: FLOW_MATERIAL_TYPE,
            uniforms: {
                color: Cesium.Color.WHITE,
                bgAlpha: FLOW_BG_ALPHA,
                speed: FLOW_SPEED,
                arrowWidth: FLOW_ARROW_WIDTH,
            },
            source: `
                czm_material czm_getMaterial(czm_materialInput materialInput)
                {
                    czm_material material = czm_getDefaultMaterial(materialInput);
                    vec2 st = materialInput.st;

                    float t   = fract(float(czm_frameNumber) * speed * 0.01);
                    // ease-in cubic: 처음 느리게 출발, 점진적 가속
                    float pos = pow(t, 2.0);
                    float delta = fract(pos - st.s);
                    float vt    = st.t - 0.5;
                    float aa    = 0.012;

                    float armSpan  = 0.40;
                    float armThick = 0.115;  // 두꺼운 팔

                    // ── 본체 꺽새: delta ∈ [0, arrowWidth] ────────────────
                    float inChev = smoothstep(-aa, aa, delta) *
                                   (1.0 - smoothstep(arrowWidth - aa, arrowWidth + aa, delta));
                    float lx    = clamp(delta / arrowWidth, 0.0, 1.0); // 0=tip(앞), 1=tail(뒤)
                    float armY  = lx * armSpan;

                    float topDist = abs(vt - armY);
                    float botDist = abs(vt + armY);
                    float topMask = 1.0 - smoothstep(armThick - aa, armThick + aa, topDist);
                    float botMask = 1.0 - smoothstep(armThick - aa, armThick + aa, botDist);
                    float chevron = max(topMask, botMask) * inChev;

                    // 원통형 bevel: 팔 중심이 밝고 가장자리가 어두움
                    float topBevel = max(0.0, 1.0 - topDist / armThick) * topMask;
                    float botBevel = max(0.0, 1.0 - botDist / armThick) * botMask;
                    float bevel    = max(topBevel, botBevel);
                    bevel = bevel * bevel;  // 제곱 → 원통형 하이라이트

                    float tipBright = 1.0 - smoothstep(0.0, 0.65, lx);

                    // ── 잔상: 화살촉 꼬리 ~ 링크 출발점까지, 뒤로 갈수록 투명 ──
                    // delta ∈ [arrowWidth, pos]: 화살촉이 지나온 구간 전체
                    float maxTrail  = max(pos - arrowWidth, 0.001);
                    float inBehind  = step(arrowWidth + aa, delta) *
                                      (1.0 - step(pos - aa, delta));
                    float trailDist = delta - arrowWidth;
                    float trailT    = clamp(trailDist / maxTrail, 0.0, 1.0); // 0=꼬리, 1=출발점
                    float trailFade = pow(1.0 - trailT, 0.75); // 출발점으로 갈수록 투명

                    float tThick   = armThick * (0.80 - trailT * 0.60);
                    float tTopDist = abs(vt - armSpan);
                    float tBotDist = abs(vt + armSpan);
                    float tTopMask = 1.0 - smoothstep(tThick - aa, tThick + aa, tTopDist);
                    float tBotMask = 1.0 - smoothstep(tThick - aa, tThick + aa, tBotDist);
                    float tTopBevel = max(0.0, 1.0 - tTopDist / max(tThick, 0.001)) * tTopMask;
                    float tBotBevel = max(0.0, 1.0 - tBotDist / max(tThick, 0.001)) * tBotMask;
                    float trailBevel = max(tTopBevel, tBotBevel);
                    trailBevel = trailBevel * trailBevel;
                    float trail = max(tTopMask, tBotMask) * inBehind * trailFade;

                    // ── 색상 ─────────────────────────────────────────────
                    vec3 bgRgb    = color.rgb * 0.25;
                    vec3 darkArm  = color.rgb * 0.45;               // 가장자리: 어두운 원색
                    vec3 litArm   = mix(color.rgb, vec3(1.0), 0.60); // 중심 하이라이트
                    // bevel: 가장자리→하이라이트 (원통 느낌)
                    vec3 bevelColor = mix(darkArm, litArm, bevel);
                    // tip: 배경색에 가까운 희미한 색 / tail: bevel
                    vec3 arrowRgb = mix(bevelColor, bgRgb, tipBright * 0.92);
                    float chevronFade = chevron * (1.0 - tipBright * 0.90);
                    vec3 trailRgb = mix(darkArm, litArm, clamp(trailBevel, 0.0, 1.0));

                    vec3 col = bgRgb;
                    col = mix(col, trailRgb, trail);
                    col = mix(col, arrowRgb, chevronFade);

                    material.diffuse  = col;
                    material.emission = arrowRgb * chevronFade * 0.3
                                      + trailRgb * trail * 1.0;
                    material.alpha    = max(bgAlpha, max(chevronFade, trail) * 0.97);
                    return material;
                }
            `,
        },
        translucent: () => true,
    });
}

function cesiumColorForBucket(bucket: number, colors: string[]): Cesium.Color {
    if (bucket === 0) return Cesium.Color.fromCssColorString("#1d2440").withAlpha(0.18);
    const hex = colors[bucket - 1] ?? "#ff2200";
    return Cesium.Color.fromCssColorString(hex).withAlpha(0.95);
}

/**
 * 링크 전체를 하나의 flow bar로 보고,
 * 그 위에 로딩바처럼 chevron/arrow 패턴이 천천히 흐르는 Cesium 레이어.
 */
export default class LinkFlowBarCesiumLayer {
    layer = "";
    layerGroup = "";
    destroyed = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private _linkSegments: LinkSegment[] = [];
    private _flowSegments: LinkFlowSegment[] = [];
    private _emaByLink = new Map<number, number>();
    private _vehicleStates: VehicleState[] = [];
    private _bucketPrimitives: (Cesium.Primitive | null)[] = new Array(NUM_TRAFFIC_BUCKETS).fill(null);
    private _terrainHeightMap = new Map<string, number>();
    private _pendingPositions: (number[] | null)[] | null = null;
    private _frameCount = 0;
    private _needsRebuild = false;
    private _lastRebuildTime = 0;
    private _terrainSampling = false;
    private _settingsUnsubscribe: (() => void) | null = null;
    private _metricUnsubscribe: (() => void) | null = null;
    private _metric: FlowMetric = useAnalysisSettingStore.getState().flowBar.metric;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        for (const p of this._bucketPrimitives) {
            if (p) p.show = val;
        }
    }

    constructor(viewer: Cesium.Viewer) {
        ensureFlowMaterialRegistered();
        this._scene = viewer.scene;
        this._buildFromStore();

        this._settingsUnsubscribe = (useHeatmapSettingStore as any).subscribe(
            (s: any) => [s.colors],
            () => {
                this._needsRebuild = true;
                this._lastRebuildTime = 0;
            },
        );
        this._metricUnsubscribe = (useAnalysisSettingStore as any).subscribe(
            (s: any) => s.flowBar.metric,
            (metric: FlowMetric) => this.setFlowMetric(metric),
        );
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
            ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;

        this._links = network.links as Link[];
        this._linkSegments = buildLinkSegments(this._links);
        this._emaByLink.clear();
        this._links.forEach((link) => this._emaByLink.set(link.id, 0));
        if (!this._terrainSampling) {
            this._terrainSampling = true;
            this._sampleTerrainHeights()
                .catch((e) => {
                    console.warn("[LinkFlowBarCesiumLayer] 지형 고도 샘플링 실패:", e);
                })
                .finally(() => {
                    this._terrainSampling = false;
                });
        }
    }

    private _terrainKey(lng: number, lat: number): string {
        return `${lng.toFixed(6)},${lat.toFixed(6)}`;
    }

    private async _sampleTerrainHeights() {
        const coordMap = new Map<string, Cesium.Cartographic>();
        for (const link of this._links) {
            for (const c of link.coordinates ?? []) {
                const key = this._terrainKey(c.lng, c.lat);
                if (!coordMap.has(key)) {
                    coordMap.set(key, Cesium.Cartographic.fromDegrees(c.lng, c.lat));
                }
            }
        }
        if (coordMap.size === 0) return;

        const keys = Array.from(coordMap.keys());
        const cartos = Array.from(coordMap.values());
        await Cesium.sampleTerrainMostDetailed(this._scene.terrainProvider, cartos);

        this._terrainHeightMap.clear();
        for (let i = 0; i < keys.length; i++) {
            this._terrainHeightMap.set(keys[i]!, cartos[i]!.height ?? 0);
        }

        this._rebuildFlowSegments();
        this._needsRebuild = true;
        this._lastRebuildTime = 0;
    }

    private _rebuildFlowSegments() {
        this._flowSegments = [];

        for (const link of this._links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;

            let terrainSum = 0;
            let terrainCount = 0;
            for (const c of link.coordinates) {
                const h = this._terrainHeightMap.get(this._terrainKey(c.lng, c.lat));
                if (h !== undefined) {
                    terrainSum += h;
                    terrainCount++;
                }
            }

            const avgTerrainHeight = terrainCount > 0 ? terrainSum / terrainCount : 0;
            const positions = link.coordinates.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            const projectedCoords = link.coordinates.map((c) => fromLonLat([c.lng, c.lat]));

            this._flowSegments.push({
                linkId: link.id,
                positions,
                projectedCoords,
                avgTerrainHeight,
                width: FLOW_CORRIDOR_WIDTH_M,
            });
        }
    }

    private _ecefToOl(pos: number[]): number[] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any,
                Ellipsoid.WGS84
            );
            return fromLonLat([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        } catch {
            return null;
        }
    }

    private _metricValueToBucket(value: number): number {
        if (this._metric === 'volume') return emaToBucket(value);
        if (this._metric === 'avgSpeed') {
            if (value <= 0) return 0;
            if (value < 20) return 4;
            if (value < 40) return 3;
            if (value < 60) return 2;
            if (value < 80) return 1;
            return 0;
        }
        if (value < 0.8) return 0;
        if (value < 2.2) return 1;
        if (value < 4.2) return 2;
        if (value < 7.0) return 3;
        return 4;
    }

    private _resetRuntimeState() {
        this._frameCount = 0;
        this._vehicleStates = [];
        this._emaByLink.forEach((_v, key) => this._emaByLink.set(key, 0));
        this._needsRebuild = true;
        this._lastRebuildTime = 0;
    }

    private _updateEMA(positions: (number[] | null)[]) {
        const snapDist2 = TRAFFIC_SNAP_DIST_M * TRAFFIC_SNAP_DIST_M;
        const now = Date.now();
        while (this._vehicleStates.length < positions.length) {
            this._vehicleStates.push({ lastPos: null, lastTs: now, currentLinkId: -1, slowAccumSec: 0 });
        }
        const countByLink = new Map<number, number>();
        const speedSumByLink = new Map<number, number>();
        const speedCountByLink = new Map<number, number>();
        const dwellByLink = new Map<number, number>();

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            if (!pos) continue;
            const state = this._vehicleStates[i]!;
            const ol = this._ecefToOl(pos);
            if (!ol) continue;
            const linkId = findNearestLink(ol[0]!, ol[1]!, this._linkSegments, snapDist2);
            if (linkId < 0) continue;
            countByLink.set(linkId, (countByLink.get(linkId) ?? 0) + 1);
            if (state.lastPos) {
                const dt = Math.max(0.03, Math.min(0.35, (now - state.lastTs) / 1000));
                const dx = pos[0] - state.lastPos[0]!;
                const dy = pos[1] - state.lastPos[1]!;
                const dz = pos[2] - state.lastPos[2]!;
                const kmh = Math.hypot(dx, dy, dz) / dt * 3.6;
                if (kmh > 0 && kmh < 200) {
                    speedSumByLink.set(linkId, (speedSumByLink.get(linkId) ?? 0) + kmh);
                    speedCountByLink.set(linkId, (speedCountByLink.get(linkId) ?? 0) + 1);
                    if (linkId !== state.currentLinkId) {
                        state.slowAccumSec = 0;
                    }
                    if (kmh / 3.6 <= DWELL_SPEED_THRESHOLD_MPS) {
                        state.slowAccumSec += dt;
                        if (state.slowAccumSec > DWELL_GRACE_SEC) {
                            const effectiveDt = Math.min(dt, state.slowAccumSec - DWELL_GRACE_SEC);
                            dwellByLink.set(linkId, (dwellByLink.get(linkId) ?? 0) + effectiveDt * DWELL_ACCUM_FACTOR);
                        }
                    } else {
                        state.slowAccumSec = Math.max(0, state.slowAccumSec - dt * 2.5);
                    }
                }
            }
            state.lastPos = pos;
            state.lastTs = now;
            state.currentLinkId = linkId;
        }

        for (const [linkId] of this._emaByLink) {
            let metricValue = 0;
            if (this._metric === 'volume') {
                metricValue = countByLink.get(linkId) ?? 0;
            } else if (this._metric === 'avgSpeed') {
                const speedCount = speedCountByLink.get(linkId) ?? 0;
                metricValue = speedCount > 0 ? (speedSumByLink.get(linkId) ?? 0) / speedCount : 0;
            } else {
                metricValue = dwellByLink.get(linkId) ?? 0;
            }
            const prev = this._emaByLink.get(linkId) ?? 0;
            this._emaByLink.set(linkId, prev * TRAFFIC_EMA_DECAY + metricValue * (1 - TRAFFIC_EMA_DECAY));
        }
    }

    private _createBucketMaterial(bucket: number, colors: string[]): Cesium.Material {
        return new Cesium.Material({
            fabric: {
                type: FLOW_MATERIAL_TYPE,
                uniforms: {
                    color: cesiumColorForBucket(bucket, colors),
                    bgAlpha: FLOW_BG_ALPHA,
                    speed: FLOW_SPEED,
                    arrowWidth: FLOW_ARROW_WIDTH,
                },
            },
        });
    }

    private _rebuildPrimitives() {
        const { colors } = useHeatmapSettingStore.getState();
        const bucketInstances: Cesium.GeometryInstance[][] =
            Array.from({ length: NUM_TRAFFIC_BUCKETS }, () => []);

        for (const link of this._flowSegments) {
            const ema = this._emaByLink.get(link.linkId) ?? 0;
            const bucket = this._metricValueToBucket(ema);
            if (bucket === 0) continue;

            bucketInstances[bucket]!.push(new Cesium.GeometryInstance({
                id: `flow-${link.linkId}`,
                geometry: new Cesium.CorridorGeometry({
                    positions: link.positions,
                    width: link.width,
                    height: link.avgTerrainHeight + TRAFFIC_HEIGHT_OFFSET_M,
                    cornerType: Cesium.CornerType.ROUNDED,
                    vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
                }),
            }));
        }

        for (let b = 1; b < NUM_TRAFFIC_BUCKETS; b++) {
            const old = this._bucketPrimitives[b];
            if (old && !old.isDestroyed()) this._scene.primitives.remove(old);
            this._bucketPrimitives[b] = null;

            const instances = bucketInstances[b]!;
            if (instances.length === 0) continue;

            const primitive = new Cesium.Primitive({
                geometryInstances: instances,
                appearance: new Cesium.MaterialAppearance({
                    flat: true,
                    translucent: true,
                    closed: false,
                    renderState: Cesium.RenderState.fromCache({
                        depthTest: { enabled: false },
                        depthMask: false,
                        polygonOffset: {
                            enabled: true,
                            factor: -2,
                            units: -8,
                        },
                    }),
                    material: this._createBucketMaterial(b, colors),
                }),
                show: this._show,
                asynchronous: true,
            });
            this._scene.primitives.add(primitive);
            this._bucketPrimitives[b] = primitive;
        }

        try { this._scene.requestRender(); } catch (_) {}
    }

    public setLatestPositions(data: { positions: (number[] | null)[] }) {
        if (!this._show) return;
        this._pendingPositions = data.positions;
    }

    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}
    public setFlowMetric(metric: FlowMetric) {
        this._metric = metric;
        this._resetRuntimeState();
    }

    update(_frameState: any) {
        if (this.destroyed) return;
        if (!this._show) return;
        if (this._linkSegments.length === 0) {
            this._buildFromStore();
            return;
        }
        if (this._flowSegments.length === 0) return; // 지형 샘플링 대기 중

        this._frameCount++;
        if (this._frameCount % TRAFFIC_UPDATE_INTERVAL === 0 && this._pendingPositions) {
            this._updateEMA(this._pendingPositions);
            this._needsRebuild = true;
        }

        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            this._rebuildPrimitives();
            this._lastRebuildTime = now;
            this._needsRebuild = false;
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._settingsUnsubscribe?.();
        this._metricUnsubscribe?.();
        for (let b = 0; b < NUM_TRAFFIC_BUCKETS; b++) {
            const p = this._bucketPrimitives[b];
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._bucketPrimitives = new Array(NUM_TRAFFIC_BUCKETS).fill(null);
    }
}
