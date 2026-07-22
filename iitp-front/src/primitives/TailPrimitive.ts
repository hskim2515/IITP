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
    /** 마지막으로 위치가 push된 시각(performance.now) — 공백 감지 리셋용, _pushPoint 참고 */
    lastPushAt:     number;
    /** feed로 buffer가 바뀌어 GPU 재업로드가 필요한지 — update()에서 소비 */
    dirty:          boolean;
}

// ──────────────────────────────────────────────
// 차종별 기본 색상 (DB에서 가져오지 못할 경우의 fallback)
const DEFAULT_TYPE_COLORS: Record<string, [number, number, number, number]> = {
    'default': [251, 188,  96, 0.92],
};

function hexToRgba(hex: string, alpha = 0.92): [number, number, number, number] | null {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m || !m[1] || !m[2] || !m[3]) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), alpha];
}

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
        vehicleTypes: string[] = [],
        typeColorMap: Record<string, string> = {}
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
            const hexColor = typeColorMap[vType];
            const [r, g, b, a] = (hexColor ? hexToRgba(hexColor) : null)
                ?? DEFAULT_TYPE_COLORS[vType]
                ?? DEFAULT_TYPE_COLORS['default']!;
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
                    // ⚠️ normalize(vec2(0,0))은 NaN — trail 점이 화면 정중앙을 지나는 순간 해당
                    // 정점이 폭발해 화면을 가로지르는 띠/스파이크로 보인다(카메라를 움직일 때 trail
                    // 점들이 중앙을 스치며 발생). 길이 하한으로 가드.
                    vec2 dir = vec2(-ndc.y, ndc.x); // 카메라 기준 수직 방향
                    float dirLen = max(length(dir), 1e-6);
                    vec2 offset = (dir / dirLen) * thickness * a_offset;

                    vec4 offsetClip = clip;
                    offsetClip.xy += offset * clip.w; // 오프셋을 clip space에 맞게 적용
                    gl_Position = offsetClip;

                    // 카메라 뒤(clip.w<=0)의 점은 투영이 뒤집혀 STRIP이 화면을 가로지르는 삼각형을
                    // 만든다 — fade 0으로 해당 정점이 낀 삼각형을 투명 처리(색·알파 모두 fade 곱).
                    v_fade = clip.w > 0.0 ? a_fade : 0.0;
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
            // ⚠️ 정점 수 속성명은 반드시 `count` — 한때 `vertexCount`로 잘못 쓰여 있었고, Cesium
            // DrawCommand에 그런 속성은 없어서(무시되는 expando) _count=undefined → Context.draw가
            // "count 미지정 = 버퍼 전체(N*2=100 정점)"로 매 프레임 전부 그렸다. 평소엔 count 너머
            // 스테일 정점들의 fade가 0이라 투명해서 안 보였지만, count가 줄었다 다시 자라는 경우
            // (drain, resetTrails 후 재성장 — 슬롯 재배정/공급원 스왑마다 발생)엔 count 너머에
            // "이전 trail의 위치+논제로 fade"가 남아 새 점들과 한 TRIANGLE_STRIP으로 이어져
            // km급 직선 그물로 그려졌다("초기화 때 시작점이 섞인다"는 사용자 가설이 정확했음).
            count: 0,  // 초기에는 그리지 않음, _rebuildAndUpload에서 buf.count*2 로 갱신
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
            lastPushAt: 0,
            dirty: false,
        };
    }

    // ──────────────────────────────────────────
    // 매 프레임 업데이트
    // ──────────────────────────────────────────
    private static readonly DRAIN_INTERVAL = 50;

    private _lastStateLogAt = 0;

    update(frameState: any): void {
        // ── 진단 상태 로그 (2초 스로틀, early return 이전!) — "줌아웃 시 trip 사라짐" 판별용:
        //   update 로그 자체가 안 찍히면 → primitive가 컬렉션에서 빠짐/destroy됨
        //   show=false → 누군가 숨김 / visible=0 → 데이터(feed) 문제 / visible>0인데 안 보임 → 렌더 문제
        {
            const nowLog = performance.now();
            if (nowLog - this._lastStateLogAt > 2000) {
                this._lastStateLogAt = nowLog;
                let visible = 0;
                for (const t of this.trails) if (t.buffer.count >= 2) visible++;
                const camH = Math.round(frameState.camera?.positionCartographic?.height ?? -1);
                console.log(`[진단][TailPrimitive] 상태: slots=${this.trails.length} show=${this.show} destroyed=${this.destroyed} stopped=${this._stopped} visibleTrails=${visible} camH=${camH} heightCut=${camH > TailPrimitive.MAX_VISIBLE_HEIGHT}`);
            }
        }
        if (this.destroyed || !this.show) return;

        // buffer push는 setLatestPositions()(feed 시점)에서 이미 수행됨 — 여기서는 dirty trail의
        // GPU 업로드만 일괄 처리한다(setLatestPositions 주석 참고: FPS 무관 성장 보장).
        if (this._hasNewPositions && !this._stopped) {
            this._hasNewPositions = false;
            for (const trail of this.trails) {
                if (trail.dirty) this._rebuildAndUpload(trail);
            }
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

        // ── 진단 스캐너 (1초 스로틀): 렌더 직전, 실제로 그려질 버퍼 창(count개)을 전수 검사 —
        // (a) 지구 중심 근처 점(|p|<1e6 — 더미 초기값 (0,0,0) 혼입 가설), (b) 500m 초과 세그먼트.
        // 그물이 보이는 순간 이 로그에 아무것도 안 찍히면 CPU 버퍼는 결백 = 렌더(GPU/uniform) 문제 확정.
        {
            const nowScan = performance.now();
            if (nowScan - TailPrimitive._lastScanAt > 1000) {
                TailPrimitive._lastScanAt = nowScan;
                const anomalies: string[] = [];
                for (let t = 0; t < this.trails.length && anomalies.length < 5; t++) {
                    const buf = this.trails[t]!.buffer;
                    const N = this.MAX_TRAIL_LENGTH;
                    let prev: Cartesian3 | null = null;
                    for (let i = 0; i < buf.count; i++) {
                        const p = buf.positions[(buf.head - buf.count + i + N) % N]!;
                        const mag2 = p.x * p.x + p.y * p.y + p.z * p.z;
                        if (mag2 < 1e12) { // |p| < 1000km — 정상 ECEF(~6371km)에서 불가능
                            anomalies.push(`idx=${t} pt${i} 지구중심근처(|p|=${Math.round(Math.sqrt(mag2))}m)`);
                            break;
                        }
                        if (prev) {
                            const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
                            const d2 = dx * dx + dy * dy + dz * dz;
                            if (d2 > 500 * 500) {
                                anomalies.push(`idx=${t} seg${i}=${Math.round(Math.sqrt(d2))}m (count=${buf.count})`);
                                break;
                            }
                        }
                        prev = p;
                    }
                }
                if (anomalies.length > 0) {
                    console.log(`[진단][TailPrimitive] 버퍼 이상 ${anomalies.length}건:`, anomalies.join(' | '));
                }
            }
        }

        // 멀리(줌아웃)서는 trail(차량 꼬리)이 sub-pixel이라 안 보이는데도 5024개 draw command를
        // 매 프레임 push해 줌아웃 시 부하 폭증(차량 trail은 culling 없음). 카메라 고도가 높으면 생략.
        const camHeight = frameState.camera?.positionCartographic?.height ?? 0;
        if (camHeight <= TailPrimitive.MAX_VISIBLE_HEIGHT) {
            for (const trail of this.trails) {
                if (trail.buffer.count >= 2) {
                    frameState.commandList.push(trail.drawCommand);
                }
            }
        }
    }

    private static _lastScanAt = 0;

    /**
     * 이 카메라 고도(m) 초과 시 trail 숨김. 원래 3000m로 낮게 잡혀 있었는데, 이는 개별 차량이
     * 수천 대까지 있을 수 있던 근거리 모드를 염두에 둔 값이었다 — 그런데 원거리 줌(광역권
     * 규모, VehicleAggregationFeeder가 heatmap과 함께 trip도 계속 살려두는 구간)에서는 카메라
     * 고도가 3000m를 훌쩍 넘는 게 정상이라, 이 값 그대로면 "trip이 원거리에서 안 보인다"는
     * 결과로 이어졌다. 원거리 trip은 합성 차량(MAX_SYNTHETIC_VEHICLES=400)으로 이미 상한이
     * 걸려 있어 draw command 부하 걱정이 없으므로, 사실상 무제한에 가깝게 올린다.
     */
    private static readonly MAX_VISIBLE_HEIGHT = 2_000_000;

    /**
     * 허용 ECEF 이동 거리² — 이 이상이면 순간이동(시뮬 재시작 등)으로 간주해 trail 초기화.
     * 100 km/h × speed=50 × 0.05s ≈ 70m → 10 000m 이면 충분히 안전.
     */
    private static readonly MAX_JUMP_SQ = 10_000 * 10_000;

    /**
     * 이 시간(ms) 넘게 위치 push가 없던 trail에 새 위치가 오면 이어붙이지 않고 리셋.
     *
     * ⚠️ 왜 필요한가: 차량이 사라졌다 재등장할 때의 리셋은 원래 "null feed를 프레임이 관측 →
     * _prevNullSet → 다음 위치에서 리셋" 경로였는데, setLatestPositions()는 배열을 통째로
     * 덮어쓰므로 한 렌더 프레임 사이에 feed가 2개 이상 도착하면(새 차량 무더기 등장·카메라 이동
     * 직후 재로드 등 부하 순간이 정확히 그렇다) 중간의 null이 관측 없이 삼켜져 리셋이 누락됐다 —
     * 그 결과 사라지기 전 옛 지점과 재등장 지점을 (10km 미만이라 정상 이동으로 오인) 직선 띠로
     * 이어버리는 "첫점↔현재점 연결" 현상이 났다. 정상 공급 주기는 아무리 길어도 수백 ms라,
     * push 공백이 이 임계값을 넘겼다는 것 자체가 "그 사이 비활성이었다"는 확실한 증거다 —
     * 신호 관측에 의존하지 않아 몇 개가 삼켜져도 안전하다.
     */
    private static readonly GAP_RESET_MS = 1000;

    /** 점프-리셋 진단 카운터 (1초 스로틀 로그) — 그물 무늬가 이 primitive에서 나오는지 확정용 */
    private static _jumpResetCount = 0;
    private static _lastJumpLogAt = 0;

    /** feed 시점 CPU push — 공백/순간이동 가드 후 circular buffer에 1점 추가, dirty 마킹.
     *  GPU 업로드는 하지 않는다(update()의 _rebuildAndUpload가 담당). */
    private _pushPoint(trail: TrailResources, pos: number[], index: number): void {
        const N   = this.MAX_TRAIL_LENGTH;
        const buf = trail.buffer;

        // 공백 감지 → 버퍼 초기화 (null-관측 누락 대비, GAP_RESET_MS 주석 참고)
        const now = performance.now();
        const dtMs = trail.lastPushAt > 0 ? now - trail.lastPushAt : 0;
        if (buf.count > 0 && trail.lastPushAt > 0 && dtMs > TailPrimitive.GAP_RESET_MS) {
            buf.head = 0;
            buf.count = 0;
        }
        trail.lastPushAt = now;

        // 순간이동 감지 → 버퍼 초기화.
        // 상류의 어떤 경쟁/불일치로 위치가 점프해 오든, 물리적으로 불가능한 거리면 이동이 아니라
        // 순간이동이다 — 하류에서 원인 불문 차단(직선 띠 그물 방지의 최종 방어선).
        if (buf.count > 0) {
            const prevIdx = (buf.head - 1 + N) % N;
            const prev = buf.positions[prevIdx]!;
            const dx = pos[0]! - prev.x;
            const dy = pos[1]! - prev.y;
            const dz = pos[2]! - prev.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            // 공급원이 물리 한계를 명시했으면(_feedMaxSegM — 합성 차량은 200m) 그 값을 쓰고,
            // 아니면 dt 기반 추정(최소 250m, 상한 1500m — 저FPS에서 dt 비례 허용치가 km로 부풀어
            // 가드가 무력화되는 것 방지). push가 feed 시점으로 옮겨져 dt는 이제 feed 간격(80ms~)
            // 이라 추정치도 예전(렌더 프레임 간격)보다 훨씬 타이트해졌다.
            const maxDist = this._feedMaxSegM ?? Math.min(1500, Math.max(250, 1.2 * dtMs));
            if (distSq > maxDist * maxDist) {
                buf.head = 0;
                buf.count = 0;
                TailPrimitive._jumpResetCount++;
                if (now - TailPrimitive._lastJumpLogAt > 1000) {
                    TailPrimitive._lastJumpLogAt = now;
                    console.log(`[진단][TailPrimitive] 점프 리셋 ${TailPrimitive._jumpResetCount}건 — 마지막: idx=${index}, dist=${Math.round(Math.sqrt(distSq))}m, dt=${Math.round(dtMs)}ms, 허용=${Math.round(maxDist)}m`);
                    TailPrimitive._jumpResetCount = 0;
                }
            }
        }

        const slot = buf.positions[buf.head]!;
        slot.x = pos[0]!;
        slot.y = pos[1]!;
        slot.z = pos[2]!;
        buf.head = (buf.head + 1) % N;
        if (buf.count < N) buf.count++;
        trail.dirty = true;
    }

    /** 렌더 프레임에서 dirty trail의 flat 배열 재구성 + GPU 업로드 + draw count 갱신 */
    private _rebuildAndUpload(trail: TrailResources): void {
        const N   = this.MAX_TRAIL_LENGTH;
        const buf = trail.buffer;

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

        trail.drawCommand.count = Math.max(buf.count * 2, 0);
        trail.dirty = false;
    }

    private _drainOneStep(trail: TrailResources): void {
        const buf = trail.buffer;
        if (buf.count <= 0) return;

        buf.count--;

        if (buf.count < 2) {
            trail.drawCommand.count = 0;
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

        trail.drawCommand.count = buf.count * 2;
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
            trail.drawCommand.count  = 0;
        }
    }

    private _hasNewPositions = false;
    /**
     * 마지막 push 이후 한 번이라도 null이었던 인덱스의 누적 집합 — **feed 시점**에 기록한다.
     *
     * ⚠️ 예전엔 update()(렌더 프레임)에서 "직전에 처리한 feed"의 null 집합(_prevNullSet)만 봤는데,
     * setLatestPositions()는 배열을 통째로 덮어쓰므로 한 렌더 프레임 사이에 feed가 2개 이상
     * 도착하면(부하 순간·배속 재생에서 짧은 gap이 벽시계 수십 ms에 불과할 때) 중간의 null이
     * 관측되지 못한 채 사라져 trail 리셋이 누락 → 사라지기 전 지점과 재등장 지점을 직선으로
     * 이어버렸다. feed가 도착하는 즉시 null을 누적해두면 몇 개가 덮여도 기록이 남는다.
     */
    private _nullSinceLastPush = new Set<number>();

    /** 공급원이 명시한 tick 간 최대 이동거리(m) — _pushPoint의 점프 가드가 dt 추정 대신 사용 */
    private _feedMaxSegM: number | null = null;

    /**
     * ⚠️ trail 성장(circular buffer push)은 **feed 도착 시점**에 CPU에서 즉시 수행한다 — 예전엔
     * update()(렌더 프레임)가 "가장 최근 feed 하나"만 반영해서 trail이 프레임당 1점씩만 자랐는데,
     * 이 앱은 부하 시 프레임이 2~5초라 50점 trail이 차는 데 수 분이 걸렸고, 그 사이 카메라 이동
     * rebuild가 resetTrails로 계속 0점으로 되돌리면 그리기 최소 조건(2점)에도 못 미쳐 "줌아웃하면
     * trip이 사라지는" 증상이 났다. push를 feed 시점(80ms 간격)으로 옮기면 FPS와 무관하게 정상
     * 속도로 자란다. GPU 업로드만 update()(렌더 프레임)에서 dirty trail에 대해 일괄 수행.
     */
    setLatestPositions(latestPositions: { positions: (number[] | undefined)[]; maxSegmentM?: number }): void {
        if (this._stopped) return;
        const arr = latestPositions.positions;
        this.latestPositions = arr;
        // 공급원별 물리 한계(m). 합성 차량(VehicleAggregationFeeder)은 최대 ~40m/s로만 움직이므로
        // 훨씬 타이트한 값을 명시할 수 있다 — dt 기반 추정(저FPS에서 수백 m~1.5km까지 허용)으로는
        // 도시 스케일 줌에서 여전히 "그물"로 보이는 250~1500m 직선을 걸러낼 수 없었다.
        this._feedMaxSegM = latestPositions.maxSegmentM ?? null;

        const n = Math.min(arr.length, this.trails.length);
        for (let i = 0; i < n; i++) {
            const trail = this.trails[i]!;
            const pos = arr[i];
            if (pos == null) {
                this._nullSinceLastPush.add(i);
                if (trail.buffer.count > 0) this._drainingSet.add(i);
                continue;
            }
            // null → 활성 전환: 이전 trail 잔재 제거 (재등장 지점과 직선으로 이어지는 것 방지)
            if (this._nullSinceLastPush.has(i)) {
                this._nullSinceLastPush.delete(i);
                if (trail.buffer.count > 0) {
                    trail.buffer.head = 0;
                    trail.buffer.count = 0;
                    trail.dirty = true;
                }
            }
            this._drainingSet.delete(i);
            this._pushPoint(trail, pos, i);
        }
        this._hasNewPositions = true;
    }

    /**
     * 지정한 trail들만 즉시 초기화 — 공급원이 특정 슬롯의 위치 연속성이 끊김(다른 링크로 재배정,
     * 링크 끝→시작 순환 등)을 알 때 직접 호출한다.
     *
     * ⚠️ 왜 필요한가: "한 tick 동안 undefined를 방출하면 null→활성 전환 리셋이 걸린다"는 방식은
     * 이 primitive가 그 undefined를 **관측**해야만 동작하는데, requestRenderMode에서는 렌더
     * 프레임이 뜸할 수 있어(특히 초기 로딩 중) 다음 feed가 undefined를 덮어버리면 신호가 소실된다
     * — 그러면 10km 미만 점프는 정상 이동으로 간주되어 이전 위치→새 위치 직선 띠가 그려지고,
     * 재배정이 무더기인 초반엔 그물 무늬가 됐다. 동기 호출은 이 경쟁이 원천적으로 없다.
     */
    resetTrails(indices: number[]): void {
        if (this.destroyed) return;
        for (const i of indices) {
            const trail = this.trails[i];
            if (!trail) continue;
            trail.buffer.head = 0;
            trail.buffer.count = 0;
            trail.dirty = false; // 방금 비운 버퍼가 이전 push의 dirty로 재업로드되는 것 방지(무해하지만 낭비)
            if (trail.drawCommand) trail.drawCommand.count = 0;
            this._drainingSet.delete(i);
        }
    }

    start(): void {
        this._stopped = false;
        this._drainingSet.clear();
        this._nullSinceLastPush.clear();
    }

    stop(): void {
        this._stopped = true;
        this.latestPositions = null;
        this._drainingSet.clear();
        this._nullSinceLastPush.clear();
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
            if (trail.drawCommand) trail.drawCommand.count = 0;

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
