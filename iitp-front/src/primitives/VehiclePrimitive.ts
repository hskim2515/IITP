import * as Cesium from "cesium";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import type { BufferGeometry } from "three";

type GlbAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

interface GlbMaterialBatch {
    indexOffset: number;
    indexCount: number;
    textureSource: any | null;
    baseColor: [number, number, number, number];
    alphaMode: GlbAlphaMode;
    alphaCutoff: number;
    name: string;
}

interface GlbAsset {
    verts: Float32Array;
    norms: Float32Array;
    uvs: Float32Array;
    indicesTyped: Uint16Array | Uint32Array;
    materialBatches: GlbMaterialBatch[];
}

interface GpuMaterialBatch extends GlbMaterialBatch {
    texture: any;
    hasTexture: boolean;
    drawCommand: any;
}

/**
 * GLB 인스턴싱 기반 차량 Primitive
 *
 * 핵심 구현:
 *  - RTC(Relative-to-Center): ECEF float32 정밀도 문제 해결
 *  - GPU instanced draw: 차량 인스턴스는 공유하고 GLB material별 draw batch로 렌더링
 *  - 텍스처: GLB의 mesh/material/baseColorTexture를 각 batch에 그대로 적용
 */
export default class VehiclePrimitive {
    // ─── Cesium 렌더링 리소스 ──────────────────────────────────────────────
    context: any;
    viewer: any;
    private vertexArray:          any = null;
    private shaderProgram:        any = null;
    private drawCommand:          any = null;
    private drawCommands:         any[] = [];
    private materialBatches:      GpuMaterialBatch[] = [];
    // 포인트 스프라이트 리소스는 기존 GPU 구조 호환을 위해 유지하지만 3D 화면에는 제출하지 않는다.
    private pointDummyBuffer:     any = null;
    private pointVertexArray:     any = null;
    private pointShaderProgram:   any = null;
    private drawCommandPoint:     any = null;

    destroyed = false;
    show      = false;

    // ─── 데이터 ───────────────────────────────────────────────────────────
    private paths: number[][];
    instanceCount: number;

    latestPositions?: number[][];
    latestHeadings?:  number[];

    baseColor:   [number, number, number] = [1, 1, 1];
    vehicleType  = 'default';
    glbUrl:      string;
    speed:       number;
    status:      string;
    correctionHpr: Cesium.HeadingPitchRoll;
    targetSizeM: number;
    zOffset: number;

    // ─── GPU 버퍼 ─────────────────────────────────────────────────────────
    private offsetBuffer:      any = null;
    private modelVertexBuffer: any = null;
    private modelNormalBuffer: any = null;
    private modelUvBuffer:     any = null;   // UV (per-vertex)
    private modelIndexBuffer:  any = null;
    private orientationBuffer: any = null;
    private scaleBuffer:       any = null;

    // ─── 텍스처 ───────────────────────────────────────────────────────────
    private cesiumTexture:  any = null;
    private hasTexture      = false;


    // ─── RTC 기준점 ───────────────────────────────────────────────────────
    private referenceCenter = new Cesium.Cartesian3();

    // ─── CPU 재사용 배열 ──────────────────────────────────────────────────
    private _offsetArr: Float32Array | null = null;
    private _orientArr: Float32Array | null = null;

    // ─── static scratch ───────────────────────────────────────────────────
    private static readonly _sfrom  = new Cesium.Cartesian3();
    private static readonly _shpr   = new Cesium.HeadingPitchRoll(0, 0, 0);
    private static readonly _sqBase = new Cesium.Quaternion();
    private static readonly _sqRes  = new Cesium.Quaternion();
    private static readonly _srtc   = new Cesium.Cartesian3();

    private correctionQ = new Cesium.Quaternion();
    private instanceScales: Float32Array;

    // ─── LOD 계산용 (매 프레임 update에서 갱신) ──────────────────────────
    // projScale = viewportHeight / (2 * tan(halfFovY))
    // apparentPixels = targetSizeM * instanceScale * projScale / eyeDist
    private _projScale = 300.0;

    constructor(
        paths: number[][],
        viewer: any,
        glbUrl: string,
        speed: number,
        status: string,
        correctionHpr?: Cesium.HeadingPitchRoll,
        targetSizeM = 5.0,
        zOffset = 0.0,
        scales?: number[]
    ) {
        this.viewer        = viewer;
        this.context       = viewer.scene.context;
        this.paths         = paths;
        this.instanceCount = paths.length;
        this.glbUrl        = glbUrl;
        this.speed         = speed;
        this.status        = status;
        this.show          = true;
        this.correctionHpr = correctionHpr ?? new Cesium.HeadingPitchRoll(0, 0, Math.PI);
        this.targetSizeM   = targetSizeM;
        this.zOffset       = zOffset;

        this.instanceScales = new Float32Array(paths.length);
        for (let i = 0; i < paths.length; i++) {
            const len = scales?.[i];
            this.instanceScales[i] = (len && len > 0) ? len / targetSizeM : 1.0;
        }

        this.initialize(glbUrl);
    }

    // GLB 파싱 결과(geometry+텍스처 이미지)를 glbUrl+targetSizeM 키로 캐싱한다.
    // 뷰포트 스트리밍(팬/줌마다 setSimulation() 재실행)에서 removeSimulationLayers()가 기존
    // VehiclePrimitive를 destroy()하고 addVehicleLayer()가 매번 새로 생성하는데, 그때마다
    // fetch+GLTFLoader 파싱+텍스처 디코드(네트워크/CPU 비용)를 처음부터 반복하면 그 사이
    // drawCommand가 없어 화면에 차량이 전혀 안 보이는 공백이 생긴다("시간은 가는데 차량이 사라짐").
    // 파싱된 지오메트리/이미지를 재사용하면 재생성은 GPU 버퍼 업로드만 남아 사실상 즉시 끝난다.
    private static glbAssetCache = new Map<string, Promise<GlbAsset | null>>();

    private async loadGlbAssets(glbUrl: string): Promise<GlbAsset | null> {
        // ── GLB fetch ────────────────────────────────────────────────────
        let arrayBuffer: ArrayBuffer;
        try {
            const res = await fetch(glbUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            arrayBuffer = await res.arrayBuffer();
        } catch (e) {
            console.error(`[VehiclePrimitive] GLB fetch 실패 (${glbUrl}):`, e);
            return null;
        }

        // ── GLB 파싱 (three.js GLTFLoader — geometry + material + texture) ─
        let gltf: any;
        try {
            gltf = await new Promise<any>((resolve, reject) =>
                new GLTFLoader().parse(arrayBuffer, '', resolve, reject)
            );
        } catch (e) {
            console.error('[VehiclePrimitive] GLB 파싱 실패:', e);
            return null;
        }

        // ── Mesh 수집 ─────────────────────────────────────────────────────
        const allPos:  number[] = [];
        const allNorm: number[] = [];
        const allUV:   number[] = [];
        const materialGroups = new Map<string, { material: any; indices: number[]; name: string }>();
        let vOffset = 0, hasMesh = false;

        try {
            gltf.scene.updateWorldMatrix(true, true);
            gltf.scene.traverse((child: any) => {
                if (!child.isMesh) return;
                const geo: BufferGeometry = child.geometry;
                const posA = geo.attributes.position;
                if (!posA) return;
                hasMesh = true;

                const normA = geo.attributes.normal;
                const uvA   = geo.attributes.uv;         // TEXCOORD_0
                const idxA  = geo.index;
                const m     = child.matrixWorld.elements;

                for (let v = 0; v < posA.count; v++) {
                    const px = posA.getX(v), py = posA.getY(v), pz = posA.getZ(v);
                    allPos.push(
                        m[0]*px + m[4]*py + m[8]*pz  + m[12],
                        m[1]*px + m[5]*py + m[9]*pz  + m[13],
                        m[2]*px + m[6]*py + m[10]*pz + m[14],
                    );
                    if (normA) {
                        const nx = normA.getX(v), ny = normA.getY(v), nz = normA.getZ(v);
                        allNorm.push(
                            m[0]*nx + m[4]*ny + m[8]*nz,
                            m[1]*nx + m[5]*ny + m[9]*nz,
                            m[2]*nx + m[6]*ny + m[10]*nz,
                        );
                    } else {
                        allNorm.push(0, 1, 0);
                    }

                    // UV
                    if (uvA) {
                        allUV.push(uvA.getX(v), uvA.getY(v));
                    } else {
                        allUV.push(0, 0);
                    }
                }

                const sourceIndexCount = idxA?.count ?? posA.count;
                const groups = geo.groups.length > 0
                    ? geo.groups
                    : [{ start: 0, count: sourceIndexCount, materialIndex: 0 }];
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                groups.forEach((group: any) => {
                    const material = materials[group.materialIndex ?? 0] ?? materials[0] ?? null;
                    const key = material?.uuid ?? '__default_material__';
                    let target = materialGroups.get(key);
                    if (!target) {
                        target = {
                            material,
                            indices: [],
                            name: material?.name || `material-${materialGroups.size}`,
                        };
                        materialGroups.set(key, target);
                    }

                    const end = Math.min(group.start + group.count, sourceIndexCount);
                    for (let i = group.start; i < end; i++) {
                        target.indices.push((idxA ? idxA.getX(i) : i) + vOffset);
                    }
                });
                vOffset += posA.count;
            });
        } catch (e) {
            console.error('[VehiclePrimitive] Mesh 수집 오류:', e);
            return null;
        }

        if (!hasMesh) { console.error('[VehiclePrimitive] Mesh 없음:', glbUrl); return null; }

        // ── 모델 중심화 + 자동 스케일 ────────────────────────────────────
        const vCount = allPos.length / 3;
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < vCount; i++) { cx += allPos[i*3]; cy += allPos[i*3+1]; cz += allPos[i*3+2]; }
        cx /= vCount; cy /= vCount; cz /= vCount;

        let maxR = 0;
        for (let i = 0; i < vCount; i++) {
            const dx = allPos[i*3] - cx, dy = allPos[i*3+1] - cy, dz = allPos[i*3+2] - cz;
            const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (r > maxR) maxR = r;
        }
        const sc = maxR > 0 ? (this.targetSizeM / 2) / maxR : 1.0;

        const verts = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) {
            verts[i*3]   = (allPos[i*3]   - cx) * sc;
            verts[i*3+1] = (allPos[i*3+1] - cy) * sc;
            verts[i*3+2] = (allPos[i*3+2] - cz) * sc;
        }
        const norms = new Float32Array(allNorm);
        const uvs   = new Float32Array(allUV);

        const groupedIndices: number[] = [];
        const materialBatches: GlbMaterialBatch[] = [];
        materialGroups.forEach(({ material, indices, name }) => {
            if (indices.length === 0) return;
            const indexOffset = groupedIndices.length;
            // 대형 GLB는 한 material에 수십만 index가 들어갈 수 있어 spread 사용 시
            // 브라우저 호출 스택 한도를 넘는다. 순차 복사로 안전하게 합친다.
            for (let i = 0; i < indices.length; i++) groupedIndices.push(indices[i]);

            const color = material?.color;
            const opacity = Number.isFinite(material?.opacity) ? material.opacity : 1;
            const alphaCutoff = Number.isFinite(material?.alphaTest) && material.alphaTest > 0
                ? material.alphaTest
                : 0.5;
            const alphaMode: GlbAlphaMode = material?.alphaTest > 0
                ? 'MASK'
                : (material?.transparent || opacity < 1 ? 'BLEND' : 'OPAQUE');
            const textureSource = material?.map?.image ?? material?.map?.source?.data ?? null;

            materialBatches.push({
                indexOffset,
                indexCount: indices.length,
                textureSource,
                baseColor: [color?.r ?? 1, color?.g ?? 1, color?.b ?? 1, opacity],
                alphaMode,
                alphaCutoff,
                name,
            });
        });

        if (materialBatches.length === 0 || groupedIndices.length === 0) {
            console.error('[VehiclePrimitive] material batch 없음:', glbUrl);
            return null;
        }

        const indicesTyped = vOffset > 65535
            ? new Uint32Array(groupedIndices)
            : new Uint16Array(groupedIndices);

        return { verts, norms, uvs, indicesTyped, materialBatches };
    }

    // ─── 비동기 초기화 ────────────────────────────────────────────────────
    async initialize(glbUrl: string) {
        if (this.destroyed) return;

        const first = this.paths.find(p => p.length >= 4);
        if (first) {
            this.referenceCenter.x = first[1]!;
            this.referenceCenter.y = first[2]!;
            this.referenceCenter.z = first[3]!;
        }

        const corrM = Cesium.Matrix3.fromHeadingPitchRoll(this.correctionHpr);
        Cesium.Quaternion.fromRotationMatrix(corrM, this.correctionQ);

        // targetSizeM(차종별 모델 스케일)에 따라 verts 정규화 결과가 달라지므로 캐시 키에 포함.
        const cacheKey = `${glbUrl}::${this.targetSizeM}`;
        let assetsPromise = VehiclePrimitive.glbAssetCache.get(cacheKey);
        if (!assetsPromise) {
            assetsPromise = this.loadGlbAssets(glbUrl);
            VehiclePrimitive.glbAssetCache.set(cacheKey, assetsPromise);
        }
        const parsed = await assetsPromise;
        if (this.destroyed) return;
        if (!parsed) {
            // 로드 실패 캐시는 남겨두지 않는다 — 다음 재시도(재생성)가 다시 fetch하도록.
            if (VehiclePrimitive.glbAssetCache.get(cacheKey) === assetsPromise) {
                VehiclePrimitive.glbAssetCache.delete(cacheKey);
            }
            return;
        }
        const { verts, norms, uvs, indicesTyped, materialBatches } = parsed;
        this.baseColor = materialBatches[0]
            ? materialBatches[0].baseColor.slice(0, 3) as [number, number, number]
            : [1, 1, 1];

        if (this.destroyed) return;

        // ── 초기 orientation / offset ─────────────────────────────────────
        const orientInit = new Float32Array(this.instanceCount * 4);
        for (let i = 0; i < this.instanceCount; i++) {
            const p = this.paths[i];
            const from   = new Cesium.Cartesian3(p[1], p[2], p[3]);
            const hasTwo = p.length >= 8;
            const to     = hasTwo ? new Cesium.Cartesian3(p[5], p[6], p[7]) : from;
            const h      = hasTwo ? computeHeading(from, to) : 0;
            const q      = computeOrientationQuaternion(from, h, this.correctionHpr);
            orientInit[i*4]=q.x; orientInit[i*4+1]=q.y; orientInit[i*4+2]=q.z; orientInit[i*4+3]=q.w;
        }

        const rc = this.referenceCenter;
        const offsetInit = new Float32Array(this.instanceCount * 3);
        for (let i = 0; i < this.instanceCount; i++) {
            const p = this.paths[i];
            offsetInit[i*3]   = p[1] - rc.x;
            offsetInit[i*3+1] = p[2] - rc.y;
            offsetInit[i*3+2] = p[3] - rc.z;
        }

        // ── GPU 버퍼 생성 ─────────────────────────────────────────────────
        const ctx = this.context;
        const BU  = Cesium.BufferUsage;

        this.modelVertexBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: verts,              usage: BU.STATIC_DRAW });
        this.modelNormalBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: norms,              usage: BU.STATIC_DRAW });
        this.modelUvBuffer     = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: uvs,                usage: BU.STATIC_DRAW });
        this.modelIndexBuffer  = Cesium.Buffer.createIndexBuffer({
            context: ctx, typedArray: indicesTyped,
            indexDatatype: indicesTyped instanceof Uint32Array
                ? Cesium.IndexDatatype.UNSIGNED_INT
                : Cesium.IndexDatatype.UNSIGNED_SHORT,
            usage: BU.STATIC_DRAW,
        });
        this.offsetBuffer      = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: offsetInit,         usage: BU.DYNAMIC_DRAW });
        this.orientationBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: orientInit,         usage: BU.DYNAMIC_DRAW });
        this.scaleBuffer       = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: this.instanceScales,usage: BU.STATIC_DRAW });

        this._offsetArr = new Float32Array(this.instanceCount * 3);
        this._orientArr = new Float32Array(this.instanceCount * 4);

        // ── VertexArray ──────────────────────────────────────────────────
        this.vertexArray = new Cesium.VertexArray({
            context: ctx,
            attributes: [
                // per-vertex
                { index: 0, vertexBuffer: this.modelVertexBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 1, vertexBuffer: this.modelNormalBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 2, vertexBuffer: this.modelUvBuffer,     componentsPerAttribute: 2, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                // per-instance
                { index: 3, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 4, vertexBuffer: this.orientationBuffer, componentsPerAttribute: 4, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 5, vertexBuffer: this.scaleBuffer,       componentsPerAttribute: 1, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
            ],
            indexBuffer: this.modelIndexBuffer,
        });

        // ── ShaderProgram ────────────────────────────────────────────────
        const self = this;
        this.shaderProgram = Cesium.ShaderProgram.fromCache({
            context: ctx,
            vertexShaderSource: `
                #version 300 es

                layout(location=0) in vec3 a_modelPosition;
                layout(location=1) in vec3 a_modelNormal;
                layout(location=2) in vec2 a_uv;
                layout(location=3) in vec3 a_instanceOffset;
                layout(location=4) in vec4 a_instanceOrientation;
                layout(location=5) in float a_instanceScale;

                uniform mat4  u_view;
                uniform mat4  u_projection;
                uniform vec3  u_rtcCenter;
                uniform float u_projScale;   // viewportH / (2 * tan(halfFovY))
                uniform float u_targetSizeM; // 기준 차량 크기(m)

                out vec2  v_uv;
                out float v_meshAlpha;
                out float v_apparentPx; // 화면상 차량 크기(픽셀)

                vec3 quatRotate(vec3 v, vec4 q) {
                    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
                }

                void main() {
                    vec3 instCenter = mat3(u_view) * (u_rtcCenter + a_instanceOffset);
                    float instDist  = length(instCenter);

                    // 화면상 픽셀 크기: 차량 길이(m) × projScale / 거리
                    float px = u_targetSizeM * a_instanceScale * u_projScale / max(instDist, 1.0);
                    v_apparentPx = px;

                    // 픽셀 3이하(원거리)에서 메쉬 제거, 절대 거리 20km 제한
                    if (px < 1.5 || instDist > 20000.0) {
                        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
                        v_uv        = vec2(0.0);
                        v_meshAlpha = 0.0;
                        return;
                    }

                    vec3 rotated = quatRotate(a_modelPosition * a_instanceScale, a_instanceOrientation);
                    vec3 posRel  = u_rtcCenter + a_instanceOffset + rotated;
                    vec3 posEye  = mat3(u_view) * posRel;
                    gl_Position  = u_projection * vec4(posEye, 1.0);
                    v_uv         = a_uv;
                    // 픽셀 1.5→3.5 구간에서 서서히 나타남 (포인트 페이드아웃과 자연스럽게 교차)
                    v_meshAlpha  = smoothstep(1.5, 3.5, px);
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;

                in vec2  v_uv;
                in float v_meshAlpha;
                in float v_apparentPx;
                uniform sampler2D u_texture;
                uniform vec4      u_baseColor;
                uniform bool      u_hasTexture;
                uniform bool      u_alphaMask;
                uniform float     u_alphaCutoff;

                void main() {
                    if (v_meshAlpha <= 0.0) discard;

                    vec4 materialColor = u_baseColor;
                    if (u_hasTexture) {
                        vec4 texColor = texture(u_texture, v_uv);
                        materialColor *= texColor;
                    }
                    materialColor.a *= v_meshAlpha;
                    if (u_alphaMask && materialColor.a < u_alphaCutoff) discard;
                    out_FragColor = materialColor;
                }
            `,
            attributeLocations: {
                a_modelPosition:       0,
                a_modelNormal:         1,
                a_uv:                  2,
                a_instanceOffset:      3,
                a_instanceOrientation: 4,
                a_instanceScale:       5,
            },
        });

        // ── material별 텍스처 + DrawCommand ──────────────────────────────
        const sRTC = VehiclePrimitive._srtc;
        const whiteTexture = new (Cesium as any).Texture({
            context: ctx,
            source: { width: 1, height: 1, arrayBufferView: new Uint8Array([255, 255, 255, 255]) },
            pixelFormat: (Cesium as any).PixelFormat.RGBA,
        });
        const textureBySource = new Map<any, any>();

        this.materialBatches = materialBatches.map((batch): GpuMaterialBatch => {
            let texture = whiteTexture;
            let hasTexture = false;
            if (batch.textureSource) {
                try {
                    texture = textureBySource.get(batch.textureSource);
                    if (!texture) {
                        texture = new (Cesium as any).Texture({
                            context: ctx,
                            source: batch.textureSource,
                            flipY: false,
                        });
                        textureBySource.set(batch.textureSource, texture);
                    }
                    hasTexture = true;
                } catch (e) {
                    console.warn(`[VehiclePrimitive] material 텍스처 GPU 업로드 실패 (${batch.name}):`, e);
                }
            }

            const gpuBatch = { ...batch, texture, hasTexture, drawCommand: null } as GpuMaterialBatch;
            const isBlend = batch.alphaMode === 'BLEND';
            const renderStateOptions: any = {
                depthTest: { enabled: true },
                depthMask: !isBlend,
                cull:      { enabled: false },
            };
            if (isBlend) renderStateOptions.blending = Cesium.BlendingState.ALPHA_BLEND;

            gpuBatch.drawCommand = new Cesium.DrawCommand({
                vertexArray:   this.vertexArray,
                shaderProgram: this.shaderProgram,
                uniformMap: {
                    u_view:       () => ctx.uniformState.view,
                    u_projection: () => ctx.uniformState.projection,
                    u_rtcCenter: () => {
                        const cam = self.viewer.scene.camera.positionWC;
                        sRTC.x = self.referenceCenter.x - cam.x;
                        sRTC.y = self.referenceCenter.y - cam.y;
                        sRTC.z = self.referenceCenter.z - cam.z;
                        return sRTC;
                    },
                    u_baseColor: () => new Cesium.Cartesian4(
                        gpuBatch.baseColor[0], gpuBatch.baseColor[1],
                        gpuBatch.baseColor[2], gpuBatch.baseColor[3],
                    ),
                    u_texture:     () => gpuBatch.texture,
                    u_hasTexture:  () => gpuBatch.hasTexture,
                    u_alphaMask:   () => gpuBatch.alphaMode === 'MASK',
                    u_alphaCutoff: () => gpuBatch.alphaCutoff,
                    u_projScale:   () => self._projScale,
                    u_targetSizeM: () => self.targetSizeM,
                },
                primitiveType: Cesium.PrimitiveType.TRIANGLES,
                offset:        batch.indexOffset,
                count:         batch.indexCount,
                instanceCount: this.instanceCount,
                pass:          isBlend ? Cesium.Pass.TRANSLUCENT : Cesium.Pass.OPAQUE,
                renderState:   Cesium.RenderState.fromCache(renderStateOptions),
            });
            return gpuBatch;
        });
        this.drawCommands = this.materialBatches.map(batch => batch.drawCommand);
        this.drawCommand = this.drawCommands[0] ?? null;
        this.cesiumTexture = whiteTexture;
        this.hasTexture = this.materialBatches.some(batch => batch.hasTexture);

        // ── 포인트 스프라이트 DrawCommand (원거리 LOD) ──────────────────
        // 더미 버텍스 1개 + offsetBuffer(instance) 로 구성
        this.pointDummyBuffer = Cesium.Buffer.createVertexBuffer({
            context: ctx,
            typedArray: new Float32Array([0, 0, 0]),
            usage: BU.STATIC_DRAW,
        });

        this.pointVertexArray = new Cesium.VertexArray({
            context: ctx,
            attributes: [
                { index: 0, vertexBuffer: this.pointDummyBuffer,  componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 1, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 2, vertexBuffer: this.scaleBuffer,       componentsPerAttribute: 1, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
            ],
        });

        this.pointShaderProgram = Cesium.ShaderProgram.fromCache({
            context: ctx,
            vertexShaderSource: `
                #version 300 es

                layout(location=0) in vec3  a_dummy;
                layout(location=1) in vec3  a_instanceOffset;
                layout(location=2) in float a_instanceScale;

                uniform mat4  u_view;
                uniform mat4  u_projection;
                uniform vec3  u_rtcCenter;
                uniform float u_projScale;
                uniform float u_targetSizeM;

                out float v_pointAlpha;
                out float v_pointSize;

                void main() {
                    vec3 instEye  = mat3(u_view) * (u_rtcCenter + a_instanceOffset);
                    float instDist = length(instEye);

                    // 화면상 픽셀 크기 (인스턴스 스케일 반영)
                    float px = u_targetSizeM * a_instanceScale * u_projScale / max(instDist, 1.0);

                    // 픽셀 8 이상이면 메쉬가 담당 → 포인트 클리핑
                    // 절대 거리 20km 초과도 제거
                    if (px > 8.0 || instDist > 20000.0) {
                        gl_Position  = vec4(2.0, 2.0, 0.0, 1.0);
                        gl_PointSize = 1.0;
                        v_pointAlpha = 0.0;
                        v_pointSize  = 1.0;
                        return;
                    }

                    gl_Position  = u_projection * vec4(instEye, 1.0);
                    // 포인트 크기 = 화면 픽셀 크기의 절반 (너무 크지 않게), 최소 2px
                    float pSize  = clamp(px * 0.6, 2.0, 8.0);
                    gl_PointSize = pSize;
                    v_pointSize  = pSize;

                    // 픽셀 4~8 구간에서 메쉬와 교차 페이드 (px=4 → alpha=1, px=8 → alpha=0)
                    float nearFade = 1.0 - smoothstep(15000.0, 20000.0, instDist); // 원거리 감쇠
                    v_pointAlpha = smoothstep(8.0, 4.0, px) * nearFade;
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision mediump float;

                uniform vec3  u_baseColor;
                in float v_pointAlpha;
                in float v_pointSize;
                void main() {
                    if (v_pointAlpha <= 0.0) discard;
                    // 원형 점 (pointSize가 작을수록 가장자리 부드럽게)
                    float r = length(gl_PointCoord - vec2(0.5));
                    float edge = 0.5 - max(0.5 / v_pointSize, 0.05);
                    float alpha = v_pointAlpha * (1.0 - smoothstep(edge, 0.5, r));
                    if (alpha <= 0.0) discard;
                    out_FragColor = vec4(u_baseColor, alpha);
                }
            `,
            attributeLocations: {
                a_dummy:          0,
                a_instanceOffset: 1,
                a_instanceScale:  2,
            },
        });

        this.drawCommandPoint = new Cesium.DrawCommand({
            vertexArray:   this.pointVertexArray,
            shaderProgram: this.pointShaderProgram,
            uniformMap: {
                u_view:      () => ctx.uniformState.view,
                u_projection:() => ctx.uniformState.projection,
                u_rtcCenter: () => {
                    const cam = self.viewer.scene.camera.positionWC;
                    sRTC.x = self.referenceCenter.x - cam.x;
                    sRTC.y = self.referenceCenter.y - cam.y;
                    sRTC.z = self.referenceCenter.z - cam.z;
                    return sRTC;
                },
                u_baseColor:   () => new Cesium.Cartesian3(self.baseColor[0], self.baseColor[1], self.baseColor[2]),
                u_projScale:   () => self._projScale,
                u_targetSizeM: () => self.targetSizeM,
            },
            primitiveType: Cesium.PrimitiveType.POINTS,
            count:         1,
            instanceCount: this.instanceCount,
            pass:          Cesium.Pass.OPAQUE,
            renderState:   Cesium.RenderState.fromCache({
                depthTest: { enabled: true },
                cull:      { enabled: false },
                blending:  Cesium.BlendingState.ALPHA_BLEND,
            }),
        });

        console.log(
            `[VehiclePrimitive] 초기화 완료: type=${this.vehicleType}`
            + ` materials=${this.materialBatches.length}`
            + ` textures=${this.materialBatches.filter(batch => batch.hasTexture).length}`
            + ` count=${this.instanceCount}`,
        );
    }

    /**
     * 같은 GLB(geometry/셰이더/텍스처)를 유지한 채 인스턴스 데이터(경로/개수/스케일)만 교체한다.
     * destroy() 후 새 VehiclePrimitive를 생성하는 대신 이 메서드로 갱신하면 GLB fetch/파싱/텍스처
     * 디코드를 건너뛸 수 있어, 뷰포트 재로드(팬/줌·재생 시간창 롤오버)마다 차량이 순간적으로
     * 사라지는 "나타났다 사라졌다" 현상의 근본 원인(매번 전체 destroy+재생성)을 없앤다.
     * 아직 initialize()가 끝나지 않았으면(vertexArray 없음) 필드만 갱신 — initialize()가 완료
     * 시점의 this.paths/instanceScales를 그대로 읽어 처음부터 올바르게 구성한다.
     */
    updateInstances(paths: number[][], scales?: number[]): void {
        if (this.destroyed) return;

        this.paths          = paths;
        this.instanceCount   = paths.length;
        this.instanceScales  = new Float32Array(paths.length);
        for (let i = 0; i < paths.length; i++) {
            const len = scales?.[i];
            this.instanceScales[i] = (len && len > 0) ? len / this.targetSizeM : 1.0;
        }

        if (!this.vertexArray) return; // 초기 GPU 리소스 준비 전 — initialize()가 이어서 처리

        // RTC 기준점 재계산 — 뷰포트가 이동해 새 인스턴스 집합이 멀어졌을 수 있음
        const first = this.paths.find(p => p.length >= 4);
        if (first) {
            this.referenceCenter.x = first[1]!;
            this.referenceCenter.y = first[2]!;
            this.referenceCenter.z = first[3]!;
        }
        const rc = this.referenceCenter;

        const orientInit = new Float32Array(this.instanceCount * 4);
        for (let i = 0; i < this.instanceCount; i++) {
            const p = this.paths[i];
            const from   = new Cesium.Cartesian3(p[1], p[2], p[3]);
            const hasTwo = p.length >= 8;
            const to     = hasTwo ? new Cesium.Cartesian3(p[5], p[6], p[7]) : from;
            const h      = hasTwo ? computeHeading(from, to) : 0;
            const q      = computeOrientationQuaternion(from, h, this.correctionHpr);
            orientInit[i*4]=q.x; orientInit[i*4+1]=q.y; orientInit[i*4+2]=q.z; orientInit[i*4+3]=q.w;
        }
        const offsetInit = new Float32Array(this.instanceCount * 3);
        for (let i = 0; i < this.instanceCount; i++) {
            const p = this.paths[i];
            offsetInit[i*3]   = p[1] - rc.x;
            offsetInit[i*3+1] = p[2] - rc.y;
            offsetInit[i*3+2] = p[3] - rc.z;
        }

        const ctx = this.context;
        const BU  = Cesium.BufferUsage;

        this.offsetBuffer?.destroy();
        this.orientationBuffer?.destroy();
        this.scaleBuffer?.destroy();
        this.offsetBuffer      = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: offsetInit,          usage: BU.DYNAMIC_DRAW });
        this.orientationBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: orientInit,          usage: BU.DYNAMIC_DRAW });
        this.scaleBuffer       = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: this.instanceScales, usage: BU.STATIC_DRAW });

        this._offsetArr = new Float32Array(this.instanceCount * 3);
        this._orientArr = new Float32Array(this.instanceCount * 4);

        // 주의: 여기서 구 vertexArray/pointVertexArray를 destroy()하면 안 된다 — Cesium의
        // VertexArray.destroy()는 자신의 attributes에 연결된 vertexBuffer/indexBuffer를 전부
        // 연쇄적으로 destroy()한다. 그 목록엔 위에서 이미 destroy()한 구 offset/orientation/
        // scale 버퍼(→ 이중 destroy로 DeveloperError)뿐 아니라, 계속 재사용해야 하는 공유
        // geometry 버퍼(modelVertexBuffer 등, GLB 파싱 결과)까지 포함되어 있다. 구 VertexArray
        // 참조를 그냥 교체(아래)만 하고 GC에 맡긴다 — 완전 정리는 destroy()(전체 폐기)에서만 수행.
        this.vertexArray = new Cesium.VertexArray({
            context: ctx,
            attributes: [
                { index: 0, vertexBuffer: this.modelVertexBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 1, vertexBuffer: this.modelNormalBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 2, vertexBuffer: this.modelUvBuffer,     componentsPerAttribute: 2, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 3, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 4, vertexBuffer: this.orientationBuffer, componentsPerAttribute: 4, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 5, vertexBuffer: this.scaleBuffer,       componentsPerAttribute: 1, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
            ],
            indexBuffer: this.modelIndexBuffer,
        });

        this.pointVertexArray = new Cesium.VertexArray({
            context: ctx,
            attributes: [
                { index: 0, vertexBuffer: this.pointDummyBuffer,  componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 1, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 2, vertexBuffer: this.scaleBuffer,       componentsPerAttribute: 1, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
            ],
        });

        this.drawCommands.forEach(command => {
            command.vertexArray = this.vertexArray;
            command.instanceCount = this.instanceCount;
        });
        if (this.drawCommandPoint) {
            this.drawCommandPoint.vertexArray   = this.pointVertexArray;
            this.drawCommandPoint.instanceCount = this.instanceCount;
        }

        // 새 인스턴스 개수에 맞는 위치가 아직 없다 — 다음 setLatestPositions까지 이전(구 개수)
        // latestPositions를 남겨두면 update()에서 개수 불일치로 어긋난 렌더가 나올 수 있어 비운다.
        // (곧바로 이어지는 worker 'init' 응답이 즉시 채워준다 — czmlPositionWorker 참고)
        this.latestPositions = undefined;
        this.latestHeadings  = undefined;
    }

    // ─── 매 프레임 호출 ───────────────────────────────────────────────────
    update(frameState: any) {
        if (this.destroyed || !this.show) return;
        if (!this.drawCommand || !this.offsetBuffer || !this.orientationBuffer) return;
        if (!this.drawCommandPoint) return;
        if (!this._offsetArr || !this._orientArr) return;

        const positions = this.latestPositions;
        if (!positions || positions.length === 0) return;

        const headings = this.latestHeadings;
        const rc       = this.referenceCenter;
        const corrQ    = this.correctionQ;
        const count    = positions.length;

        const sfrom  = VehiclePrimitive._sfrom;
        const shpr   = VehiclePrimitive._shpr;
        const sqBase = VehiclePrimitive._sqBase;
        const sqRes  = VehiclePrimitive._sqRes;

        const zo = this.zOffset;
        for (let i = 0; i < count; i++) {
            const p = positions[i];

            let px = p[0], py = p[1], pz = p[2];
            if (zo !== 0) {
                const r = Math.sqrt(px * px + py * py + pz * pz);
                if (r > 0) {
                    const inv = zo / r;
                    px += px * inv;
                    py += py * inv;
                    pz += pz * inv;
                }
            }

            this._offsetArr[i*3]   = px - rc.x;
            this._offsetArr[i*3+1] = py - rc.y;
            this._offsetArr[i*3+2] = pz - rc.z;

            sfrom.x = p[0]!; sfrom.y = p[1]!; sfrom.z = p[2]!;
            shpr.heading = headings?.[i] ?? 0;
            shpr.pitch   = 0;
            shpr.roll    = 0;
            Cesium.Transforms.headingPitchRollQuaternion(sfrom, shpr, Cesium.Ellipsoid.WGS84, undefined, sqBase);
            Cesium.Quaternion.multiply(sqBase, corrQ, sqRes);

            this._orientArr[i*4]   = sqRes.x;
            this._orientArr[i*4+1] = sqRes.y;
            this._orientArr[i*4+2] = sqRes.z;
            this._orientArr[i*4+3] = sqRes.w;
        }

        this.offsetBuffer.copyFromArrayView(this._offsetArr.subarray(0, count * 3));
        this.orientationBuffer.copyFromArrayView(this._orientArr.subarray(0, count * 4));

        this.drawCommands.forEach(command => { command.instanceCount = count; });
        this.drawCommandPoint.instanceCount = count;

        // ─ projScale 갱신 ─────────────────────────────────────────────────
        // projScale = viewportHeight / (2 * tan(halfFovY))
        // 이 값이 클수록 화면이 크거나 FOV가 좁아서 차량이 더 크게 보임
        const scene = this.viewer.scene;
        const frustum = scene.camera.frustum as any;
        const fovY: number = frustum.fovy ?? frustum.fov ?? (Math.PI / 3);
        const vh = Math.max(1, scene.drawingBufferHeight);
        this._projScale = vh / (2.0 * Math.tan(fovY / 2));

        // 3D는 GLB만 표시한다. 사용자 지정 색상 포인트는 2D VehicleFeatureLayer의 책임이다.
        this.drawCommands.forEach(command => frameState.commandList.push(command));
    }

    // ─── 외부 인터페이스 ──────────────────────────────────────────────────
    setLatestPositions(data: { positions: number[][]; headings: number[] }) {
        // (참고: positions.length는 "이 순간 활성 차량 수", instanceCount는 "창에서 선별된 전체
        // 차량 수"라 원래 다르다 — 선별 차량의 평균 체류시간이 창 길이보다 짧으면 항상 작게 나옴.
        // 디버깅용 불일치 경고는 오탐 소지가 커서 제거함.)
        this.latestPositions = data.positions;
        this.latestHeadings  = data.headings;
    }

    setSpeed(speed: number)   { this.speed  = speed;  }
    setStatus(status: string) { this.status = status; }

    setCorrectionHpr(hpr: Cesium.HeadingPitchRoll) {
        this.correctionHpr = hpr;
        const corrM = Cesium.Matrix3.fromHeadingPitchRoll(hpr);
        Cesium.Quaternion.fromRotationMatrix(corrM, this.correctionQ);
    }

    // ─── 정리 ─────────────────────────────────────────────────────────────
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        this.drawCommands.forEach(command => { command.vertexArray = null; });
        if (this.drawCommandPoint) this.drawCommandPoint.vertexArray = null;
        this.modelVertexBuffer = null;
        this.modelNormalBuffer = null;
        this.modelUvBuffer     = null;
        this.modelIndexBuffer  = null;
        this.offsetBuffer      = null;
        this.orientationBuffer = null;
        this.scaleBuffer       = null;
        this.vertexArray?.destroy();
        this.shaderProgram?.destroy();
        this.pointDummyBuffer?.destroy();
        this.pointVertexArray?.destroy();
        this.pointShaderProgram?.destroy();
        const textures = new Set<any>();
        this.materialBatches.forEach(batch => textures.add(batch.texture));
        if (this.cesiumTexture) textures.add(this.cesiumTexture);
        textures.forEach(texture => {
            if (texture && !texture.isDestroyed?.()) texture.destroy?.();
        });
        this.materialBatches = [];
        this.drawCommands = [];
        this.cesiumTexture = null;

        this._offsetArr = null;
        this._orientArr = null;
    }
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────

function computeHeading(from: Cesium.Cartesian3, to: Cesium.Cartesian3): number {
    const fc = Cesium.Ellipsoid.WGS84.cartesianToCartographic(from);
    const tc = Cesium.Ellipsoid.WGS84.cartesianToCartographic(to);
    const dLon = tc.longitude - fc.longitude;
    const y = Math.sin(dLon) * Math.cos(tc.latitude);
    const x = Math.cos(fc.latitude) * Math.sin(tc.latitude)
        - Math.sin(fc.latitude) * Math.cos(tc.latitude) * Math.cos(dLon);
    return Math.atan2(y, x);
}

function computeOrientationQuaternion(
    position:      Cesium.Cartesian3,
    heading:       number,
    correctionHpr: Cesium.HeadingPitchRoll,
): Cesium.Quaternion {
    const baseQ = Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(heading, 0, 0),
    );
    const corrM = Cesium.Matrix3.fromHeadingPitchRoll(correctionHpr);
    const corrQ = Cesium.Quaternion.fromRotationMatrix(corrM);
    return Cesium.Quaternion.multiply(baseQ, corrQ, new Cesium.Quaternion());
}
