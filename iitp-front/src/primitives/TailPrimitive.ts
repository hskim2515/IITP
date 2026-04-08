import * as Cesium from "cesium";
import { Cartesian3 } from "cesium";

// ──────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────

/** 원형 버퍼 (O(1) push, 메모리 재사용) */
interface CircularBuffer {
    positions: Cartesian3[];
    head:  number;   // 다음에 쓸 슬롯 인덱스
    count: number;   // 현재 유효한 항목 수
}

/**
 * trail 하나의 GPU 리소스 전체.
 * positionBuffer / fadeBuffer / offsetBuffer 를 직접 저장하여
 * Cesium 내부 private API(_attributes) 없이 copyFromArrayView 호출 가능.
 */
/**
 * TRIANGLE_STRIP 리본: 각 위치마다 왼쪽/오른쪽 꼭짓점 2개 필요
 *   flatPositions : N * 2 * 3  (N위치 × 2꼭짓점 × xyz)
 *   flatFade      : N * 2
 *   flatOffsets   : N * 2      (짝수=-w, 홀수=+w)
 */
interface TrailResources {
    buffer:         CircularBuffer;
    flatPositions:  Float32Array;   // N * 2 * 3
    flatFade:       Float32Array;   // N * 2
    flatOffsets:    Float32Array;   // N * 2
    positionBuffer: any;
    fadeBuffer:     any;
    offsetBuffer:   any;
    vertexArray:    any;
    shaderProgram:  any;
    drawCommand:    any;
}

// ──────────────────────────────────────────────
// 차종별 색상 (VehicleFeatureLayer / TrailFeatureLayer 와 동일한 값 유지)
// ──────────────────────────────────────────────
const TYPE_COLORS: Record<string, [number, number, number, number]> = {
    'CAR':     [100, 160, 255, 0.92],
    'TAXI':    [255, 220,   0, 0.92],
    'BUS':     [255,  90,  90, 0.92],
    'TRUCK':   [180, 120,  60, 0.92],
    'MOTO':    [ 80, 220, 130, 0.92],
    'default': [251, 188,  96, 0.92],
};

// ──────────────────────────────────────────────
// TailPrimitive
// ──────────────────────────────────────────────
export default class TailPrimitive {

    private positions:    number[][];
    private context:      any;
    private destroyed:    boolean;
    private status:       string;
    show:                 boolean;

    private MAX_TRAIL_LENGTH = 50;
    private trails: TrailResources[];
    private latestPositions: (number[] | undefined)[] | null;
    private _stopped: boolean;
    private _drainingSet: Set<number>;
    private _lastDrainTime: number;

    constructor(
        positions:    number[][],
        context:      any,
        speed:        number,
        status:       string,
        vehicleTypes: string[] = []
    ) {
        this.positions    = positions;
        this.context      = context;
        this.destroyed    = false;
        this.status       = status;
        this.show         = false;
        this.latestPositions = null;
        this._stopped = false;
        this._drainingSet = new Set();
        this._lastDrainTime = 0;
        this.trails = [];

        this.positions.forEach((position, i) => {
            const resources = this.createTrailResources(
                new Cartesian3(position[1]!, position[2]!, position[3]!)
            );
            // 차종별 색상을 drawCommand.uniformMap에 주입 (0-255 → 0-1 정규화)
            const vType = vehicleTypes[i] ?? 'default';
            const [r, g, b, a] = TYPE_COLORS[vType] ?? TYPE_COLORS['default']!;
            const color = new Cesium.Cartesian4(r / 255, g / 255, b / 255, a);
            resources.drawCommand.uniformMap = {
                ...resources.drawCommand.uniformMap,
                u_color: () => color,
            };
            this.trails.push(resources);
        });
    }

    // ──────────────────────────────────────────
    // trail 리소스 생성
    // ──────────────────────────────────────────
    private createTrailResources(initialPosition: Cartesian3): TrailResources {
        const N = this.MAX_TRAIL_LENGTH;

        // count: 0 으로 시작 → 실제 위치가 들어오기 전까지 렌더링하지 않음
        // (count: N 으로 초기화하면 잘못된 초기 좌표로 풀 트레일이 즉시 그려져 번쩍임)
        const buffer: CircularBuffer = {
            positions: Array.from({ length: N }, () =>
                new Cartesian3(initialPosition.x, initialPosition.y, initialPosition.z)
            ),
            head:  0,
            count: 0,
        };

        // 각 위치마다 왼쪽/오른쪽 꼭짓점 2개 → N*2 vertices
        const flatPositions = new Float32Array(N * 2 * 3);
        const flatFade      = new Float32Array(N * 2);
        const flatOffsets   = new Float32Array(N * 2);

        // 초기값: 모두 initialPosition, fade=0, offset=0 (count=0이므로 렌더링 안 됨)
        for (let i = 0; i < N; i++) {
            flatPositions[i * 6]     = initialPosition.x;
            flatPositions[i * 6 + 1] = initialPosition.y;
            flatPositions[i * 6 + 2] = initialPosition.z;
            flatPositions[i * 6 + 3] = initialPosition.x;
            flatPositions[i * 6 + 4] = initialPosition.y;
            flatPositions[i * 6 + 5] = initialPosition.z;
            flatFade[i * 2]     = 0;
            flatFade[i * 2 + 1] = 0;
            flatOffsets[i * 2]     = 0;
            flatOffsets[i * 2 + 1] = 0;
        }

        // GPU 버퍼 직접 생성 및 참조 저장 → Cesium 내부 _attributes 접근 불필요
        const positionBuffer = (Cesium as any).Buffer.createVertexBuffer({
            context:    this.context,
            typedArray: flatPositions,
            usage:      (Cesium as any).BufferUsage.STREAM_DRAW,
        });
        const fadeBuffer = (Cesium as any).Buffer.createVertexBuffer({
            context:    this.context,
            typedArray: flatFade,
            usage:      (Cesium as any).BufferUsage.STREAM_DRAW,
        });
        const offsetBuffer = (Cesium as any).Buffer.createVertexBuffer({
            context:    this.context,
            typedArray: flatOffsets,
            usage:      (Cesium as any).BufferUsage.STREAM_DRAW,
        });

        const vertexArray = new (Cesium as any).VertexArray({
            context: this.context,
            attributes: [
                {
                    index: 0,
                    vertexBuffer: positionBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
                {
                    index: 1,
                    vertexBuffer: fadeBuffer,
                    componentsPerAttribute: 1,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
                {
                    index: 2,
                    vertexBuffer: offsetBuffer,
                    componentsPerAttribute: 1,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                }
            ],
        });

        // vertex / fragment 셰이더 모두 #version 300 es 명시
        const shaderProgram = (Cesium as any).ShaderProgram.fromCache({
            context: this.context,
            vertexShaderSource: `
                #version 300 es
                precision highp float;

                in vec3 a_position;
                in float a_fade;
                in float a_offset;

                uniform mat4 u_modelViewProjectionMatrix;
                uniform vec2 u_viewportSize;

                out float v_fade;

                void main() {
                    // 월드 좌표 -> clip space
                    vec4 clip = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
                    vec2 ndc = clip.xy / clip.w;

                    // 화면 공간에서 수직 방향으로 오프셋 적용
                    float thickness = 3.0 / u_viewportSize.y; // 픽셀 단위 두께
                    vec2 offset = vec2(-ndc.y, ndc.x); // 카메라 기준 수직 방향
                    offset = normalize(offset) * thickness * a_offset;

                    vec4 offsetClip = clip;
                    offsetClip.xy += offset * clip.w; // 오프셋을 clip space에 맞게 적용
                    gl_Position = offsetClip;

                    v_fade = a_fade;
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;

                uniform vec4 u_color;
                in float v_fade;
                out vec4 fragColor;

                void main() {
                    fragColor = vec4(u_color.rgb * v_fade, u_color.a * v_fade);
                }
            `,
            attributeLocations: {
                a_position: 0,
                a_fade:     1,
                a_offset:   2,
            },
        });

        const drawCommand = new (Cesium as any).DrawCommand({
            vertexArray,
            shaderProgram,
            vertexCount: 0,  // 초기에는 그리지 않음, updateTrail에서 count*2 로 갱신
            uniformMap: {
                u_modelViewProjectionMatrix: () =>
                    this.context.uniformState.modelViewProjection,
                u_viewportSize: () => new Cesium.Cartesian2(
                    this.context.drawingBufferWidth,
                    this.context.drawingBufferHeight
                ),
                // u_color는 constructor에서 trail별로 덮어씀
                u_color: () => new Cesium.Cartesian4(0.98, 0.74, 0.38, 0.92),
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
            renderState: (Cesium as any).RenderState.fromCache({
                depthTest: { enabled: false },
                blending:  Cesium.BlendingState.ALPHA_BLEND,
            }),
            // Pass.TRANSLUCENT 는 OIT/MRT 래핑으로 사용자 out 변수가 충돌.
            // alpha blend는 renderState에서 처리하고 OPAQUE pass 유지.
            pass: (Cesium as any).Pass.OPAQUE,
        });

        return {
            buffer,
            flatPositions,
            flatFade,
            flatOffsets,
            positionBuffer,
            fadeBuffer,
            offsetBuffer,
            vertexArray,
            shaderProgram,
            drawCommand,
        };
    }

    // ──────────────────────────────────────────
    // 매 프레임 업데이트
    // ──────────────────────────────────────────
    private static readonly DRAIN_INTERVAL = 50;

    update(frameState: any): void {
        if (this.destroyed || !this.show) return;

        if (this._hasNewPositions && this.latestPositions && !this._stopped) {
            this._hasNewPositions = false;
            const nextNullSet = new Set<number>();
            this.trails.forEach((trail, index) => {
                if (this.latestPositions![index]) {
                    // null → 활성 전환: 기존 버퍼 초기화 (이전 trail이 새 시작 위치와 연결되는 것 방지)
                    if (this._prevNullSet.has(index) && trail.buffer.count > 0) {
                        trail.buffer.head = 0;
                        trail.buffer.count = 0;
                        trail.drawCommand.vertexCount = 0;
                    }
                    this._drainingSet.delete(index);
                    this.updateTrail(trail, index);
                } else {
                    nextNullSet.add(index);
                    if (trail.buffer.count > 0) {
                        this._drainingSet.add(index);
                    }
                }
            });
            this._prevNullSet = nextNullSet;
        }

        if (this._drainingSet.size > 0) {
            const now = performance.now();
            if (now - this._lastDrainTime >= TailPrimitive.DRAIN_INTERVAL) {
                this._lastDrainTime = now;
                for (const index of this._drainingSet) {
                    const trail = this.trails[index]!;
                    if (trail.buffer.count > 0) {
                        this._drainOneStep(trail);
                    } else {
                        this._drainingSet.delete(index);
                    }
                }
            }
        }

        for (const trail of this.trails) {
            if (trail.buffer.count >= 2) {
                frameState.commandList.push(trail.drawCommand);
            }
        }
    }

    /**
     * 허용 ECEF 이동 거리² — 이 이상이면 순간이동(시뮬 재시작 등)으로 간주해 trail 초기화.
     * 100 km/h × speed=50 × 0.05s ≈ 70m → 10 000m 이면 충분히 안전.
     */
    private static readonly MAX_JUMP_SQ = 10_000 * 10_000;

    private updateTrail(trail: TrailResources, index: number): void {
        const N   = this.MAX_TRAIL_LENGTH;
        const pos = this.latestPositions![index]!;
        const buf = trail.buffer;

        // 순간이동 감지 → 버퍼 초기화
        if (buf.count > 0) {
            const prevIdx = (buf.head - 1 + N) % N;
            const prev = buf.positions[prevIdx]!;
            const dx = pos[0]! - prev.x;
            const dy = pos[1]! - prev.y;
            const dz = pos[2]! - prev.z;
            if (dx * dx + dy * dy + dz * dz > TailPrimitive.MAX_JUMP_SQ) {
                buf.head = 0;
                buf.count = 0;
                trail.drawCommand.vertexCount = 0;
            }
        }

        const slot = buf.positions[buf.head]!;
        slot.x = pos[0]!;
        slot.y = pos[1]!;
        slot.z = pos[2]!;
        buf.head = (buf.head + 1) % N;
        if (buf.count < N) buf.count++;

        const MAX_WIDTH = 5.0;
        const fadeLen    = Math.max(buf.count, 1);
        const widthStep  = MAX_WIDTH / N;

        for (let i = 0; i < buf.count; i++) {
            const idx = (buf.head - buf.count + i + N) % N;
            const p   = buf.positions[idx]!;
            const fadeVal   = i / fadeLen;
            const halfWidth = i * widthStep;

            trail.flatPositions[i * 6]     = p.x;
            trail.flatPositions[i * 6 + 1] = p.y;
            trail.flatPositions[i * 6 + 2] = p.z;
            trail.flatFade[i * 2]          = fadeVal;
            trail.flatOffsets[i * 2]       = -halfWidth;

            trail.flatPositions[i * 6 + 3] = p.x;
            trail.flatPositions[i * 6 + 4] = p.y;
            trail.flatPositions[i * 6 + 5] = p.z;
            trail.flatFade[i * 2 + 1]      = fadeVal;
            trail.flatOffsets[i * 2 + 1]   =  halfWidth;
        }

        trail.positionBuffer.copyFromArrayView(trail.flatPositions);
        trail.fadeBuffer.copyFromArrayView(trail.flatFade);
        trail.offsetBuffer.copyFromArrayView(trail.flatOffsets);

        trail.drawCommand.vertexCount = Math.max(buf.count * 2, 0);
    }

    private _drainOneStep(trail: TrailResources): void {
        const buf = trail.buffer;
        if (buf.count <= 0) return;

        buf.count--;

        if (buf.count < 2) {
            trail.drawCommand.vertexCount = 0;
            buf.count = 0;
            return;
        }

        const N = this.MAX_TRAIL_LENGTH;
        const MAX_WIDTH = 5.0;
        const fadeLen   = buf.count;
        const widthStep = MAX_WIDTH / N;

        for (let i = 0; i < buf.count; i++) {
            const idx = (buf.head - buf.count + i + N) % N;
            const p   = buf.positions[idx]!;
            const fadeVal   = i / fadeLen;
            const halfWidth = i * widthStep;

            trail.flatPositions[i * 6]     = p.x;
            trail.flatPositions[i * 6 + 1] = p.y;
            trail.flatPositions[i * 6 + 2] = p.z;
            trail.flatFade[i * 2]          = fadeVal;
            trail.flatOffsets[i * 2]       = -halfWidth;

            trail.flatPositions[i * 6 + 3] = p.x;
            trail.flatPositions[i * 6 + 4] = p.y;
            trail.flatPositions[i * 6 + 5] = p.z;
            trail.flatFade[i * 2 + 1]      = fadeVal;
            trail.flatOffsets[i * 2 + 1]   =  halfWidth;
        }

        trail.positionBuffer.copyFromArrayView(trail.flatPositions);
        trail.fadeBuffer.copyFromArrayView(trail.flatFade);
        trail.offsetBuffer.copyFromArrayView(trail.flatOffsets);

        trail.drawCommand.vertexCount = buf.count * 2;
    }

    // ──────────────────────────────────────────
    // setters
    // ──────────────────────────────────────────
    setSpeed(_speed: number): void  { /* trail 길이 고정 */ }
    setStatus(status: string): void { this.status = status; }

    setTrailLength(length: number): void {
        const N = Math.max(2, Math.round(length));
        if (N === this.MAX_TRAIL_LENGTH) return;
        this.MAX_TRAIL_LENGTH = N;
        this._rebuildBuffers();
    }

    private _rebuildBuffers(): void {
        const N = this.MAX_TRAIL_LENGTH;
        for (let t = 0; t < this.trails.length; t++) {
            const trail = this.trails[t]!;

            // 이전 GPU 리소스 해제 (shaderProgram은 fromCache 공유이므로 건드리지 않음)
            try { trail.positionBuffer?.destroy?.(); } catch (_) {}
            try { trail.fadeBuffer?.destroy?.(); } catch (_) {}
            try { trail.offsetBuffer?.destroy?.(); } catch (_) {}
            try { trail.vertexArray?.destroy(); } catch (_) {}

            // 초기 위치: 기존 circular buffer의 첫 위치 재활용
            const initPos = trail.buffer.positions[0] ?? new Cesium.Cartesian3();
            const ix = initPos.x, iy = initPos.y, iz = initPos.z;

            // 새 circular buffer
            trail.buffer = {
                positions: Array.from({ length: N }, () =>
                    new Cesium.Cartesian3(ix, iy, iz)
                ),
                head:  0,
                count: 0,
            };

            // 새 CPU 배열
            trail.flatPositions = new Float32Array(N * 2 * 3);
            trail.flatFade      = new Float32Array(N * 2);
            trail.flatOffsets   = new Float32Array(N * 2);
            for (let i = 0; i < N; i++) {
                trail.flatPositions[i * 6]     = ix;
                trail.flatPositions[i * 6 + 1] = iy;
                trail.flatPositions[i * 6 + 2] = iz;
                trail.flatPositions[i * 6 + 3] = ix;
                trail.flatPositions[i * 6 + 4] = iy;
                trail.flatPositions[i * 6 + 5] = iz;
            }

            // 새 GPU 버퍼
            trail.positionBuffer = (Cesium as any).Buffer.createVertexBuffer({
                context: this.context,
                typedArray: trail.flatPositions,
                usage: (Cesium as any).BufferUsage.STREAM_DRAW,
            });
            trail.fadeBuffer = (Cesium as any).Buffer.createVertexBuffer({
                context: this.context,
                typedArray: trail.flatFade,
                usage: (Cesium as any).BufferUsage.STREAM_DRAW,
            });
            trail.offsetBuffer = (Cesium as any).Buffer.createVertexBuffer({
                context: this.context,
                typedArray: trail.flatOffsets,
                usage: (Cesium as any).BufferUsage.STREAM_DRAW,
            });

            // 새 VertexArray
            trail.vertexArray = new (Cesium as any).VertexArray({
                context: this.context,
                attributes: [
                    {
                        index: 0,
                        vertexBuffer: trail.positionBuffer,
                        componentsPerAttribute: 3,
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                    },
                    {
                        index: 1,
                        vertexBuffer: trail.fadeBuffer,
                        componentsPerAttribute: 1,
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                    },
                    {
                        index: 2,
                        vertexBuffer: trail.offsetBuffer,
                        componentsPerAttribute: 1,
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                    },
                ],
            });

            // drawCommand에 새 VertexArray 할당
            trail.drawCommand.vertexArray  = trail.vertexArray;
            trail.drawCommand.vertexCount  = 0;
        }
    }

    private _hasNewPositions = false;
    private _prevNullSet = new Set<number>();

    setLatestPositions(latestPositions: { positions: (number[] | undefined)[] }): void {
        if (this._stopped) return;
        this.latestPositions = latestPositions.positions;
        this._hasNewPositions = true;
    }

    start(): void {
        this._stopped = false;
        this._drainingSet.clear();
        this._prevNullSet.clear();
    }

    stop(): void {
        this._stopped = true;
        this.latestPositions = null;
        this._drainingSet.clear();
        this._prevNullSet.clear();
        this._resetBuffers();
    }

    drain(): void {
        this._stopped = true;
        this.latestPositions = null;
        this.trails.forEach((trail, index) => {
            if (trail.buffer.count > 0) {
                this._drainingSet.add(index);
            }
        });
    }

    private _resetBuffers(): void {
        const N = this.MAX_TRAIL_LENGTH;
        for (let t = 0; t < this.trails.length; t++) {
            const trail = this.trails[t]!;
            const initPos = this.positions[t]!;
            const ix = initPos[1]!, iy = initPos[2]!, iz = initPos[3]!;

            trail.buffer.head  = 0;
            trail.buffer.count = 0;
            if (trail.drawCommand) trail.drawCommand.vertexCount = 0;

            for (const p of trail.buffer.positions) {
                p.x = ix; p.y = iy; p.z = iz;
            }
            for (let i = 0; i < N; i++) {
                trail.flatPositions[i * 6]     = ix;
                trail.flatPositions[i * 6 + 1] = iy;
                trail.flatPositions[i * 6 + 2] = iz;
                trail.flatPositions[i * 6 + 3] = ix;
                trail.flatPositions[i * 6 + 4] = iy;
                trail.flatPositions[i * 6 + 5] = iz;
                trail.flatFade[i * 2]     = 0;
                trail.flatFade[i * 2 + 1] = 0;
                trail.flatOffsets[i * 2]     = 0;
                trail.flatOffsets[i * 2 + 1] = 0;
            }
            trail.positionBuffer.copyFromArrayView(trail.flatPositions);
            trail.fadeBuffer.copyFromArrayView(trail.flatFade);
            trail.offsetBuffer.copyFromArrayView(trail.flatOffsets);
        }
    }

    // ──────────────────────────────────────────
    // 리소스 해제
    // ──────────────────────────────────────────
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;  // destroy 후 update() 진입 차단

        // shaderProgram 은 fromCache 로 동일 인스턴스를 공유하므로 한 번만 해제
        if (this.trails.length > 0) {
            this.trails[0]!.shaderProgram.destroy();
        }

        for (const trail of this.trails) {
            // vertexArray.destroy()가 연결된 버퍼들을 암묵적으로 파괴하므로
            // 버퍼 참조를 null로 초기화한 뒤 vertexArray만 파괴한다.
            trail.positionBuffer = null;
            trail.fadeBuffer     = null;
            trail.offsetBuffer   = null;
            trail.vertexArray.destroy();
        }

        this.trails = [];
    }
}
