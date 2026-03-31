import * as Cesium from "cesium";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import type { BufferGeometry } from "three";

/**
 * GLB 인스턴싱 기반 차량 Primitive
 *
 * 핵심 구현:
 *  - RTC(Relative-to-Center): ECEF float32 정밀도 문제 해결
 *    · instanceOffset = position - referenceCenter  (작은 값, float32 OK)
 *    · u_rtcCenter    = referenceCenter - cameraEye (JS double 연산 후 float32)
 *    · shader: posEye = mat3(view) * (rtcCenter + offset + rotatedModel)
 *  - GPU instanced draw: 모든 인스턴스 1회 DrawCall
 *  - scratch 객체 재사용: 매 프레임 GC 방지
 *  - GLB 자동 스케일: 목표 크기(targetSizeM)에 맞게 자동 조정
 */
export default class VehiclePrimitive {
    // ─── Cesium 렌더링 리소스 ──────────────────────────────────────────────
    context: any;
    viewer: any;
    private vertexArray:       any = null;
    private shaderProgram:     any = null;
    private drawCommand:       any = null;

    destroyed = false;
    show      = false;

    // ─── 데이터 ───────────────────────────────────────────────────────────
    /** paths[i] = [t,x,y,z, t,x,y,z, ...] flat ECEF 배열 (vehicle i) */
    private paths: number[][];
    instanceCount: number;

    latestPositions?: number[][];   // [x, y, z] ECEF
    latestHeadings?:  number[];     // ENU 기준 north=0, 시계방향
    private _stopped = false;

    baseColor:   [number, number, number] = [1, 1, 1];
    vehicleType  = 'default';
    speed:       number;
    status:      string;
    correctionHpr: Cesium.HeadingPitchRoll;
    /** 목표 차량 크기(m). GLB 모델이 이 크기로 자동 스케일됩니다. */
    targetSizeM: number;
    /** ENU Up 방향 높이 보정(m). 양수=위로 올림 */
    zOffset: number;

    // ─── GPU 버퍼 ─────────────────────────────────────────────────────────
    private offsetBuffer:      any = null;   // RTC offset (instance)
    private modelVertexBuffer: any = null;
    private modelNormalBuffer: any = null;
    private modelIndexBuffer:  any = null;
    private orientationBuffer: any = null;

    // ─── RTC 기준점 (ECEF) ────────────────────────────────────────────────
    private referenceCenter = new Cesium.Cartesian3();

    // ─── CPU 재사용 배열 (GC 방지) ────────────────────────────────────────
    private _offsetArr: Float32Array | null = null;
    private _orientArr: Float32Array | null = null;

    // ─── 프레임당 scratch 객체 (static, 인스턴스 공유) ──────────────────
    private static readonly _sfrom = new Cesium.Cartesian3();
    private static readonly _shpr  = new Cesium.HeadingPitchRoll(0, 0, 0);
    private static readonly _sqBase = new Cesium.Quaternion();
    private static readonly _sqRes  = new Cesium.Quaternion();
    private static readonly _srtc   = new Cesium.Cartesian3();

    // correctionHpr → Quaternion (initialize() 에서 1회 계산)
    private correctionQ = new Cesium.Quaternion();

    // ─── 생성자 ───────────────────────────────────────────────────────────
    constructor(
        paths: number[][],
        viewer: any,
        glbUrl: string,
        speed: number,
        status: string,
        correctionHpr?: Cesium.HeadingPitchRoll,
        targetSizeM = 5.0,
        zOffset = 0.0
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

        console.log(`[VehiclePrimitive] correctionHpr H=${this.correctionHpr.heading.toFixed(3)} P=${this.correctionHpr.pitch.toFixed(3)} R=${this.correctionHpr.roll.toFixed(3)}`);

        this.initialize(glbUrl);
    }

    // ─── 비동기 초기화 ────────────────────────────────────────────────────
    async initialize(glbUrl: string) {
        if (this.destroyed) return;

        // RTC 기준점: 첫 번째 유효 waypoint
        const first = this.paths.find(p => p.length >= 4);
        if (first) {
            this.referenceCenter.x = first[1];
            this.referenceCenter.y = first[2];
            this.referenceCenter.z = first[3];
        }

        // correctionHpr → Quaternion (고정, 1회만 계산)
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

        // ── GLB 파싱 (three.js GLTFLoader) ──────────────────────────────
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

        // ── Mesh 수집 (world transform 적용, 복수 mesh 병합) ─────────────
        const allPos: number[]  = [];
        const allNorm: number[] = [];
        const allIdx: number[]  = [];
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

        // bounding sphere 반지름 계산 → targetSizeM에 맞게 스케일
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

        const indicesTyped = vOffset > 65535
            ? new Uint32Array(allIdx)
            : new Uint16Array(allIdx);

        // ── 초기 orientation 계산 ─────────────────────────────────────────
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

        // ── 초기 RTC offset 계산 ─────────────────────────────────────────
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

        this.modelVertexBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: verts,       usage: BU.STATIC_DRAW });
        this.modelNormalBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: norms,       usage: BU.STATIC_DRAW });
        this.modelIndexBuffer  = Cesium.Buffer.createIndexBuffer({
            context: ctx, typedArray: indicesTyped,
            indexDatatype: indicesTyped instanceof Uint32Array
                ? Cesium.IndexDatatype.UNSIGNED_INT
                : Cesium.IndexDatatype.UNSIGNED_SHORT,
            usage: BU.STATIC_DRAW,
        });
        this.offsetBuffer      = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: offsetInit, usage: BU.DYNAMIC_DRAW });
        this.orientationBuffer = Cesium.Buffer.createVertexBuffer({ context: ctx, typedArray: orientInit, usage: BU.DYNAMIC_DRAW });

        // CPU 재사용 배열
        this._offsetArr = new Float32Array(this.instanceCount * 3);
        this._orientArr = new Float32Array(this.instanceCount * 4);

        // ── VertexArray ──────────────────────────────────────────────────
        this.vertexArray = new Cesium.VertexArray({
            context: ctx,
            attributes: [
                // 모델 geometry (per-vertex)
                { index: 0, vertexBuffer: this.modelVertexBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                { index: 1, vertexBuffer: this.modelNormalBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                // 인스턴스 데이터 (per-instance, instanceDivisor=1)
                { index: 2, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                { index: 3, vertexBuffer: this.orientationBuffer, componentsPerAttribute: 4, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
            ],
            indexBuffer: this.modelIndexBuffer,
        });

        // ── ShaderProgram ────────────────────────────────────────────────
        //
        // RTC 렌더링 원리:
        //   posRel  = u_rtcCenter + a_instanceOffset + rotatedModel
        //           = (refCenter - cameraEye) + (position - refCenter) + model
        //           = position - cameraEye + model   ← camera-relative (정밀)
        //   posEye  = mat3(u_view) * posRel           ← view 회전만 적용 (translation 불필요)
        //   clip    = u_projection * vec4(posEye, 1)
        //
        this.shaderProgram = Cesium.ShaderProgram.fromCache({
            context: ctx,
            vertexShaderSource: `
                #version 300 es

                layout(location=0) in vec3 a_modelPosition;
                layout(location=1) in vec3 a_modelNormal;
                layout(location=2) in vec3 a_instanceOffset;       // position - referenceCenter
                layout(location=3) in vec4 a_instanceOrientation;  // WXYZ quaternion

                uniform mat4 u_view;
                uniform mat4 u_projection;
                uniform vec3 u_rtcCenter;   // referenceCenter - cameraEye (JS double → float32)

                // quaternion 회전
                vec3 quatRotate(vec3 v, vec4 q) {
                    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
                }

                void main() {
                    // 모델 정점 회전
                    vec3 rotated = quatRotate(a_modelPosition, a_instanceOrientation);

                    // camera-relative 위치 (RTC: 정밀도 보존)
                    vec3 posRel = u_rtcCenter + a_instanceOffset + rotated;

                    // view 회전만 적용 (mat3 = upper-left 3x3, translation 없음)
                    vec3 posEye = mat3(u_view) * posRel;

                    gl_Position = u_projection * vec4(posEye, 1.0);
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;
                uniform vec3 u_baseColor;
                out vec4 fragColor;
                void main() {
                    fragColor = vec4(u_baseColor, 0.9);
                }
            `,
            attributeLocations: {
                a_modelPosition:    0,
                a_modelNormal:      1,
                a_instanceOffset:   2,
                a_instanceOrientation: 3,
            },
        });

        // ── DrawCommand ──────────────────────────────────────────────────
        const self = this;
        const sRTC = VehiclePrimitive._srtc;

        this.drawCommand = new Cesium.DrawCommand({
            vertexArray:   this.vertexArray,
            shaderProgram: this.shaderProgram,
            uniformMap: {
                // view 행렬 (회전+이동 포함, shader에서는 mat3으로 회전만 사용)
                u_view:       () => ctx.uniformState.view,
                u_projection: () => ctx.uniformState.projection,
                // RTC center: referenceCenter - cameraEye (JS double precision)
                u_rtcCenter: () => {
                    const cam = self.viewer.scene.camera.positionWC;
                    sRTC.x = self.referenceCenter.x - cam.x;
                    sRTC.y = self.referenceCenter.y - cam.y;
                    sRTC.z = self.referenceCenter.z - cam.z;
                    return sRTC;
                },
                u_baseColor: () => new Cesium.Cartesian3(self.baseColor[0], self.baseColor[1], self.baseColor[2]),
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

        console.log(`[VehiclePrimitive] 초기화 완료: type=${this.vehicleType} count=${this.instanceCount} scale=${sc.toFixed(3)} glb=${glbUrl}`);
    }

    // ─── 매 프레임 호출 ───────────────────────────────────────────────────
    update(frameState: any) {
        if (this.destroyed || !this.show) return;
        if (!this.drawCommand || !this.offsetBuffer || !this.orientationBuffer) return;
        if (!this._offsetArr || !this._orientArr) return;

        const positions = this.latestPositions;
        if (!positions || positions.length === 0) return;

        const headings = this.latestHeadings;
        const rc       = this.referenceCenter;
        const corrQ    = this.correctionQ;
        const count    = positions.length;

        // scratch 재사용
        const sfrom  = VehiclePrimitive._sfrom;
        const shpr   = VehiclePrimitive._shpr;
        const sqBase = VehiclePrimitive._sqBase;
        const sqRes  = VehiclePrimitive._sqRes;

        const zo = this.zOffset;
        for (let i = 0; i < count; i++) {
            const p = positions[i];

            // Z-offset: ECEF 위치를 ENU Up 방향(= ECEF 단위벡터)으로 zOffset(m) 이동
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

            // RTC offset 갱신
            this._offsetArr[i*3]   = px - rc.x;
            this._offsetArr[i*3+1] = py - rc.y;
            this._offsetArr[i*3+2] = pz - rc.z;

            // orientation 갱신
            sfrom.x = p[0]; sfrom.y = p[1]; sfrom.z = p[2];
            shpr.heading = headings?.[i] ?? 0;
            shpr.pitch   = 0;
            shpr.roll    = 0;
            // ENU 기반 방향 quaternion (scratch 재사용)
            Cesium.Transforms.headingPitchRollQuaternion(sfrom, shpr, Cesium.Ellipsoid.WGS84, undefined, sqBase);
            // 모델 좌표계 보정 적용
            Cesium.Quaternion.multiply(sqBase, corrQ, sqRes);

            this._orientArr[i*4]   = sqRes.x;
            this._orientArr[i*4+1] = sqRes.y;
            this._orientArr[i*4+2] = sqRes.z;
            this._orientArr[i*4+3] = sqRes.w;
        }

        // GPU 버퍼 업데이트 (활성 차량 수만큼만)
        this.offsetBuffer.copyFromArrayView(this._offsetArr.subarray(0, count * 3));
        this.orientationBuffer.copyFromArrayView(this._orientArr.subarray(0, count * 4));

        this.drawCommand.instanceCount = count;
        frameState.commandList.push(this.drawCommand);
    }

    // ─── 외부 인터페이스 ──────────────────────────────────────────────────
    setLatestPositions(data: { positions: number[][]; headings: number[] }) {
        if (this._stopped) return;
        this.latestPositions = data.positions;
        this.latestHeadings  = data.headings;
    }

    start(): void { this._stopped = false; }

    stop(): void {
        this._stopped = true;
        this.latestPositions = undefined;
        this.latestHeadings  = undefined;
    }

    /** 자연 종료 시 호출 — 마지막 위치 유지 없이 즉시 초기화 */
    drain(): void {
        this.stop();
    }

    setSpeed(speed: number)   { this.speed  = speed;  }
    setStatus(status: string) { this.status = status; }

    /** 방향 보정값 실시간 변경 (UI에서 즉시 적용) */
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
        this.vertexArray?.destroy();
        this.modelVertexBuffer?.destroy();
        this.modelNormalBuffer?.destroy();
        this.modelIndexBuffer?.destroy();
        this.offsetBuffer?.destroy();
        this.orientationBuffer?.destroy();
        this.shaderProgram?.destroy();

        this._offsetArr = null;
        this._orientArr = null;
    }
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────

/**
 * 두 ECEF 좌표 사이의 geographic bearing (북=0, 시계방향) 계산.
 * Cesium HeadingPitchRoll.heading 규약과 동일.
 */
function computeHeading(from: Cesium.Cartesian3, to: Cesium.Cartesian3): number {
    const fc = Cesium.Ellipsoid.WGS84.cartesianToCartographic(from);
    const tc = Cesium.Ellipsoid.WGS84.cartesianToCartographic(to);
    const dLon = tc.longitude - fc.longitude;
    const y = Math.sin(dLon) * Math.cos(tc.latitude);
    const x = Math.cos(fc.latitude) * Math.sin(tc.latitude)
            - Math.sin(fc.latitude) * Math.cos(tc.latitude) * Math.cos(dLon);
    return Math.atan2(y, x);
}

/**
 * 초기화용 orientation quaternion 계산 (new 허용, initialize()에서만 호출).
 */
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
