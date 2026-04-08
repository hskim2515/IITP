import * as Cesium from "cesium";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";

// ──────────────────────────────────────────────
// 공개 상수 (SpeedHeatmapOlLayer에서 import)
// ──────────────────────────────────────────────
export const SPEED_GRID_COLS   = 50;
export const SPEED_GRID_ROWS   = 50;
export const SPEED_CELL_SIZE_M = 100.0;
export const SPEED_FREE_FLOW   = 20.0;

const UPDATE_INTERVAL = 3;
const SPEED_DECAY     = 0.97;
const EMA_BLEND       = 0.35;
const MAX_HEIGHT      = 200.0;

interface DrawEntry {
    drawCommand:  any;
    modelMatrix:  Cesium.Matrix4;
    x: number;
    y: number;
}

// ── 네트워크 중심 (WGS84) ──────────────────────
function computeNetworkCenter(): { lon: number; lat: number } | null {
    const net = (useNetworkStore.getState().currentJsonData
              ?? useNetworkStore.getState().originData) as any;
    if (!net?.links?.length) return null;
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const link of net.links) {
        for (const c of (link.coordinates ?? [])) {
            if (c.lat < minLat) minLat = c.lat;
            if (c.lat > maxLat) maxLat = c.lat;
            if (c.lng < minLng) minLng = c.lng;
            if (c.lng > maxLng) maxLng = c.lng;
        }
    }
    if (!isFinite(minLat)) return null;
    return { lon: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
}

// ──────────────────────────────────────────────
// SpeedHeatmapLayer  (HeatBarLayer 패턴 기반)
//
// · 50×50 박스 DrawCommand (내부 API, HeatBarLayer와 동일 방식)
// · 버텍스 셰이더에서 speed 텍스처 읽어 높이 결정
//   height = (1-speed) × MAX_HEIGHT  (정체=높음, 자유주행=낮음)
// · 파동 애니메이션: phaseShift = (1-speed)×4  →  정체→자유주행 방향으로 흘러감
// · 프래그먼트: 측면 음영 + 스펙큘러 → 물 표면 질감
// ──────────────────────────────────────────────
export default class SpeedHeatmapLayer {

    // ── scratch (GC 방지) ──
    private static readonly _scratchOffset      = new Cesium.Cartesian3();
    private static readonly _scratchLocalPos    = new Cesium.Cartesian3();
    private static readonly _scratchScale       = new Cesium.Cartesian3();
    private static readonly _scratchScaleMatrix = new Cesium.Matrix4();
    private static readonly _scratchMv          = new Cesium.Matrix4();
    private static readonly _scratchMvp         = new Cesium.Matrix4();

    show = false;
    private destroyed = false;
    private _viewer: Cesium.Viewer;
    private _opacity = 1.0;

    // Cesium 내부 API (HeatBarLayer와 동일 패턴)
    private speedTexture: any = null;
    private vertexArray:  any = null;
    private shaderProgram: any = null;
    private drawCommands: DrawEntry[] = [];

    public speedValues: Float32Array;

    // 고정 중심 (네트워크 bbox)
    private readonly _center           = new Cesium.Cartesian3();
    private readonly _modelMatrixCenter = new Cesium.Matrix4();
    private _centerValid = false;

    private _frameCount = 0;
    private latestPositions: (number[] | null)[] | null = null;
    private latestSpeeds:    (number | null)[] | null    = null;

    constructor(viewer: Cesium.Viewer) {
        this._viewer     = viewer;
        this.speedValues = new Float32Array(SPEED_GRID_COLS * SPEED_GRID_ROWS).fill(-1);

        const nc = computeNetworkCenter();
        if (nc) {
            const ecef = Cesium.Cartesian3.fromDegrees(nc.lon, nc.lat, 0);
            Cesium.Cartesian3.clone(ecef, this._center);
            Cesium.Transforms.eastNorthUpToFixedFrame(ecef, undefined, this._modelMatrixCenter);
            this._centerValid = true;
        }
    }

    // ──────────────────────────────────────────
    // setters
    // ──────────────────────────────────────────
    setLatestPositions(data: { positions: (number[] | null)[]; speeds?: (number | null)[] }): void {
        this.latestPositions = data.positions;
        this.latestSpeeds    = data.speeds ?? null;

        if (!this._centerValid && data.positions) {
            let sumLon = 0, sumLat = 0, cnt = 0;
            for (const p of data.positions) {
                if (!p) continue;
                try {
                    const c = Cartographic.fromCartesian(
                        { x: p[0]!, y: p[1]!, z: p[2]! } as any, Ellipsoid.WGS84);
                    sumLon += CesiumMath.toDegrees(c.longitude);
                    sumLat += CesiumMath.toDegrees(c.latitude);
                    cnt++;
                } catch { /* skip */ }
            }
            if (cnt > 0) {
                const ecef = Cesium.Cartesian3.fromDegrees(sumLon / cnt, sumLat / cnt, 0);
                Cesium.Cartesian3.clone(ecef, this._center);
                Cesium.Transforms.eastNorthUpToFixedFrame(ecef, undefined, this._modelMatrixCenter);
                this._centerValid = true;
            }
        }
    }

    setSpeed(_s: number):  void {}
    setStatus(_s: string): void {}

    setOpacity(opacity: number): void {
        this._opacity = Math.max(0, Math.min(1, opacity));
    }

    // ──────────────────────────────────────────
    // 초기화 (lazy)
    // ──────────────────────────────────────────
    private _init(): void {
        const context = (this._viewer.scene as any).context;
        this._createTexture(context);
        this._createGeometry(context);
        this._createDrawCommands(context);
    }

    private _createTexture(context: any): void {
        this.speedTexture = new (Cesium as any).Texture({
            context,
            pixelFormat:   Cesium.PixelFormat.RED,
            pixelDatatype: Cesium.PixelDatatype.FLOAT,
            source: {
                width:           SPEED_GRID_COLS,
                height:          SPEED_GRID_ROWS,
                arrayBufferView: this.speedValues,
            },
            sampler: new (Cesium as any).Sampler({
                wrapS: (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                wrapT: (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                minificationFilter:  (Cesium as any).TextureMinificationFilter.LINEAR,
                magnificationFilter: (Cesium as any).TextureMagnificationFilter.LINEAR,
            }),
        });
    }

    // HeatBarLayer.createGeometry() 와 동일 구조
    private _createGeometry(context: any): void {
        const geometry = Cesium.BoxGeometry.createGeometry(
            new Cesium.BoxGeometry({
                vertexFormat: Cesium.VertexFormat.POSITION_ONLY,
                maximum: new Cesium.Cartesian3( 0.5,  0.5, 0.5),
                minimum: new Cesium.Cartesian3(-0.5, -0.5, 0.0),
            })
        )!;

        const positions   = (geometry.attributes as any).position.values as Float32Array;
        const indices     = geometry.indices!;
        const vertexCount = positions.length / 3;

        // st: xy 평면 상 0~1 좌표 (박스 측면 음영용)
        const stValues = new Float32Array(vertexCount * 2);
        for (let i = 0; i < vertexCount; i++) {
            stValues[i * 2]!     = positions[i * 3]!     + 0.5;
            stValues[i * 2 + 1]! = positions[i * 3 + 1]! + 0.5;
        }

        // posZ: 버텍스 z (0=바닥, 0.5=꼭대기) → 프래그먼트로 전달
        const posZValues = new Float32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            posZValues[i] = positions[i * 3 + 2]!;
        }

        this.vertexArray = (Cesium as any).VertexArray.fromGeometry({
            context,
            geometry: new (Cesium as any).Geometry({
                attributes: {
                    position: new Cesium.GeometryAttribute({
                        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 3,
                        values: positions,
                    }),
                    st: new Cesium.GeometryAttribute({
                        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 2,
                        values: stValues,
                    }),
                    posZ: new Cesium.GeometryAttribute({
                        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 1,
                        values: posZValues,
                    }),
                },
                indices,
                primitiveType: Cesium.PrimitiveType.TRIANGLES,
            }),
            attributeLocations: { position: 0, st: 1, posZ: 2 },
        });
    }

    private _createDrawCommands(context: any): void {
        // ── 버텍스 셰이더 ──────────────────────────────────────────
        // HeatBarLayer 패턴: position.z > 0 인 꼭대기만 height 만큼 올림
        // phaseShift = (1-speed)×4  →  정체 구간이 위상 선행 → 파동이 정체→자유주행 방향으로 흐름
        const vertexShader = `
            layout(location = 0) in vec3 position;
            layout(location = 1) in vec2 st;
            layout(location = 2) in float posZ;

            uniform sampler2D speedTexture;
            uniform mat4      u_mvp;
            uniform vec2      u_cellUv;
            uniform float     u_time;

            out float v_speed;
            out float v_height;
            out float v_topFace;   // 1=꼭대기, 0=측면/바닥

            void main() {
                float spd = texture(speedTexture, u_cellUv).r;
                v_speed = spd;

                float height = 0.0;
                if (spd >= 0.0) {
                    float s = clamp(spd, 0.0, 1.0);

                    // 기본 높이: 정체(0)=높음, 자유주행(1)=낮음
                    float baseH = (1.0 - s) * ${MAX_HEIGHT.toFixed(1)};

                    // 위상 앞서기: 정체 구간 파동이 앞서 → 자유주행 방향으로 흘러 보임
                    float phaseShift = (1.0 - s) * 4.0;

                    float px = u_cellUv.x;
                    float py = u_cellUv.y;
                    float t  = u_time;

                    // 3파 간섭 (대각 + x + y 방향)
                    float w1 = sin(px * 20.0 + py * 13.0 - t * 2.4 + phaseShift);
                    float w2 = sin(px * 11.0 - py * 17.0 + t * 1.8 + phaseShift * 0.7);
                    float w3 = sin((px + py) * 15.0     - t * 1.6 + phaseShift * 0.5);
                    float wave = (w1 * 0.42 + w2 * 0.34 + w3 * 0.24) * 0.5 + 0.5;

                    height = baseH * (0.50 + wave * 1.00);
                }

                v_height  = height;
                v_topFace = posZ;   // 0=바닥, 0.5=꼭대기

                vec3 pos = position;
                if (position.z > 0.0) {
                    pos.z += height;   // HeatBarLayer와 동일: 꼭대기만 올림
                }
                gl_Position = u_mvp * vec4(pos, 1.0);
            }
        `;

        // ── 프래그먼트 셰이더 ──────────────────────────────────────
        const fragmentShader = `
            in float v_speed;
            in float v_height;
            in float v_topFace;

            uniform float u_time;
            uniform float u_opacity;

            out vec4 fragColor;

            void main() {
                if (v_speed  < 0.0) discard;
                if (v_height < 1.0) discard;

                float s = clamp(v_speed, 0.0, 1.0);

                // 색상: 빨강(정체) → 노랑 → 파랑(자유주행)
                vec3 congested = vec3(0.92, 0.12, 0.08);
                vec3 medium    = vec3(1.00, 0.78, 0.04);
                vec3 freeflow  = vec3(0.08, 0.55, 1.00);
                vec3 baseColor;
                if (s < 0.5) baseColor = mix(congested, medium,   s * 2.0);
                else         baseColor = mix(medium,    freeflow, (s - 0.5) * 2.0);

                // 측면 음영: 꼭대기=밝음, 바닥/측면=어두움 (v_topFace=0.5 꼭대기, 0 바닥)
                float shade = 0.30 + v_topFace * 1.40;

                // 꼭대기 스펙큘러 하이라이트 (물 반짝임)
                float pulse   = 0.5 + 0.5 * sin(u_time * 2.8);
                float specular = v_topFace > 0.3
                    ? pow(max(0.0, pulse - 0.55), 2.0) * 2.5
                    : 0.0;

                vec3 finalColor = baseColor * shade
                                + vec3(0.80, 0.92, 1.00) * specular * 0.45;

                // 알파: 정체=불투명, 자유주행=반투명
                float alpha = mix(0.88, 0.38, s) * u_opacity;
                fragColor = vec4(finalColor, alpha);
            }
        `;

        try {
            this.shaderProgram = (Cesium as any).ShaderProgram.fromCache({
                context,
                vertexShaderSource:   vertexShader,
                fragmentShaderSource: fragmentShader,
                attributeLocations:   { position: 0, st: 1, posZ: 2 },
            });
        } catch (err) {
            console.error("[SpeedHeatmapLayer] shader error:", err);
            return;
        }

        this.drawCommands = [];

        for (let gy = 0; gy < SPEED_GRID_ROWS; gy++) {
            for (let gx = 0; gx < SPEED_GRID_COLS; gx++) {
                const tx = gx - SPEED_GRID_COLS / 2;
                const ty = gy - SPEED_GRID_ROWS / 2;

                const entryModelMatrix = new Cesium.Matrix4();

                // 셀 UV (텍스처 좌표, 고정)
                const cellUv = new Cesium.Cartesian2(
                    (gx + 0.5) / SPEED_GRID_COLS,
                    (gy + 0.5) / SPEED_GRID_ROWS,
                );

                // 셀 중심 → ECEF 좌표계 modelMatrix (고정 중심이므로 1회 계산)
                Cesium.Cartesian3.fromElements(
                    tx * SPEED_CELL_SIZE_M,
                    ty * SPEED_CELL_SIZE_M,
                    0,
                    SpeedHeatmapLayer._scratchOffset
                );
                Cesium.Matrix4.multiplyByPoint(
                    this._modelMatrixCenter,
                    SpeedHeatmapLayer._scratchOffset,
                    SpeedHeatmapLayer._scratchLocalPos
                );
                const localMM = Cesium.Transforms.eastNorthUpToFixedFrame(
                    SpeedHeatmapLayer._scratchLocalPos
                );
                const cellScale = SPEED_CELL_SIZE_M * 0.92;
                Cesium.Cartesian3.fromElements(
                    cellScale, cellScale, 1.0,
                    SpeedHeatmapLayer._scratchScale
                );
                Cesium.Matrix4.fromScale(
                    SpeedHeatmapLayer._scratchScale,
                    SpeedHeatmapLayer._scratchScaleMatrix
                );
                Cesium.Matrix4.multiply(localMM, SpeedHeatmapLayer._scratchScaleMatrix, entryModelMatrix);

                const entry: DrawEntry = {
                    drawCommand: null,
                    modelMatrix: entryModelMatrix,
                    x: gx,
                    y: gy,
                };

                const drawCommand = new (Cesium as any).DrawCommand({
                    vertexArray:   this.vertexArray,
                    shaderProgram: this.shaderProgram,
                    uniformMap: {
                        speedTexture: () => this.speedTexture,
                        u_mvp: () => {
                            const view = (this._viewer.scene as any).context.uniformState.view;
                            const proj = (this._viewer.scene as any).context.uniformState.projection;
                            Cesium.Matrix4.multiply(view, entry.modelMatrix, SpeedHeatmapLayer._scratchMv);
                            Cesium.Matrix4.multiply(proj, SpeedHeatmapLayer._scratchMv, SpeedHeatmapLayer._scratchMvp);
                            return SpeedHeatmapLayer._scratchMvp;
                        },
                        u_cellUv: () => cellUv,
                        u_time:   () => performance.now() / 1000.0,
                        u_opacity: () => this._opacity,
                    },
                    renderState: (Cesium as any).RenderState.fromCache({
                        depthTest: { enabled: true },
                        blending:  Cesium.BlendingState.ALPHA_BLEND,
                    }),
                    pass: (Cesium as any).Pass.OPAQUE,
                });

                entry.drawCommand = drawCommand;
                this.drawCommands.push(entry);
            }
        }
    }

    // ──────────────────────────────────────────
    // EMA 그리드 업데이트
    // ──────────────────────────────────────────
    private _updateGrid(): void {
        if (!this._centerValid) return;
        const positions = this.latestPositions!;
        const speeds    = this.latestSpeeds!;

        for (let i = 0; i < this.speedValues.length; i++) {
            if (this.speedValues[i]! >= 0) this.speedValues[i]! *= SPEED_DECAY;
        }

        const ecef   = this._center;
        const cosLat = Math.cos(Cesium.Cartographic.fromCartesian(ecef).latitude);

        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            const v = speeds ? speeds[i] : null;
            if (!p || v == null) continue;
            let lon: number, lat: number;
            try {
                const c = Cartographic.fromCartesian(
                    { x: p[0]!, y: p[1]!, z: p[2]! } as any, Ellipsoid.WGS84);
                lon = CesiumMath.toDegrees(c.longitude);
                lat = CesiumMath.toDegrees(c.latitude);
            } catch { continue; }

            const cCart = Cartographic.fromCartesian(ecef);
            const cLon  = CesiumMath.toDegrees(cCart.longitude);
            const cLat  = CesiumMath.toDegrees(cCart.latitude);

            const eastM  = (lon - cLon) * (111320 * cosLat);
            const northM = (lat - cLat) * 111320;
            const gx = Math.floor(eastM / SPEED_CELL_SIZE_M + SPEED_GRID_COLS / 2);
            const gy = Math.floor(northM / SPEED_CELL_SIZE_M + SPEED_GRID_ROWS / 2);
            if (gx < 0 || gx >= SPEED_GRID_COLS || gy < 0 || gy >= SPEED_GRID_ROWS) continue;

            const idx = gy * SPEED_GRID_COLS + gx;
            const ns  = Math.min(v / SPEED_FREE_FLOW, 1.0);
            this.speedValues[idx] = this.speedValues[idx]! < 0
                ? ns
                : this.speedValues[idx]! * (1 - EMA_BLEND) + ns * EMA_BLEND;
        }

        // GPU 텍스처 업로드 (HeatBarLayer.noiseTexture.copyFrom 과 동일)
        this.speedTexture.copyFrom({
            source: {
                width:           SPEED_GRID_COLS,
                height:          SPEED_GRID_ROWS,
                arrayBufferView: this.speedValues,
            },
        });
    }

    // ──────────────────────────────────────────
    // 매 프레임 호출
    // ──────────────────────────────────────────
    update(frameState: any): void {
        if (this.destroyed || !this.show || !this.latestPositions) return;

        if (!this.speedTexture) {
            if (!this._centerValid) return;
            this._init();
            if (this.drawCommands.length === 0) return;
        }

        this._frameCount++;
        if (this._frameCount % UPDATE_INTERVAL === 0 && this.latestSpeeds) {
            this._updateGrid();
        }

        // DrawCommand push (u_time은 uniformMap 람다에서 실시간 계산)
        for (const entry of this.drawCommands) {
            frameState.commandList.push(entry.drawCommand);
        }
    }

    // ──────────────────────────────────────────
    // 리소스 해제
    // ──────────────────────────────────────────
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.speedTexture?.destroy();
        this.vertexArray?.destroy();
        this.shaderProgram?.destroy();
        this.speedTexture  = null;
        this.vertexArray   = null;
        this.shaderProgram = null;
        this.drawCommands  = [];
    }
}
