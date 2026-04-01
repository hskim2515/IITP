import * as Cesium from "cesium";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import type { BufferGeometry } from "three";

/**
 * GLB 인스턴싱 기반 차량 Primitive
 *
 * 핵심 구현:
 *  - GPU instanced draw: 모든 인스턴스 1회 DrawCall
 *  - scratch 객체 재사용: 매 프레임 GC 방지
 *  - GLB 자동 스케일: 목표 크기(targetSizeM)에 맞게 자동 조정
 *  - modelViewProjection 기반 렌더링 (PointSpritePrimitive와 동일 패턴)
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
    private offsetBuffer:      any = null;   // ECEF position (instance)
    private modelVertexBuffer: any = null;
    private modelNormalBuffer: any = null;
    private modelIndexBuffer:  any = null;
    private orientationBuffer: any = null;

    // ─── CPU 재사용 배열 (GC 방지) ────────────────────────────────────────
    private _offsetArr: Float32Array | null = null;
    private _orientArr: Float32Array | null = null;

    // ─── 프레임당 scratch 객체 (static, 인스턴스 공유) ──────────────────
    private static readonly _sfrom = new Cesium.Cartesian3();
    private static readonly _shpr  = new Cesium.HeadingPitchRoll(0, 0, 0);
    private static readonly _sqBase = new Cesium.Quaternion();
    private static readonly _sqRes  = new Cesium.Quaternion();

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

        // correctionHpr → Quaternion (고정, 1회만 계산)
        const corrM = Cesium.Matrix3.fromHeadingPitchRoll(this.correctionHpr);
        Cesium.Quaternion.fromRotationMatrix(corrM, this.correctionQ);

        // ── GLB fetch ────────────────────────────────────────────────────
        let arrayBuffer: ArrayBuffer;
        try {
            console.log(`[VehiclePrimitive] GLB fetch 시작: ${glbUrl}`);
            const res = await fetch(glbUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            arrayBuffer = await res.arrayBuffer();
            console.log(`[VehiclePrimitive] GLB fetch 성공: ${arrayBuffer.byteLength} bytes`);
        } catch (e) {
            console.error(`[VehiclePrimitive] GLB fetch 실패 (${glbUrl}):`, e);
            return;
        }
        if (this.destroyed) return;

        // GLB magic number 검증 (0x46546C67 = "glTF")
        const magic = new DataView(arrayBuffer).getUint32(0, true);
        if (magic !== 0x46546C67) {
            console.error(`[VehiclePrimitive] 유효하지 않은 GLB 파일 (magic=0x${magic.toString(16)}): ${glbUrl}`);
            return;
        }

        // ── GLB 파싱 (three.js GLTFLoader) ──────────────────────────────
        let gltf: any;
        try {
            gltf = await new Promise<any>((resolve, reject) =>
                new GLTFLoader().parse(arrayBuffer, '', resolve, reject)
            );
            console.log('[VehiclePrimitive] GLB 파싱 성공');
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
        console.log(`[VehiclePrimitive] Mesh 수집 완료: vertices=${allPos.length / 3} indices=${allIdx.length}`);
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

        // ── 초기 ECEF 위치 ────────────────────────────────────────────────
        const offsetInit = new Float32Array(this.instanceCount * 3);
        for (let i = 0; i < this.instanceCount; i++) {
            const p = this.paths[i];
            offsetInit[i*3]   = p[1];
            offsetInit[i*3+1] = p[2];
            offsetInit[i*3+2] = p[3];
        }

        // ── GPU 버퍼 생성 ─────────────────────────────────────────────────
        const ctx = this.context;
        const CBuffer = (Cesium as any).Buffer;
        const BU  = (Cesium as any).BufferUsage;

        try {
            this.modelVertexBuffer = CBuffer.createVertexBuffer({ context: ctx, typedArray: verts,       usage: BU.STATIC_DRAW });
            this.modelNormalBuffer = CBuffer.createVertexBuffer({ context: ctx, typedArray: norms,       usage: BU.STATIC_DRAW });
            this.modelIndexBuffer  = CBuffer.createIndexBuffer({
                context: ctx, typedArray: indicesTyped,
                indexDatatype: indicesTyped instanceof Uint32Array
                    ? Cesium.IndexDatatype.UNSIGNED_INT
                    : Cesium.IndexDatatype.UNSIGNED_SHORT,
                usage: BU.STATIC_DRAW,
            });
            this.offsetBuffer      = CBuffer.createVertexBuffer({ context: ctx, typedArray: offsetInit, usage: BU.DYNAMIC_DRAW });
            this.orientationBuffer = CBuffer.createVertexBuffer({ context: ctx, typedArray: orientInit, usage: BU.DYNAMIC_DRAW });
        } catch (e) {
            console.error('[VehiclePrimitive] GPU 버퍼 생성 실패:', e);
            return;
        }

        // CPU 재사용 배열
        this._offsetArr = new Float32Array(this.instanceCount * 3);
        this._orientArr = new Float32Array(this.instanceCount * 4);

        // ── VertexArray ──────────────────────────────────────────────────
        try {
            this.vertexArray = new (Cesium as any).VertexArray({
                context: ctx,
                attributes: [
                    { index: 0, vertexBuffer: this.modelVertexBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                    { index: 1, vertexBuffer: this.modelNormalBuffer, componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT },
                    { index: 2, vertexBuffer: this.offsetBuffer,      componentsPerAttribute: 3, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                    { index: 3, vertexBuffer: this.orientationBuffer, componentsPerAttribute: 4, componentDatatype: Cesium.ComponentDatatype.FLOAT, instanceDivisor: 1 },
                ],
                indexBuffer: this.modelIndexBuffer,
            });
        } catch (e) {
            console.error('[VehiclePrimitive] VertexArray 생성 실패:', e);
            return;
        }

        // ── ShaderProgram ────────────────────────────────────────────────
        // PointSpritePrimitive와 동일 패턴: #version 생략 (Cesium ShaderSource가 자동 처리)
        try {
            this.shaderProgram = (Cesium as any).ShaderProgram.fromCache({
                context: ctx,
                vertexShaderSource: `
                    precision highp float;

                    in vec3 a_modelPosition;
                    in vec3 a_modelNormal;
                    in vec3 a_instanceOffset;
                    in vec4 a_instanceOrientation;

                    uniform mat4 u_mvp;

                    vec3 quatRotate(vec3 v, vec4 q) {
                        return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
                    }

                    void main() {
                        vec3 rotated = quatRotate(a_modelPosition, a_instanceOrientation);
                        vec3 worldPos = a_instanceOffset + rotated;
                        gl_Position = u_mvp * vec4(worldPos, 1.0);
                    }
                `,
                fragmentShaderSource: `
                    precision highp float;
                    uniform vec3 u_baseColor;
                    out vec4 fragColor;
                    void main() {
                        fragColor = vec4(u_baseColor, 0.9);
                    }
                `,
                attributeLocations: {
                    a_modelPosition:       0,
                    a_modelNormal:         1,
                    a_instanceOffset:      2,
                    a_instanceOrientation: 3,
                },
            });
        } catch (e) {
            console.error('[VehiclePrimitive] ShaderProgram 생성 실패:', e);
            return;
        }

        // ── DrawCommand ──────────────────────────────────────────────────
        const self = this;

        this.drawCommand = new (Cesium as any).DrawCommand({
            vertexArray:   this.vertexArray,
            shaderProgram: this.shaderProgram,
            uniformMap: {
                u_mvp:       () => ctx.uniformState.modelViewProjection,
                u_baseColor: () => new Cesium.Cartesian3(self.baseColor[0], self.baseColor[1], self.baseColor[2]),
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            count:         indicesTyped.length,
            instanceCount: this.instanceCount,
            pass:          (Cesium as any).Pass.OPAQUE,
            renderState:   (Cesium as any).RenderState.fromCache({
                depthTest: { enabled: true },
                cull:      { enabled: false },
                blending:  Cesium.BlendingState.ALPHA_BLEND,
            }),
        });

        console.log(`[VehiclePrimitive] 초기화 완료: type=${this.vehicleType} count=${this.instanceCount} scale=${sc.toFixed(3)} glb=${glbUrl}`);
    }

    // ─── 매 프레임 호출 ───────────────────────────────────────────────────
    update(frameState: any) {
        if (this.destroyed || !this.show || this._stopped) return;
        if (!this.drawCommand || !this.offsetBuffer || !this.orientationBuffer) return;
        if (!this._offsetArr || !this._orientArr) return;

        const positions = this.latestPositions;
        if (!positions || positions.length === 0) return;

        const headings = this.latestHeadings;
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

            // full ECEF 위치
            this._offsetArr[i*3]   = px;
            this._offsetArr[i*3+1] = py;
            this._offsetArr[i*3+2] = pz;

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

    start(): void {
        this._stopped = false;
        this.latestPositions = undefined;
        this.latestHeadings  = undefined;
    }

    stop(): void {
        this._stopped = true;
        this.latestPositions = undefined;
        this.latestHeadings  = undefined;
        if (this.drawCommand) this.drawCommand.instanceCount = 0;
    }

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
