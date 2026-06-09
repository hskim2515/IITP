import * as Cesium from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useVisualLayerSettingStore } from "@stores/useVisualLayerSettingStore";
import { Link } from "@type/Network";

const GUIDEWAY_GLOW_WIDTH   = 24;   // m — 외부 글로우 (넓게)
const GUIDEWAY_CORE_WIDTH   = 8;    // m — 밝은 코어
const GUIDEWAY_WALL_HEIGHT  = 6;    // m — 수직 가이드웨이 벽 높이
const GUIDEWAY_HEIGHT_ABOVE = 0.35; // m — 지형 위 기준 높이

const GUIDEWAY_GLOW_TYPE = "GuidewayGlowMaterial";
const GUIDEWAY_CORE_TYPE = "GuidewayCoreMaterial";
const GUIDEWAY_WALL_TYPE = "GuidewayWallMaterial";

function ensureGuidewayMaterialsRegistered(neonColor: Cesium.Color) {
    const cache = (Cesium.Material as any)._materialCache;

    if (!cache.getMaterial(GUIDEWAY_GLOW_TYPE)) {
        cache.addMaterial(GUIDEWAY_GLOW_TYPE, {
            fabric: {
                type: GUIDEWAY_GLOW_TYPE,
                uniforms: { color: neonColor },
                source: `
czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);
    float t    = materialInput.st.t;
    float time = float(czm_frameNumber) * 0.016;

    float edge  = 1.0 - abs(t * 2.0 - 1.0);
    float glow  = pow(edge, 0.45);
    float pulse = 0.60 + 0.40 * sin(time * 1.5);

    mat.diffuse  = color.rgb * glow * pulse * 0.5;
    mat.emission = color.rgb * glow * pulse * 1.1;
    mat.alpha    = glow * 0.42 * pulse * color.a;
    return mat;
}`,
            },
            translucent: () => true,
        });
    }

    if (!cache.getMaterial(GUIDEWAY_CORE_TYPE)) {
        cache.addMaterial(GUIDEWAY_CORE_TYPE, {
            fabric: {
                type: GUIDEWAY_CORE_TYPE,
                uniforms: { color: neonColor },
                source: `
czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);
    float t    = materialInput.st.t;
    float s    = materialInput.st.s;
    float time = float(czm_frameNumber) * 0.016;

    float edge = 1.0 - abs(t * 2.0 - 1.0);
    float core = smoothstep(0.18, 0.92, edge);

    // 이동 대시 패킷
    float phase = fract(s / 0.09 - time * 0.5);
    float dash  = smoothstep(0.0, 0.07, phase) * (1.0 - smoothstep(0.50, 0.72, phase));

    // 빠른 스파크
    float scan  = fract(s - time * 0.40);
    float spark = smoothstep(0.0, 0.04, scan) * smoothstep(0.30, 0.09, scan);

    float pulse = 0.78 + 0.22 * sin(time * 2.1);
    float bright = core * dash * pulse + spark * 0.7;

    mat.diffuse  = color.rgb * bright * 0.5;
    mat.emission = color.rgb * bright * 1.2;
    mat.alpha    = (core * dash * 0.92 + spark * 0.50) * pulse * color.a;
    return mat;
}`,
            },
            translucent: () => true,
        });
    }

    // ── 수직 벽: 아래가 밝고 위로 갈수록 투명, 수평 스캔라인 ──
    if (!cache.getMaterial(GUIDEWAY_WALL_TYPE)) {
        cache.addMaterial(GUIDEWAY_WALL_TYPE, {
            fabric: {
                type: GUIDEWAY_WALL_TYPE,
                uniforms: { color: neonColor },
                source: `
czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);
    float h    = materialInput.st.t;  // 0=하단, 1=상단
    float s    = materialInput.st.s;
    float time = float(czm_frameNumber) * 0.016;

    // 높이에 따른 기본 페이드 (아래 밝음)
    float fade  = pow(1.0 - h, 1.2);

    // 수평 스캔라인이 위로 이동
    float scan  = fract(h - time * 0.28);
    float hLine = smoothstep(0.0, 0.025, scan) * smoothstep(0.14, 0.04, scan);

    // 수직 데이터 흐름 라인
    float vPhase = fract(s / 0.07 - time * 0.45);
    float vLine  = smoothstep(0.0, 0.05, vPhase) * (1.0 - smoothstep(0.38, 0.58, vPhase));

    float pulse = 0.65 + 0.35 * sin(time * 1.7);

    float intensity = fade * 0.55 + hLine * 0.50 + vLine * fade * 0.30;

    mat.diffuse  = color.rgb * intensity * pulse * 0.4;
    mat.emission = color.rgb * intensity * pulse;
    mat.alpha    = (fade * 0.38 + hLine * 0.42 + vLine * fade * 0.18) * pulse * color.a;
    return mat;
}`,
            },
            translucent: () => true,
        });
    }
}

/**
 * 가이드웨이 레이어.
 * 3-pass: 외부 글로우(바닥) + 밝은 코어(바닥) + 수직 가이드웨이 벽(입체감).
 */
export default class GuidewayCesiumLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private _show = false;
    private _color: string;
    private _scene: Cesium.Scene;
    private _links: Link[] = [];
    private _terrainHeightMap = new Map<string, number>();
    private _glowPrimitive: Cesium.Primitive | null = null;
    private _corePrimitive: Cesium.Primitive | null = null;
    private _wallPrimitive: Cesium.Primitive | null = null;
    private _glowMaterial: Cesium.Material | null = null;
    private _coreMaterial: Cesium.Material | null = null;
    private _wallMaterial: Cesium.Material | null = null;
    private _terrainSampling = false;
    private _built = false;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        if (this._glowPrimitive) this._glowPrimitive.show = val;
        if (this._corePrimitive) this._corePrimitive.show = val;
        if (this._wallPrimitive) this._wallPrimitive.show = val;
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._color = useVisualLayerSettingStore.getState().guidewayColor;
        ensureGuidewayMaterialsRegistered(Cesium.Color.fromCssColorString(this._color));
        this._buildFromStore();
    }

    private _key(lng: number, lat: number) {
        return `${lng.toFixed(6)},${lat.toFixed(6)}`;
    }

    private _buildFromStore() {
        const network = (useNetworkStore.getState().currentJsonData
                      ?? useNetworkStore.getState().originData) as any;
        if (!network?.links) return;

        this._links = network.links as Link[];
        if (!this._terrainSampling) {
            this._terrainSampling = true;
            this._sampleTerrain()
                .catch(e => console.warn("[GuidewayCesiumLayer] 지형 샘플링 실패:", e))
                .finally(() => { this._terrainSampling = false; });
        }
    }

    private async _sampleTerrain() {
        const coordMap = new Map<string, Cesium.Cartographic>();
        for (const link of this._links) {
            for (const c of link.coordinates ?? []) {
                const key = this._key(c.lng, c.lat);
                if (!coordMap.has(key)) coordMap.set(key, Cesium.Cartographic.fromDegrees(c.lng, c.lat));
            }
        }
        if (coordMap.size === 0) return;

        const keys   = Array.from(coordMap.keys());
        const cartos = Array.from(coordMap.values());
        await Cesium.sampleTerrainMostDetailed(this._scene.terrainProvider, cartos);

        this._terrainHeightMap.clear();
        keys.forEach((k, i) => this._terrainHeightMap.set(k, cartos[i]!.height ?? 0));
        this._rebuildPrimitives();
    }

    private _linkHeight(link: Link): number {
        const coords = link.coordinates ?? [];
        let sum = 0, n = 0;
        for (const c of coords) {
            const h = this._terrainHeightMap.get(this._key(c.lng, c.lat));
            if (h !== undefined) { sum += h; n++; }
        }
        return n > 0 ? sum / n : 0;
    }

    private _rebuildPrimitives() {
        if (this.destroyed) return;

        // 기존 제거
        for (const p of [this._glowPrimitive, this._corePrimitive, this._wallPrimitive]) {
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._glowPrimitive = this._corePrimitive = this._wallPrimitive = null;

        const vfTextured = Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat;
        const glowInst: Cesium.GeometryInstance[] = [];
        const coreInst: Cesium.GeometryInstance[] = [];
        const wallInst: Cesium.GeometryInstance[] = [];

        for (const link of this._links) {
            if (!link.coordinates || link.coordinates.length < 2) continue;

            const positions = link.coordinates.map(c =>
                Cesium.Cartesian3.fromDegrees(c.lng, c.lat)
            );
            const avgH = this._linkHeight(link);
            const floorH = avgH + GUIDEWAY_HEIGHT_ABOVE;

            // 바닥 글로우
            glowInst.push(new Cesium.GeometryInstance({
                geometry: new Cesium.CorridorGeometry({
                    positions,
                    width: GUIDEWAY_GLOW_WIDTH,
                    height: floorH,
                    cornerType: Cesium.CornerType.ROUNDED,
                    vertexFormat: vfTextured,
                }),
            }));

            // 밝은 코어
            coreInst.push(new Cesium.GeometryInstance({
                geometry: new Cesium.CorridorGeometry({
                    positions,
                    width: GUIDEWAY_CORE_WIDTH,
                    height: floorH + 0.05,
                    cornerType: Cesium.CornerType.ROUNDED,
                    vertexFormat: vfTextured,
                }),
            }));

            // 수직 벽 (입체감)
            const minH = link.coordinates.map(c =>
                (this._terrainHeightMap.get(this._key(c.lng, c.lat)) ?? avgH) + GUIDEWAY_HEIGHT_ABOVE
            );
            const maxH = minH.map(h => h + GUIDEWAY_WALL_HEIGHT);
            wallInst.push(new Cesium.GeometryInstance({
                geometry: new Cesium.WallGeometry({
                    positions,
                    minimumHeights: minH,
                    maximumHeights: maxH,
                    vertexFormat: vfTextured,
                }),
            }));
        }

        if (glowInst.length === 0) return;

        const currentColor = Cesium.Color.fromCssColorString(this._color);

        const makeMaterial = (type: string): Cesium.Material => {
            const mat = new Cesium.Material({ fabric: { type } });
            mat.uniforms.color = currentColor;
            return mat;
        };

        this._glowMaterial = makeMaterial(GUIDEWAY_GLOW_TYPE);
        this._coreMaterial = makeMaterial(GUIDEWAY_CORE_TYPE);
        this._wallMaterial = makeMaterial(GUIDEWAY_WALL_TYPE);

        const makeApp = (mat: Cesium.Material) => new Cesium.MaterialAppearance({
            flat: true,
            translucent: true,
            closed: false,
            material: mat,
        });

        this._glowPrimitive = this._scene.primitives.add(new Cesium.Primitive({
            geometryInstances: glowInst,
            appearance: makeApp(this._glowMaterial),
            show: this._show,
            asynchronous: true,
        }));

        this._corePrimitive = this._scene.primitives.add(new Cesium.Primitive({
            geometryInstances: coreInst,
            appearance: makeApp(this._coreMaterial),
            show: this._show,
            asynchronous: true,
        }));

        this._wallPrimitive = this._scene.primitives.add(new Cesium.Primitive({
            geometryInstances: wallInst,
            appearance: makeApp(this._wallMaterial),
            show: this._show,
            asynchronous: true,
        }));

        this._built = true;
    }

    update(_frameState: any) {
        if (this.destroyed) return;
        if (!this._built && !this._terrainSampling) this._buildFromStore();
    }

    setGuidewayColor(hex: string) {
        this._color = hex;
        const c = Cesium.Color.fromCssColorString(hex);
        if (this._glowMaterial) this._glowMaterial.uniforms.color = c;
        if (this._coreMaterial) this._coreMaterial.uniforms.color = c;
        if (this._wallMaterial) this._wallMaterial.uniforms.color = c;
    }

    setSpeed(_v: number) {}
    setStatus(_s: any) {}
    setLatestPositions(_d: any) {}

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const p of [this._glowPrimitive, this._corePrimitive, this._wallPrimitive]) {
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._glowPrimitive = this._corePrimitive = this._wallPrimitive = null;
    }
}
