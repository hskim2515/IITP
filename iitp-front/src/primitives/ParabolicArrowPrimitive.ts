import * as Cesium from "cesium";
import {Cartesian3} from "cesium";
import {computeODMatrix, parseRawODInputFromFlatArray} from "@utils/transform";

export default class ParabolicArrowPrimitive {
    private context: Cesium.Context;
    private drawCommand: Cesium.DrawCommand;
    private shaderProgram: Cesium.ShaderProgram;
    private vertexArray: Cesium.VertexArray;
    private vertexBuffer: Cesium.Buffer;
    private positions: Cesium.Cartesian3[];
    private ready: boolean = false;
    private show: boolean = false;
    private latestPositions: any;
    private arrows: any[];
    private odData: any;

    constructor(
        context: Cesium.Context,
        positions : [],
    ) {
        this.context = context;
        this.positions = positions;
        this.arrows = [];
    }

    private createResources(density: number, positions: Cesium.Cartesian3[]) : {
        vertexArray: Cesium.VertexArray;
        shaderProgram: Cesium.ShaderProgram;
        drawCommand: Cesium.DrawCommand;
    }  {
        //const avgDensity = (this.positions.length > 0) ? (this.positions.length / 64) : 1.0;
        const widthInMeters = Math.max(10.0, density * 200); // 밀도 기반 너비 (최소값 보장)

        const expanded: number[] = [];

        for (let i = 1; i < positions.length - 1; i++) {
            const width = widthInMeters * (1.0 - i / positions.length); // 끝으로 갈수록 얇아짐

            const p = positions[i];
            const next = positions[Math.min(i + 1, positions.length - 1)];
            const dir = Cesium.Cartesian3.subtract(next, p, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(dir, dir);

            const up = Cesium.Cartesian3.normalize(p, new Cesium.Cartesian3());
            const right = Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(right, right);
            Cesium.Cartesian3.multiplyByScalar(right, width / 2, right);

            const leftPoint = Cesium.Cartesian3.subtract(p, right, new Cesium.Cartesian3());
            const rightPoint = Cesium.Cartesian3.add(p, right, new Cesium.Cartesian3());

            expanded.push(leftPoint.x, leftPoint.y, leftPoint.z);
            expanded.push(rightPoint.x, rightPoint.y, rightPoint.z);
        }

        const positionArray = new Float32Array(expanded);

        const vertexBuffer = Cesium.Buffer.createVertexBuffer({
            context: this.context,
            typedArray: positionArray,
            usage: Cesium.BufferUsage.STATIC_DRAW,
        });

        const vertexArray = new Cesium.VertexArray({
            context: this.context,
            attributes: [
                {
                    index: 0,
                    vertexBuffer: vertexBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
            ],
        });

        const shaderProgram = Cesium.ShaderProgram.fromCache({
            context: this.context,
            vertexShaderSource: `
                #version 300 es
                in vec3 a_position;
                uniform mat4 u_modelViewProjectionMatrix;
                void main() {
                    gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;
                uniform float u_density;
                uniform float u_alpha;
                out vec4 fragColor;

                void main() {
                    vec3 lowColor = vec3(1.0, 1.0, 0.5); // 연노랑
                    vec3 highColor = vec3(1.0, 0.0, 0.0); // 빨강
                    vec3 color = mix(lowColor, highColor, clamp(u_density, 0.0, 0.8));
                    fragColor = vec4(color, u_alpha);
                }
            `,
            attributeLocations: {
                a_position: 0,
            },
        });

        const drawCommand = new Cesium.DrawCommand({
            vertexArray: vertexArray,
            shaderProgram: shaderProgram,
            uniformMap: {
                u_modelViewProjectionMatrix: () => this.context.uniformState.modelViewProjection,
                u_density: () => density,
                u_alpha:   () => this._alpha,
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
            renderState: Cesium.RenderState.fromCache({
                depthTest: { enabled: true },
                blending:  Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;

        return {
            vertexArray,
            shaderProgram,
            drawCommand,
        };
    }

    private _alpha = 1.0;
    destroyed = false;

    update(frameState: Cesium.FrameState) {
        if (this.destroyed) return;
        if(this.odData && this.show){
            this.cleanupResources();

            this.odData.forEach(cell => {
                // fromCoord, toCoord로부터 바로 Cartesian3 생성
                const fromCenter = Cesium.Cartesian3.fromDegrees(cell.fromCoord[0], cell.fromCoord[1], 0);
                const toCenter = Cesium.Cartesian3.fromDegrees(cell.toCoord[0], cell.toCoord[1], 0);

                const positions = this.computeParabolicPositions(fromCenter, toCenter, cell.density);
                const arrow = this.createResources(cell.density, positions);
                this.arrows.push(arrow);
            });

            this.arrows.forEach((arrow) => {
                frameState.commandList.push(arrow.drawCommand);
            });
        }

    }


    setSpeed(speed: number) {
        this.speed = speed;
    }

    setStatus(status: string) {
        this.status = status;
    }

    setVisible(visible: boolean) {
        this.show = visible;
    }

    setOpacity(opacity: number) {
        this._alpha = Math.max(0, Math.min(1, opacity));
    }

    setLatestPositions(latestPositions) {
        this.latestPositions = latestPositions;
    }
    setOdData(odData: any) {
        this.odData = odData;
    }

    destroy() {
        this.destroyed = true;
        this.cleanupResources();
        this.vertexBuffer?.destroy();
        this.vertexArray?.destroy();
        this.shaderProgram?.destroy();
    }

    cleanupResources() {
        this.arrows.forEach(arrow => {
            if (arrow.drawCommand?.vertexArray) {
                arrow.drawCommand.vertexArray.destroy();
            }
            if (arrow.drawCommand?.shaderProgram) {
                arrow.drawCommand.shaderProgram.destroy();
            }
            if (arrow.drawCommand?.uniformMap?.noiseTexture?.destroy) {
                arrow.drawCommand.uniformMap.noiseTexture.destroy();
            }
            // 기타 커스텀 리소스가 있으면 여기서 추가 해제
        });
        this.arrows = [];
    }


    private computeParabolicPositions(
        start: Cesium.Cartesian3,
        end: Cesium.Cartesian3,
        density: number
    ): Cesium.Cartesian3[] {
        const granularity = 64;
        const positions: Cesium.Cartesian3[] = [];

        const startCarto = Cesium.Cartographic.fromCartesian(start);
        const endCarto = Cesium.Cartographic.fromCartesian(end);

        const geoDistance = Cesium.Cartesian3.distance(start, end);
        const heightBoost = geoDistance * 0.2 + density * 300; // 거리 기반 + 밀도 영향

        for (let i = 0; i <= granularity; i++) {
            const t = i / granularity;
            const lon = Cesium.Math.lerp(startCarto.longitude, endCarto.longitude, t);
            const lat = Cesium.Math.lerp(startCarto.latitude, endCarto.latitude, t);
            const h = Cesium.Math.lerp(startCarto.height, endCarto.height, t);
            const curveHeight = h + 4 * heightBoost * t * (1 - t);
            positions.push(Cesium.Cartesian3.fromRadians(lon, lat, curveHeight));
        }

        return positions;
    }

}

