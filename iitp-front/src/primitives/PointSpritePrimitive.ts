import * as Cesium from "cesium";

/**
 * DomePrimitive + FieldPrimitive 통합 범용 포인트 스프라이트 Primitive.
 *
 * 개선 사항:
 *  - 용량 기반 버퍼 재할당 (크기가 줄어도 재할당 안 함 → GC 압력 감소)
 *  - null/undefined 포지션 안전 처리
 *  - color, pointSize, zOffset 설정 가능
 *  - TypeScript 완전 타입화
 */

export interface PointSpriteOptions {
    /** RGB 0–1 범위 색상. 기본: [1.0, 0.5, 0.0] (주황) */
    color?: [number, number, number];
    /** 알파값 0–1. 기본: 0.5 */
    alpha?: number;
    /** gl_PointSize 픽셀 크기. 기본: 10 */
    pointSize?: number;
    /** ECEF Z 방향 오프셋(m). 기본: 0 */
    zOffset?: number;
}

export default class PointSpritePrimitive {
    show      = false;
    private destroyed = false;
    private context: any;

    // GPU 리소스
    private vertexBuffer: any = null;
    private vertexArray:  any = null;
    private shaderProgram: any;
    private drawCommand:  any = null;

    /** 현재 할당된 GPU 버퍼 용량 (points 수) */
    private _capacity = 0;

    private latestPositions: (number[] | null)[] | null = null;
    private _stopped = false;

    private readonly color:     [number, number, number];
    private readonly alpha:     number;
    private readonly pointSize: number;
    private readonly zOffset:   number;

    constructor(context: any, options: PointSpriteOptions = {}) {
        this.context   = context;
        this.color     = options.color     ?? [1.0, 0.5, 0.0];
        this.alpha     = options.alpha     ?? 0.5;
        this.pointSize = options.pointSize ?? 10.0;
        this.zOffset   = options.zOffset   ?? 0.0;
        this._initShader();
    }

    private _initShader(): void {
        this.shaderProgram = (Cesium as any).ShaderProgram.fromCache({
            context: this.context,
            vertexShaderSource: `
                in vec3 a_position;
                uniform mat4 u_mvp;
                uniform float u_pointSize;
                uniform float u_zOffset;
                void main() {
                    vec3 pos = a_position;
                    pos.z += u_zOffset;
                    gl_Position  = u_mvp * vec4(pos, 1.0);
                    gl_PointSize = u_pointSize;
                }
            `,
            fragmentShaderSource: `
                precision highp float;
                uniform vec3  u_color;
                uniform float u_alpha;
                out vec4 fragColor;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5)) * 2.0;
                    float a = smoothstep(1.0, 0.75, dist) * u_alpha;
                    if (a < 0.01) discard;
                    fragColor = vec4(u_color, a);
                }
            `,
            attributeLocations: { a_position: 0 },
        });
    }

    // ──────────────────────────────────────────
    // setters
    // ──────────────────────────────────────────
    setLatestPositions(data: { positions: (number[] | null)[] }): void {
        if (this._stopped) return;
        this.latestPositions = data.positions;
    }

    start(): void {
        this._stopped = false;
        this.latestPositions = null;
    }
    stop(): void {
        this._stopped = true;
        this.latestPositions = null;
        this._capacity = 0;
        if (this.drawCommand) this.drawCommand.vertexCount = 0;
    }
    drain(): void {
        this._stopped = true;
        this.latestPositions = null;
        this._capacity = 0;
        if (this.drawCommand) this.drawCommand.vertexCount = 0;
    }

    setSpeed(_speed: number): void   {}
    setStatus(_status: string): void {}

    // ──────────────────────────────────────────
    // 매 프레임 업데이트
    // ──────────────────────────────────────────
    update(frameState: any): void {
        if (this.destroyed || !this.show || !this.latestPositions || this._stopped) return;

        const active = this.latestPositions.filter((p): p is number[] => p != null);
        if (active.length === 0) return;

        const n    = active.length;
        const flat = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            flat[i * 3]     = active[i][0]!;
            flat[i * 3 + 1] = active[i][1]!;
            flat[i * 3 + 2] = active[i][2]!;
        }

        if (!this.vertexBuffer || this._capacity < n) {
            // 용량 부족 시에만 재할당 (GPU 버퍼 크기 키우기만 함, 줄이지 않음)
            this.vertexBuffer?.destroy();
            this.vertexArray?.destroy();

            this.vertexBuffer = Cesium.Buffer.createVertexBuffer({
                context:    this.context,
                typedArray: flat,
                usage:      Cesium.BufferUsage.DYNAMIC_DRAW,
            });
            this.vertexArray = new (Cesium as any).VertexArray({
                context: this.context,
                attributes: [{
                    index:                 0,
                    vertexBuffer:          this.vertexBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype:     Cesium.ComponentDatatype.FLOAT,
                }],
            });
            this._capacity = n;

            const self = this;
            this.drawCommand = new (Cesium as any).DrawCommand({
                vertexArray:   this.vertexArray,
                shaderProgram: this.shaderProgram,
                vertexCount:   n,
                uniformMap: {
                    u_mvp:       () => self.context.uniformState.modelViewProjection,
                    u_color:     () => new Cesium.Cartesian3(self.color[0], self.color[1], self.color[2]),
                    u_alpha:     () => self.alpha,
                    u_pointSize: () => self.pointSize,
                    u_zOffset:   () => self.zOffset,
                },
                primitiveType: Cesium.PrimitiveType.POINTS,
                renderState:   (Cesium as any).RenderState.fromCache({
                    depthTest: { enabled: true },
                    blending:  Cesium.BlendingState.ALPHA_BLEND,
                }),
                pass: (Cesium as any).Pass.OPAQUE,
            });
        } else {
            // 용량 충분 → copyFromArrayView 로 GPU 업데이트 (재할당 없음)
            this.vertexBuffer.copyFromArrayView(flat);
            this.drawCommand.vertexCount = n;
        }

        frameState.commandList.push(this.drawCommand);
    }

    // ──────────────────────────────────────────
    // 리소스 해제
    // ──────────────────────────────────────────
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.vertexBuffer?.destroy();
        this.vertexArray?.destroy();
        this.shaderProgram?.destroy();
    }
}
