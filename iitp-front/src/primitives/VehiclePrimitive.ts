import * as Cesium from "cesium";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import type { BufferGeometry } from "three";

/**
 * GLB 인스턴싱 기반 차량 Primitive
 *
 * 핵심 구현:
 *  - RTC(Relative-to-Center): ECEF float32 정밀도 문제 해결
 *  - GPU instanced draw: 모든 인스턴스 1회 DrawCall
 *  - 텍스처: 차종별로 분리된 GLB 파일의 첫 번째 material 텍스처를 그대로 사용
 */
export default class VehiclePrimitive {
    // ─── Cesium 렌더링 리소스 ──────────────────────────────────────────────
    context: any;
    viewer: any;
    private vertexArray:          any = null;
    private shaderProgram:        any = null;
    private drawCommand:          any = null;
    // LOD: 포인트 스프라이트 (원거리)
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

        // ── GLB fetch ────────────────────────────────────────────────────
        let arrayBuffer: ArrayBuffer;
        try {
            const res = await fetch(glbUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            arrayBuffer = await res.arrayBuffer();
        } catch (e) {
            console.error(`[VehiclePrimitive] GLB fetch 실패 (${glbUrl}):`, e);
            return;
        }
        if (this.destroyed) return;

        // ── GLB 바이너리 직접 파싱 (텍스처 추출용) ──────────────────────
        const glbJson = this.parseGLBJson(arrayBuffer);
        const binOffset = this.getGLBBinOffset(arrayBuffer);

        // ── GLB 파싱 (three.js GLTFLoader — geometry + UV) ───────────────
        let gltf: any;
        try {
            gltf = await new Promise<any>((resolve, reject) =>
                new GLTFLoader().parse(arrayBuffer, '', resolve, reject)
            );
        } catch (e) {
            console.error('[VehiclePrimitive] GLB 파싱 실패:', e);
            return;
        }
        if (this.destroyed) return;

        // ── Mesh 수집 ─────────────────────────────────────────────────────
        const allPos:  number[] = [];
        const allNorm: number[] = [];
        const allUV:   number[] = [];
        const allIdx:  number[] = [];
        let vOffset = 0, hasMesh = false, hasUV = false;

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
                        hasUV = true;
                    } else {
                        allUV.push(0, 0);
                    }
                }

                if (idxA) { for (let i = 0; i < idxA.count; i++) allIdx.push(idxA.getX(i) + vOffset); }
                else       { for (let i = 0; i < posA.count; i++) allIdx.push(i + vOffset); }
                vOffset += posA.count;
            });
        } catch (e) {
            console.error('[VehiclePrimitive] Mesh 수집 오류:', e);
            return;
        }

        if (!hasMesh) { console.error('[VehiclePrimitive] Mesh 없음:', glbUrl); return; }
        if (this.destroyed) return;

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

        const indicesTyped = vOffset > 65535
            ? new Uint32Array(allIdx)
            : new Uint16Array(allIdx);

        // ── 텍스처 로드 (GLB 바이너리에서 차종별 이미지 추출) ────────────
        if (hasUV && glbJson && binOffset >= 0) {
            try {
                const img = await this.extractTextureImage(glbJson, arrayBuffer, binOffset);
                if (img && !this.destroyed) {
                    this.cesiumTexture = new (Cesium as any).Texture({
                        context: this.context,
                        source:  img,
                        flipY:   false,  // three.js가 이미 V좌표를 반전하므로 이중 반전 방지
                    });
                    this.hasTexture = true;
                }
            } catch (e) {
                console.warn('[VehiclePrimitive] 텍스처 추출 실패, baseColor 사용:', e);
            }
        }

        // 텍스처 없을 때 1×1 흰색 더미 — UniformSampler에 null이 들어가면 Cesium이 크래시
        if (!this.cesiumTexture) {
            this.cesiumTexture = new (Cesium as any).Texture({
                context: this.context,
                source: { width: 1, height: 1, arrayBufferView: new Uint8Array([255, 255, 255, 255]) },
                pixelFormat: (Cesium as any).PixelFormat.RGBA,
            });
        }

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
                uniform vec3      u_baseColor;
                uniform bool      u_hasTexture;

                out vec4 fragColor;

                void main() {
                    if (v_meshAlpha <= 0.0) discard;

                    vec4 colorOnly = vec4(u_baseColor, 0.9 * v_meshAlpha);
                    if (u_hasTexture) {
                        // 8px 이하: 색상만, 16px 이상: 텍스처
                        // (줌 레벨·뷰포트 크기에 무관하게 항상 적절한 품질)
                        float texWeight = smoothstep(8.0, 16.0, v_apparentPx);
                        vec4 texColor = texture(u_texture, v_uv);
                        texColor.a   *= v_meshAlpha;
                        fragColor = mix(colorOnly, texColor, texWeight);
                    } else {
                        fragColor = colorOnly;
                    }
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

        // ── DrawCommand ──────────────────────────────────────────────────
        const sRTC = VehiclePrimitive._srtc;

        this.drawCommand = new Cesium.DrawCommand({
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
                u_baseColor:   () => new Cesium.Cartesian3(self.baseColor[0], self.baseColor[1], self.baseColor[2]),
                u_texture:     () => self.cesiumTexture,
                u_hasTexture:  () => self.hasTexture,
                u_projScale:   () => self._projScale,
                u_targetSizeM: () => self.targetSizeM,
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            count:         indicesTyped.length,
            instanceCount: this.instanceCount,
            pass:          Cesium.Pass.OPAQUE,
            renderState:   Cesium.RenderState.fromCache({
                depthTest: { enabled: true },
                cull:      { enabled: false },
                blending:  Cesium.BlendingState.ALPHA_BLEND,
            }),
        });

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
                out vec4 fragColor;

                void main() {
                    if (v_pointAlpha <= 0.0) discard;
                    // 원형 점 (pointSize가 작을수록 가장자리 부드럽게)
                    float r = length(gl_PointCoord - vec2(0.5));
                    float edge = 0.5 - max(0.5 / v_pointSize, 0.05);
                    float alpha = v_pointAlpha * (1.0 - smoothstep(edge, 0.5, r));
                    if (alpha <= 0.0) discard;
                    fragColor = vec4(u_baseColor, alpha);
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

        console.log(`[VehiclePrimitive] 초기화 완료: type=${this.vehicleType} texture=${this.hasTexture} count=${this.instanceCount}`);
    }

    // ─── GLB 파싱 유틸 ────────────────────────────────────────────────────

    /** GLB JSON 청크 파싱 */
    private parseGLBJson(arrayBuffer: ArrayBuffer): any | null {
        try {
            const dv = new DataView(arrayBuffer);
            const chunk0Len = dv.getUint32(12, true);
            const jsonBytes = new Uint8Array(arrayBuffer, 20, chunk0Len);
            return JSON.parse(new TextDecoder().decode(jsonBytes));
        } catch {
            return null;
        }
    }

    /** GLB 바이너리 청크 시작 오프셋 */
    private getGLBBinOffset(arrayBuffer: ArrayBuffer): number {
        const dv = new DataView(arrayBuffer);
        const chunk0Len = dv.getUint32(12, true);
        return 20 + chunk0Len + 8; // JSON chunk + bin chunk header(8)
    }

    /**
     * GLB 바이너리에서 텍스처 이미지 추출.
     * GLB가 차종별로 분리되어 있으므로 첫 번째 material의 텍스처를 그대로 사용.
     */
    private async extractTextureImage(
        gltfJson: any,
        arrayBuffer: ArrayBuffer,
        binOffset: number
    ): Promise<HTMLImageElement | null> {
        // 첫 번째 mesh primitive의 material 사용
        const matIndex = gltfJson.meshes?.[0]?.primitives?.[0]?.material ?? 0;

        const texIndex = gltfJson.materials?.[matIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
        if (texIndex === undefined) return null;

        const imgIndex = gltfJson.textures?.[texIndex]?.source;
        if (imgIndex === undefined) return null;

        const imgDef = gltfJson.images?.[imgIndex];
        if (imgDef?.bufferView === undefined) return null;

        const bv = gltfJson.bufferViews[imgDef.bufferView];
        const imgBytes = new Uint8Array(arrayBuffer, binOffset + (bv.byteOffset ?? 0), bv.byteLength);
        const blob = new Blob([imgBytes], { type: imgDef.mimeType ?? 'image/png' });
        const url  = URL.createObjectURL(blob);

        return new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
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

        this.drawCommand.instanceCount      = count;
        this.drawCommandPoint.instanceCount = count;

        // ─ projScale 갱신 ─────────────────────────────────────────────────
        // projScale = viewportHeight / (2 * tan(halfFovY))
        // 이 값이 클수록 화면이 크거나 FOV가 좁아서 차량이 더 크게 보임
        const scene = this.viewer.scene;
        const frustum = scene.camera.frustum as any;
        const fovY: number = frustum.fovy ?? frustum.fov ?? (Math.PI / 3);
        const vh = Math.max(1, scene.drawingBufferHeight);
        this._projScale = vh / (2.0 * Math.tan(fovY / 2));

        // 메쉬/포인트 LOD 전환은 각 셰이더가 인스턴스별 거리(instDist)로 처리하므로
        // 두 DrawCommand를 항상 함께 제출한다.
        // (이전에는 referenceCenter 한 점까지의 거리로 일괄 제출 여부를 결정했는데,
        //  차량들이 referenceCenter에서 먼 곳까지 퍼지면서 그 근처 차량은 메쉬 미제출 +
        //  포인트는 자체 셰이더 로직(가까우면 숨김)으로 숨겨져 아예 안 보이는 문제가 있었음)
        frameState.commandList.push(this.drawCommand);
        frameState.commandList.push(this.drawCommandPoint);
    }

    // ─── 외부 인터페이스 ──────────────────────────────────────────────────
    setLatestPositions(data: { positions: number[][]; headings: number[] }) {
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

        if (this.drawCommand) this.drawCommand.vertexArray = null;
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
        this.cesiumTexture?.destroy();
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
