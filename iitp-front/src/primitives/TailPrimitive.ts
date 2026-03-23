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
// TailPrimitive
// ──────────────────────────────────────────────
export default class TailPrimitive {

    private positions:    number[][];
    private speed:        number;
    private currentIndex: number;
    private ready:        boolean;
    private context:      any;   // Cesium scene.context (internal)
    private previousTime: number;
    private destroyed:    boolean;
    private progress:     number;
    private status:       string;
    show:                 boolean;

    private MAX_TRAIL_LENGTH: number;
    private trails: TrailResources[];
    private latestPositions: (number[] | undefined)[] | null;

    constructor(
        positions: number[][],
        context:   any,
        speed:     number,
        status:    string
    ) {
        this.positions    = positions;
        this.speed        = speed;
        this.currentIndex = 0;
        this.ready        = false;
        this.context      = context;
        this.previousTime = performance.now();
        this.destroyed    = false;
        this.progress     = 0;
        this.status       = status;
        this.show         = false;
        this.latestPositions = null;

        this.MAX_TRAIL_LENGTH = 50;
        this.trails = [];

        this.positions.forEach((position) => {
            this.trails.push(
                this.createTrailResources(
                    new Cartesian3(position[1]!, position[2]!, position[3]!)
                )
            );
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

        // 초기값 채우기 (모두 initialPosition, 오프셋 0)
        for (let i = 0; i < N; i++) {
            // 왼쪽 꼭짓점 (짝수 인덱스)
            flatPositions[i * 6]     = initialPosition.x;
            flatPositions[i * 6 + 1] = initialPosition.y;
            flatPositions[i * 6 + 2] = initialPosition.z;
            flatFade[i * 2]          = i / N;
            flatOffsets[i * 2]       = -5;
            // 오른쪽 꼭짓점 (홀수 인덱스)
            flatPositions[i * 6 + 3] = initialPosition.x;
            flatPositions[i * 6 + 4] = initialPosition.y;
            flatPositions[i * 6 + 5] = initialPosition.z;
            flatFade[i * 2 + 1]      = i / N;
            flatOffsets[i * 2 + 1]   =  5;
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

                uniform float u_time;
                in float v_fade;
                out vec4 fragColor;

                void main() {
                    float r = abs(sin(u_time * 2.0)) * 2.0;
                    float g = abs(sin(u_time * 3.0 + 2.0)) * 2.0;
                    float b = abs(sin(u_time * 4.0 + 4.0)) * 2.0;
                    vec3 neonColor = vec3(r, g, b);

                    fragColor = vec4(1.0 * v_fade, 0.5 * v_fade, 0.0, v_fade);
                    //fragColor = vec4(neonColor, v_fade);
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
                u_time: () => performance.now() / 1000.0,
                u_viewportSize: () => new Cesium.Cartesian2(
                    this.context.drawingBufferWidth,
                    this.context.drawingBufferHeight
                ),
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
    update(frameState: any): void {
        // destroyed / show 체크를 한 번만 수행 (중복 체크 제거)
        if (this.destroyed || !this.show || !this.latestPositions) return;

        this.trails.forEach((trail, index) => {
            if (this.latestPositions![index]) {
                this.updateTrail(frameState, trail, index);
            }
        });
    }

    private updateTrail(
        frameState: any,
        trail:      TrailResources,
        index:      number
    ): void {
        const N   = this.MAX_TRAIL_LENGTH;
        const pos = this.latestPositions![index]!;
        const buf = trail.buffer;

        // 원형 버퍼에 새 위치 기록 (O(1), shift() 제거)
        const slot = buf.positions[buf.head]!;
        slot.x = pos[0]!;
        slot.y = pos[1]!;
        slot.z = pos[2]!;
        buf.head = (buf.head + 1) % N;
        if (buf.count < N) buf.count++;

        // 꼬리가 오래될수록 넓어지도록 최대 폭 고정
        const MAX_WIDTH = 5.0;
        const offsetFactor = MAX_WIDTH / N;

        // 각 위치마다 왼쪽/오른쪽 꼭짓점 2개 기록 → TRIANGLE_STRIP 리본
        for (let i = 0; i < N; i++) {
            const idx = (buf.head - buf.count + i + N) % N;
            const p   = buf.positions[idx]!;
            const fadeVal   = i / N;
            const halfWidth = i * offsetFactor;

            // 왼쪽 꼭짓점
            trail.flatPositions[i * 6]     = p.x;
            trail.flatPositions[i * 6 + 1] = p.y;
            trail.flatPositions[i * 6 + 2] = p.z;
            trail.flatFade[i * 2]          = fadeVal;
            trail.flatOffsets[i * 2]       = -halfWidth;

            // 오른쪽 꼭짓점
            trail.flatPositions[i * 6 + 3] = p.x;
            trail.flatPositions[i * 6 + 4] = p.y;
            trail.flatPositions[i * 6 + 5] = p.z;
            trail.flatFade[i * 2 + 1]      = fadeVal;
            trail.flatOffsets[i * 2 + 1]   =  halfWidth;
        }

        // GPU 버퍼 갱신 (직접 저장된 참조 → Cesium private API 없음)
        trail.positionBuffer.copyFromArrayView(trail.flatPositions);
        trail.fadeBuffer.copyFromArrayView(trail.flatFade);
        trail.offsetBuffer.copyFromArrayView(trail.flatOffsets);

        // 유효한 위치 수만큼만 그림 (count * 2 = 왼쪽/오른쪽 꼭짓점 쌍)
        // TRIANGLE_STRIP은 최소 2개 꼭짓점 필요
        trail.drawCommand.vertexCount = Math.max(buf.count * 2, 0);

        if (buf.count >= 2) {
            frameState.commandList.push(trail.drawCommand);
        }
    }

    // ──────────────────────────────────────────
    // setters
    // ──────────────────────────────────────────
    setSpeed(speed: number): void   { this.speed  = speed; }
    setStatus(status: string): void { this.status = status; }

    setLatestPositions(latestPositions: { positions: (number[] | undefined)[] }): void {
        this.latestPositions = latestPositions.positions;
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
            // GPU 버퍼를 직접 해제 (vertexArray 는 버퍼를 소유하지 않을 수 있으므로 개별 해제)
            trail.positionBuffer.destroy();
            trail.fadeBuffer.destroy();
            trail.offsetBuffer.destroy();
            trail.vertexArray.destroy();
        }

        this.trails = [];
    }
}
