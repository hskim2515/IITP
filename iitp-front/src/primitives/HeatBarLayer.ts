import * as Cesium from "cesium";
import { Cartesian3 } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";

// ──────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────
const GRID_CELL_SIZE_M      = 100.0;
const BOX_HEIGHT_MAX        = 300.0;
const NOISE_DECAY           = 0.95;
const NOISE_NORMALIZE_SCALE = 10.0;
const MIN_NOISE_THRESHOLD   = 0.01;   // 이 미만 셀은 DrawCommand push 생략
/** 정규화 기준(max)을 순간값 대신 이 비율로 완만히 따라가게(EMA) 함 — 아래 _maxEma 참고 */
const MAX_EMA_DECAY         = 0.9;

// ──────────────────────────────────────────────
// 내부 타입
// ──────────────────────────────────────────────
interface DrawEntry {
    drawCommand: any;
    modelMatrix: Cesium.Matrix4;
    noiseOffset: Cesium.Cartesian2;
    noiseScale:  Cesium.Cartesian2;
    gridIdx:     number;             // noiseValues 인덱스 (빈 셀 skip용)
}

// ──────────────────────────────────────────────
// ② 네트워크 bbox → 그리드 크기 + 중심 자동 계산
// ──────────────────────────────────────────────
function computeGridFromNetwork(): {
    gridW: number; gridH: number; lon: number; lat: number;
} | null {
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
    const lon    = (minLng + maxLng) / 2;
    const lat    = (minLat + maxLat) / 2;
    const cosLat = Math.cos(lat * Math.PI / 180);
    const eastM  = (maxLng - minLng) * 111320 * cosLat;
    const northM = (maxLat - minLat) * 111320;
    const gridW  = Math.min(80, Math.max(20, Math.ceil(eastM  / GRID_CELL_SIZE_M) + 4));
    const gridH  = Math.min(80, Math.max(20, Math.ceil(northM / GRID_CELL_SIZE_M) + 4));
    return { gridW, gridH, lon, lat };
}

function hexToVec3(colors: string[]): Cesium.Cartesian3[] {
    return colors.map(hex => {
        hex = hex.replace("#", "");
        if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
        return new Cesium.Cartesian3(
            parseInt(hex.slice(0, 2), 16) / 255,
            parseInt(hex.slice(2, 4), 16) / 255,
            parseInt(hex.slice(4, 6), 16) / 255,
        );
    });
}

// ──────────────────────────────────────────────
// HeatBarLayer
//
// 최적화:
//  ② 그리드 자동 크기 (네트워크 bbox, 최대 80×80)
//  ③ 빈 셀 skip (update에서 noise < threshold 셀 push 안 함)
//  ④ center 고정 (네트워크 bbox 중심, 모델 행렬 1회 계산 후 캐시)
// ──────────────────────────────────────────────
export default class HeatBarLayer {

    // ── static scratch ──
    private static readonly _scratchMv          = new Cesium.Matrix4();
    private static readonly _scratchMvp         = new Cesium.Matrix4();
    private static readonly _scratchOffset      = new Cesium.Cartesian3();
    private static readonly _scratchLocalPos    = new Cesium.Cartesian3();
    private static readonly _scratchScale       = new Cesium.Cartesian3();
    private static readonly _scratchScaleMatrix = new Cesium.Matrix4();
    private static readonly _scratchENU         = new Cesium.Matrix4();
    private static readonly _scratchRotation    = new Cesium.Matrix3();
    private static readonly _scratchInvRot      = new Cesium.Matrix3();
    private static readonly _scratchFlipY       = new Cesium.Matrix3(
        1,  0,  0,
        0, -1,  0,
        0,  0,  1,
    );
    private static readonly _scratchAdjRot      = new Cesium.Matrix3();
    private static readonly _scratchOffsetFC    = new Cesium.Cartesian3();
    private static readonly _scratchLocalENU    = new Cesium.Cartesian3();

    // ④ 고정 중심 (네트워크 bbox)
    private readonly _center            = new Cesium.Cartesian3();
    private readonly _modelMatrixCenter = new Cesium.Matrix4();
    private _centerValid = false;

    // ④ ENU 역회전 캐시 (중심 고정 → 1회 계산)
    private readonly _adjRot    = new Cesium.Matrix3();
    private _adjRotReady = false;

    private viewer:       Cesium.Viewer;
    private gridWidth:    number;
    private gridHeight:   number;

    private noiseValues:  Float32Array;
    private noiseTexture: any = null;
    private vertexArray:  any = null;
    private shaderProgram: any = null;
    private drawCommands: DrawEntry[] = [];

    private speed:        number;
    private status:       string;
    private exaggeration: number;
    private colors:       Cesium.Cartesian3[];

    show = false;
    destroyed = false;

    private _frameCount = 0;
    private static readonly NOISE_UPDATE_INTERVAL = 3;

    /** 정규화 기준(max)의 EMA — updateNoiseValues 참고 */
    private _maxEma = 0;
    /** setLatestPositions() 이후 아직 반영 안 한 새 데이터가 있는지 — updateNoiseValues 참고 */
    private _hasNewPositions = false;

    private latestPositions: (number[] | undefined)[] | null = null;

    constructor(
        viewer:       Cesium.Viewer,
        _positions:   number[][],          // 하위 호환 유지
        speed:        number,
        status:       string,
        colors:       string[],
        exaggeration: number,
        gridWidth  = 100,
        gridHeight = 100,
    ) {
        this.viewer       = viewer;
        this.speed        = speed;
        this.status       = status;
        this.exaggeration = exaggeration;
        this.colors       = hexToVec3(colors);

        // ② 네트워크 bbox에서 그리드 크기 + 중심 자동 계산
        const grid = computeGridFromNetwork();
        if (grid) {
            this.gridWidth  = grid.gridW;
            this.gridHeight = grid.gridH;
            const ecef = Cesium.Cartesian3.fromDegrees(grid.lon, grid.lat, 0);
            Cesium.Cartesian3.clone(ecef, this._center);
            Cesium.Transforms.eastNorthUpToFixedFrame(ecef, undefined, this._modelMatrixCenter);
            this._centerValid = true;
        } else {
            this.gridWidth  = gridWidth;
            this.gridHeight = gridHeight;
        }

        this.noiseValues = new Float32Array(this.gridWidth * this.gridHeight);
    }

    // ──────────────────────────────────────────
    // 초기화 (lazy)
    // ──────────────────────────────────────────
    init(): void {
        const context = (this.viewer.scene as any).context;
        this.createNoiseTexture(context);
        this.createGeometry(context);
        this.createDrawCommand(context);
    }

    private createNoiseTexture(context: any): void {
        this.noiseValues = new Float32Array(this.gridWidth * this.gridHeight);
        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues[i] = Math.random() * 0.001; // 거의 0으로 초기화
        }
        this.noiseTexture = new (Cesium as any).Texture({
            context,
            pixelFormat:   Cesium.PixelFormat.RED,
            pixelDatatype: Cesium.PixelDatatype.FLOAT,
            source: {
                width:           this.gridWidth,
                height:          this.gridHeight,
                arrayBufferView: this.noiseValues,
            },
            sampler: new (Cesium as any).Sampler({
                wrapS:               (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                wrapT:               (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                minificationFilter:  (Cesium as any).TextureMinificationFilter.LINEAR,
                magnificationFilter: (Cesium as any).TextureMagnificationFilter.LINEAR,
            }),
        });
    }

    private createGeometry(context: any): void {
        const geometry = Cesium.BoxGeometry.createGeometry(
            new Cesium.BoxGeometry({
                vertexFormat: Cesium.VertexFormat.POSITION_ONLY,
                maximum: new Cesium.Cartesian3(0.5, 0.5, 0.5),
                minimum: new Cesium.Cartesian3(-0.5, -0.5, 0.0),
            })
        )!;

        const positions   = (geometry.attributes as any).position.values as Float32Array;
        const indices     = geometry.indices!;
        const vertexCount = positions.length / 3;

        const stValues   = new Float32Array(vertexCount * 2);
        const posZValues = new Float32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            stValues[i * 2]!     = positions[i * 3]!     + 0.5;
            stValues[i * 2 + 1]! = positions[i * 3 + 1]! + 0.5;
            posZValues[i]        = positions[i * 3 + 2]!;
        }

        this.vertexArray = (Cesium as any).VertexArray.fromGeometry({
            context,
            geometry: new (Cesium as any).Geometry({
                attributes: {
                    position: new Cesium.GeometryAttribute({
                        componentDatatype:     Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 3,
                        values: positions,
                    }),
                    st: new Cesium.GeometryAttribute({
                        componentDatatype:     Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 2,
                        values: stValues,
                    }),
                    posZ: new Cesium.GeometryAttribute({
                        componentDatatype:     Cesium.ComponentDatatype.FLOAT,
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

    private createDrawCommand(context: any): void {
        const vertexShader = `
            layout(location = 0) in vec3  position;
            layout(location = 1) in vec2  st;
            layout(location = 2) in float posZ;

            uniform sampler2D noiseTexture;
            uniform mat4  u_modelViewProjectionMatrix;
            uniform vec2  u_noiseOffset;
            uniform vec2  u_noiseScale;
            uniform float exaggeration;
            out float v_height;
            out float v_density;
            out float v_topFace;
            out vec2  v_cellUv;

            void main() {
                vec2 texCoord;
                if (exaggeration >= 1.0) {
                    texCoord = u_noiseOffset + floor(st * u_noiseScale);
                } else {
                    texCoord = u_noiseOffset + (st * u_noiseScale);
                }

                float noise = texture(noiseTexture, texCoord).r;
                float baseH = noise * ${BOX_HEIGHT_MAX.toFixed(1)} * exaggeration;

                v_height  = baseH;
                v_density = noise;
                v_topFace = posZ;
                v_cellUv  = u_noiseOffset;

                vec3 pos = position;
                if (position.z > 0.0) {
                    pos.z += baseH;
                }
                gl_Position = u_modelViewProjectionMatrix * vec4(pos, 1.0);
            }
        `;

        const fragmentShader = `
            in float v_height;
            in float v_density;
            in float v_topFace;
            in vec2  v_cellUv;

            uniform vec3  grade1Color;
            uniform vec3  grade2Color;
            uniform vec3  grade3Color;
            uniform vec3  grade4Color;

            out vec4 fragColor;

            vec3 colormap(float value) {
                return clamp(
                    value < 0.25 ? grade1Color :
                    value < 0.5  ? grade2Color :
                    value < 0.75 ? grade3Color :
                                   grade4Color,
                    0.0, 1.0
                );
            }

            void main() {
                float normalizedHeight = pow(v_height / ${BOX_HEIGHT_MAX.toFixed(1)}, 1.3);
                vec3 baseColor = colormap(normalizedHeight);

                // 측면 음영
                float shade = 0.30 + v_topFace * 1.40;
                baseColor *= shade;

                fragColor = vec4(baseColor, 0.5);
            }
        `;

        try {
            this.shaderProgram = (Cesium as any).ShaderProgram.fromCache({
                context,
                vertexShaderSource:   vertexShader,
                fragmentShaderSource: fragmentShader,
                attributeLocations: { position: 0, st: 1, posZ: 2 },
            });
        } catch (err) {
            console.error("[HeatBarLayer] shader error:", err);
            return;
        }

        this.drawCommands = [];

        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                const tx = x - this.gridWidth  / 2;
                const ty = y - this.gridHeight / 2;

                // ④ 모델 행렬 1회 계산 후 캐시 (center 고정이므로 매 프레임 재계산 불필요)
                const entryModelMatrix = new Cesium.Matrix4();
                Cesium.Cartesian3.fromElements(
                    tx * GRID_CELL_SIZE_M,
                    ty * GRID_CELL_SIZE_M,
                    0,
                    HeatBarLayer._scratchOffset,
                );
                Cesium.Matrix4.multiplyByPoint(
                    this._modelMatrixCenter,
                    HeatBarLayer._scratchOffset,
                    HeatBarLayer._scratchLocalPos,
                );
                const localMM   = Cesium.Transforms.eastNorthUpToFixedFrame(HeatBarLayer._scratchLocalPos);
                const xyScale   = GRID_CELL_SIZE_M / Math.max(this.exaggeration, 1.0);
                const zScale    = this.exaggeration;
                Cesium.Cartesian3.fromElements(xyScale, xyScale, zScale, HeatBarLayer._scratchScale);
                Cesium.Matrix4.fromScale(HeatBarLayer._scratchScale, HeatBarLayer._scratchScaleMatrix);
                Cesium.Matrix4.multiply(localMM, HeatBarLayer._scratchScaleMatrix, entryModelMatrix);

                const noiseOffset = new Cesium.Cartesian2(x / this.gridWidth,  y / this.gridHeight);
                const noiseScale  = new Cesium.Cartesian2(1.0 / this.gridWidth, 1.0 / this.gridHeight);

                const entry: DrawEntry = {
                    drawCommand: null,
                    modelMatrix: entryModelMatrix,
                    noiseOffset,
                    noiseScale,
                    gridIdx: y * this.gridWidth + x,
                };

                const drawCommand = new (Cesium as any).DrawCommand({
                    vertexArray:   this.vertexArray,
                    shaderProgram: this.shaderProgram,
                    uniformMap: {
                        u_modelViewProjectionMatrix: () => {
                            const view = (this.viewer.scene as any).context.uniformState.view;
                            const proj = (this.viewer.scene as any).context.uniformState.projection;
                            Cesium.Matrix4.multiply(view, entry.modelMatrix, HeatBarLayer._scratchMv);
                            Cesium.Matrix4.multiply(proj, HeatBarLayer._scratchMv, HeatBarLayer._scratchMvp);
                            return HeatBarLayer._scratchMvp;
                        },
                        noiseTexture:  () => this.noiseTexture,
                        u_noiseOffset: () => entry.noiseOffset,
                        u_noiseScale:  () => entry.noiseScale,
                        grade1Color:   () => this.colors[0],
                        grade2Color:   () => this.colors[1],
                        grade3Color:   () => this.colors[2],
                        grade4Color:   () => this.colors[3],
                        exaggeration:  () => this.exaggeration,
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
    // noise 업데이트
    // ──────────────────────────────────────────
    /**
     * @param addNew 새로 도착한 위치 데이터를 이번에 반영할지 여부. false면 decay/재정규화만
     *  수행하고 falloff 추가는 건너뛴다.
     *
     * ⚠️ 왜 분리했는가: update()는 실제 렌더 프레임 주기로 호출되는데(시뮬레이션 재생 중엔
     * requestRenderMode와 무관하게 clock 애니메이션 때문에 사실상 매 프레임=60fps에 가깝게
     * 호출됨), setLatestPositions()로 데이터가 들어오는 주기(VehicleAggregationFeeder는 80ms
     * 간격 setInterval)와 맞지 않는다. 예전엔 이 함수가 항상 "decay + 현재 latestPositions로
     * falloff 추가"를 다 했기 때문에, 같은(아직 안 바뀐) 합성 차량 위치에 대해 falloff가 프레임마다
     * 반복해서 더해졌다 — 80ms 동안 여러 번(20Hz 갱신 기준 4~5회) 같은 자리에 열을 계속 쌓았다가
     * 위치가 실제로 바뀌는 순간 확 빠지는 펌핑이 "실행하면 깜빡"의 정체였다(근거리 실차량은 매
     * 프레임 실제로 위치가 갱신되니 이 문제가 없었다). 이제 falloff 추가는 setLatestPositions()가
     * 호출된 뒤 딱 한 번만 반영하고(_hasNewPositions), decay/재정규화만 프레임마다 계속한다.
     */
    private updateNoiseValues(positions: (number[] | undefined)[], addNew: boolean): void {
        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues[i]! *= NOISE_DECAY;
        }

        if (addNew) {
            // ④ 중심 고정 → adjRot 1회만 계산
            if (!this._adjRotReady) {
                Cesium.Transforms.eastNorthUpToFixedFrame(this._center, undefined, HeatBarLayer._scratchENU);
                Cesium.Matrix4.getMatrix3(HeatBarLayer._scratchENU, HeatBarLayer._scratchRotation);
                Cesium.Matrix3.transpose(HeatBarLayer._scratchRotation, HeatBarLayer._scratchInvRot);
                Cesium.Matrix3.multiply(HeatBarLayer._scratchFlipY, HeatBarLayer._scratchInvRot, HeatBarLayer._scratchAdjRot);
                Cesium.Matrix3.clone(HeatBarLayer._scratchAdjRot, this._adjRot);
                this._adjRotReady = true;
            }

            for (const position of positions) {
                if (!position) continue;
                const worldPos = new Cartesian3(position[0]!, position[1]!, position[2]!);
                Cesium.Cartesian3.subtract(worldPos, this._center, HeatBarLayer._scratchOffsetFC);
                Cesium.Matrix3.multiplyByVector(this._adjRot, HeatBarLayer._scratchOffsetFC, HeatBarLayer._scratchLocalENU);

                const gridX  = Math.floor(HeatBarLayer._scratchLocalENU.x / GRID_CELL_SIZE_M + this.gridWidth  / 2);
                const gridY  = Math.floor(HeatBarLayer._scratchLocalENU.y / GRID_CELL_SIZE_M + this.gridHeight / 2);
                const radius = Math.floor(1.0 / (this.exaggeration || 0.1));

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const gx = gridX + dx;
                        const gy = gridY + dy;
                        if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) continue;
                        const dist    = Math.sqrt(dx * dx + dy * dy);
                        const falloff = Math.pow(Math.max(1.0 - dist / (radius + 0.1), 0.0), this.exaggeration);
                        this.noiseValues[gy * this.gridWidth + gx]! += falloff;
                    }
                }
            }
        }

        let max = 0.0;
        for (let i = 0; i < this.noiseValues.length; i++) {
            if (this.noiseValues[i]! > max) max = this.noiseValues[i]!;
        }
        // ⚠️ 순간 max로 즉시 정규화하면, 소수의 차량(특히 합성 차량처럼 적은 수가 결정론적으로
        // 이동하는 소스)이 셀을 옮겨다닐 때마다 "현재 최대값" 자체가 바뀌어 그리드 전체 밝기가
        // 그 비율만큼 통째로 출렁인다 — 이게 매 갱신(3프레임≈20Hz)마다 반복되며 "거의 프레임마다
        // 깜빡"으로 보이는 원인이었다. 정규화 기준을 EMA로 완만히 따라가게 해 순간적인 max 변화가
        // 스케일을 급변시키지 않도록 한다(실제 개별 차량처럼 소스가 많아 max가 원래도 안정적인
        // 경우엔 EMA가 즉시 실제값에 수렴하므로 체감 차이가 없음).
        this._maxEma = this._maxEma > 0 ? this._maxEma * MAX_EMA_DECAY + max * (1 - MAX_EMA_DECAY) : max;
        const norm = this._maxEma > 0.001 ? this._maxEma : max;
        if (norm > 0) {
            for (let i = 0; i < this.noiseValues.length; i++) {
                this.noiseValues[i] = (this.noiseValues[i]! / norm) * NOISE_NORMALIZE_SCALE;
            }
        }

        this.noiseTexture.copyFrom({
            source: {
                width:           this.gridWidth,
                height:          this.gridHeight,
                arrayBufferView: this.noiseValues,
            },
        });
    }

    // ──────────────────────────────────────────
    // 매 프레임 업데이트
    // ──────────────────────────────────────────
    update(frameState: any): void {
        if (this.destroyed || !this.show || !this.latestPositions) return;
        if (this.latestPositions.filter(p => p != null).length === 0) return;

        // ④ 네트워크 bbox가 없을 때만 positions로 보정 (1회)
        if (!this._centerValid) {
            let sx = 0, sy = 0, sz = 0, cnt = 0;
            for (const p of this.latestPositions) {
                if (p) { sx += p[0]!; sy += p[1]!; sz += p[2]!; cnt++; }
            }
            if (cnt === 0) return;
            const c = new Cesium.Cartesian3(sx / cnt, sy / cnt, sz / cnt);
            Cesium.Cartesian3.clone(c, this._center);
            Cesium.Transforms.eastNorthUpToFixedFrame(c, undefined, this._modelMatrixCenter);
            this._centerValid = true;
        }

        if (!this.noiseTexture) {
            this.init();
            if (this.drawCommands.length === 0) return;
        }

        // ⚠️ _frameCount는 새 데이터가 실제로 도착했을 때만 증가시킨다. 예전엔 렌더 프레임마다
        // 무조건 증가시켰는데, update()의 실제 호출 주기(렌더 프레임, 애니메이션 중엔 최대 60fps)
        // 와 데이터 공급 주기(VehicleAggregationFeeder.tick()의 80ms setInterval)가 어긋나서, 가끔
        // "새 데이터 없이" 이 게이트에 걸리는 프레임이 생겼다 — 그 프레임엔 decay만 일어나고 falloff
        // 재추가가 없어(addNew=false), falloff 반경 가장자리처럼 MIN_NOISE_THRESHOLD 근처의 셀은
        // 그 한 번의 decay만으로 임계값 아래로 떨어졌다가 다음 정상 사이클에 다시 넘어오는 식으로
        // 개별 셀이 깜빡였다. 새 데이터 도착 시에만 게이트를 진행시키면 decay+재추가가 항상 짝을
        // 맞춰 실행되어 매번 같은 안정된 값으로 수렴한다(중간에 decay만 있는 프레임이 없음).
        if (this._hasNewPositions) {
            this._frameCount++;
        }
        if (this._hasNewPositions && this._frameCount % HeatBarLayer.NOISE_UPDATE_INTERVAL === 0) {
            this.updateNoiseValues(this.latestPositions, true);
            this._hasNewPositions = false;
        }

        // ③ 빈 셀 skip: noise < threshold인 셀은 push 안 함
        for (const entry of this.drawCommands) {
            if (this.noiseValues[entry.gridIdx]! >= MIN_NOISE_THRESHOLD) {
                frameState.commandList.push(entry.drawCommand);
            }
        }
    }

    // ──────────────────────────────────────────
    // setters
    // ──────────────────────────────────────────
    setSpeed(speed: number):      void { this.speed        = speed; }
    setStatus(status: string):    void { this.status       = status; }
    setColors(colors: string[]):  void { this.colors       = hexToVec3(colors); }
    setExaggeration(e: number):   void { this.exaggeration = e; }

    setLatestPositions(latestPositions: { positions: (number[] | undefined)[] }): void {
        this.latestPositions = latestPositions.positions;
        this._hasNewPositions = true;
    }

    // ──────────────────────────────────────────
    // 리소스 해제
    // ──────────────────────────────────────────
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed     = true;
        this.noiseTexture?.destroy();
        this.noiseTexture  = null;
        this.vertexArray?.destroy();
        this.vertexArray   = null;
        this.shaderProgram?.destroy();
        this.shaderProgram = null;
        this.drawCommands  = [];
    }
}
