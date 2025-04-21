import * as Cesium from "cesium";

export default class ParabolicArrowPrimitive {
    private context: Cesium.Context;
    private drawCommand: Cesium.DrawCommand;
    private shaderProgram: Cesium.ShaderProgram;
    private vertexArray: Cesium.VertexArray;
    private vertexBuffer: Cesium.Buffer;
    private positions: Cesium.Cartesian3[];
    private ready: boolean = false;
    private show: boolean = true;

    constructor(
        context: Cesium.Context,
        start: Cesium.Cartesian3,
        end: Cesium.Cartesian3,
        density: number,
    ) {
        this.context = context;
        this.positions = this.computeParabolicPositions(start, end, density);
        this.density = density;
        this.createResources();
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
        console.log(density)
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

    private createResources() {
        //const avgDensity = (this.positions.length > 0) ? (this.positions.length / 64) : 1.0;
        const widthInMeters = Math.max(10.0, this.density * 200); // 밀도 기반 너비 (최소값 보장)

        const expanded: number[] = [];

        for (let i = 1; i < this.positions.length - 1; i++) {
            const width = widthInMeters * (1.0 - i / this.positions.length); // 끝으로 갈수록 얇아짐

            const p = this.positions[i];
            const next = this.positions[Math.min(i + 1, this.positions.length - 1)];
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

        this.vertexBuffer = Cesium.Buffer.createVertexBuffer({
            context: this.context,
            typedArray: positionArray,
            usage: Cesium.BufferUsage.STATIC_DRAW,
        });

        this.vertexArray = new Cesium.VertexArray({
            context: this.context,
            attributes: [
                {
                    index: 0,
                    vertexBuffer: this.vertexBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
            ],
        });

        this.shaderProgram = Cesium.ShaderProgram.fromCache({
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
                out vec4 fragColor;
                
                void main() {
                    vec3 lowColor = vec3(1.0, 1.0, 0.5); // 연노랑
                    vec3 highColor = vec3(1.0, 0.0, 0.0); // 빨강
                    vec3 color = mix(lowColor, highColor, clamp(u_density, 0.0, 0.8));
                    fragColor = vec4(color, 1.0);
                }
            `,
            attributeLocations: {
                a_position: 0,
            },
        });

        this.drawCommand = new Cesium.DrawCommand({
            vertexArray: this.vertexArray,
            shaderProgram: this.shaderProgram,
            uniformMap: {
                u_modelViewProjectionMatrix: () => this.context.uniformState.modelViewProjection,
                u_density: () => this.density,
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
            renderState: Cesium.RenderState.fromCache({
                depthTest: { enabled: true },
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState: Cesium.FrameState) {
        if (this.ready && this.show) {
            frameState.commandList.push(this.drawCommand);
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

    destroy() {
        this.vertexBuffer?.destroy();
        this.vertexArray?.destroy();
        this.shaderProgram?.destroy();
    }
}

