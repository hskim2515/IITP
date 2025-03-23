import * as Cesium from "cesium";

export default class VehicleRootPrimitive {
    constructor(positions, context) {
        this.positions = positions;
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.destroyed = false;
        this.tailPositions = [];
        this.progress = 0;
        this.maxVertices = 3; // TRIANGLE_STRIP을 위한 최대 정점 개수
        this.thickness = 5.0; // 선 두께
        this.startPosition = positions[0];
        this.tails = 0

        this.createResources();
    }

    createResources() {

        // 정점 배열 초기화
        const positionsArray = new Float32Array(this.maxVertices * 2 * 3);
        const normalsArray = new Float32Array(this.maxVertices * 2 * 3);

        for (let i = 0; i < this.maxVertices; i++) {
            let p1 = this.positions[i];
            let p2 = this.positions[i + 1];

            let direction = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(direction, direction);

            let up = new Cesium.Cartesian3(0, 0, 1);
            let perpendicular = new Cesium.Cartesian3();
            Cesium.Cartesian3.cross(direction, up, perpendicular);
            Cesium.Cartesian3.normalize(perpendicular, perpendicular);

            let offset = Cesium.Cartesian3.multiplyByScalar(perpendicular, this.thickness, new Cesium.Cartesian3());

            let left = Cesium.Cartesian3.subtract(p1, offset, new Cesium.Cartesian3());
            let right = Cesium.Cartesian3.add(p1, offset, new Cesium.Cartesian3());

            positionsArray[i * 6] = left.x;
            positionsArray[i * 6 + 1] = left.y;
            positionsArray[i * 6 + 2] = left.z;
            normalsArray[i * 6] = perpendicular.x;
            normalsArray[i * 6 + 1] = perpendicular.y;
            normalsArray[i * 6 + 2] = perpendicular.z;

            positionsArray[i * 6 + 3] = right.x;
            positionsArray[i * 6 + 4] = right.y;
            positionsArray[i * 6 + 5] = right.z;
            normalsArray[i * 6 + 3] = perpendicular.x;
            normalsArray[i * 6 + 4] = perpendicular.y;
            normalsArray[i * 6 + 5] = perpendicular.z;
        }

        this.positionBuffer = Cesium.Buffer.createVertexBuffer({
            context: this.context,
            typedArray: positionsArray,
            usage: Cesium.BufferUsage.DYNAMIC_DRAW,
        });

        this.normalBuffer = Cesium.Buffer.createVertexBuffer({
            context: this.context,
            typedArray: normalsArray,
            usage: Cesium.BufferUsage.DYNAMIC_DRAW,
        });

        this.vertexArray = new Cesium.VertexArray({
            context: this.context,
            attributes: [
                {
                    index: 0,
                    vertexBuffer: this.positionBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
                {
                    index: 1,
                    vertexBuffer: this.normalBuffer,
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
            ],
        });

        this.shaderProgram = Cesium.ShaderProgram.fromCache({
            context: this.context,
            vertexShaderSource: `#version 300 es
                in vec3 a_position;
                in vec3 a_normal;
                uniform mat4 u_modelViewProjectionMatrix;
                uniform float u_thickness;

                void main() {
                    vec3 offset = normalize(a_normal) * u_thickness * 0.5;
                    vec4 pos = vec4(a_position + offset, 1.0);
                    gl_Position = u_modelViewProjectionMatrix * pos;
                }
            `,
            fragmentShaderSource: `#version 300 es
                precision highp float;
                out vec4 fragColor;
                void main() {
                    fragColor = vec4(1.0, 1.0, 0.0, 0.8); 
                }
            `,
            attributeLocations: {
                a_position: 0,
                a_normal: 1,
            },
        });

        this.drawCommand = new Cesium.DrawCommand({
            vertexArray: this.vertexArray,
            shaderProgram: this.shaderProgram,
            uniformMap: {
                u_modelViewProjectionMatrix: () =>
                    this.context.uniformState.modelViewProjection,
                u_thickness: () => this.thickness,
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
            renderState: Cesium.RenderState.fromCache({
                depthTest: { enabled: true },
                blending: Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState) {

        if (this.destroyed || !this.ready) return;

        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족합니다.");
            return;
        }

        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex++;
            if (this.currentIndex >= this.positions.length - 1) {
                return;
            }
        } else {

            this.startPosition = this.positions[this.currentIndex];
            const nextIndex = this.currentIndex + 1;
            let endPosition = this.positions[nextIndex];

            if (!this.startPosition || !endPosition) {
                return;
            }

            //this.positions = [startPosition]

            // progress 증가 (이동 속도를 조절하려면 증가 값을 조정)
            this.progress += 0.05; // 0.02씩 증가 (속도를 변경하려면 조절)
            if (this.progress > 1) {
                this.progress = 1; // 최대값 제한
            }

            const targetPositionArr = [this.startPosition]
            // 두 점 사이 위치 보간 (Lerp)
            for(let i = 0; i < this.maxVertices; i++){
                let interpolatedPosition = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(targetPositionArr[i], endPosition, this.progress + (0.05*i), interpolatedPosition);
                targetPositionArr.push(interpolatedPosition)
            }

            if(targetPositionArr.length > 2){

                const positionsArray = new Float32Array(this.maxVertices * 2 * 3);
                const normalsArray = new Float32Array(this.maxVertices * 2 * 3);

                for (let i = 0; i < this.maxVertices; i++) {

                    let p1 = targetPositionArr[i];
                    let p2 = targetPositionArr[i + 1];

                    let direction = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
                    if (Cesium.Cartesian3.magnitudeSquared(direction) === 0) {
                        return
                    }
                    Cesium.Cartesian3.normalize(direction, direction);

                    let up = new Cesium.Cartesian3(0, 0, 1);
                    let perpendicular = new Cesium.Cartesian3();
                    Cesium.Cartesian3.cross(direction, up, perpendicular);
                    //Cesium.Cartesian3.normalize(perpendicular, perpendicular);

                    let offset = Cesium.Cartesian3.multiplyByScalar(perpendicular, this.thickness, new Cesium.Cartesian3());

                    let left = Cesium.Cartesian3.subtract(p1, offset, new Cesium.Cartesian3());
                    let right = Cesium.Cartesian3.add(p1, offset, new Cesium.Cartesian3());

                    positionsArray[i * 6] = left.x;
                    positionsArray[i * 6 + 1] = left.y;
                    positionsArray[i * 6 + 2] = left.z;
                    normalsArray[i * 6] = perpendicular.x;
                    normalsArray[i * 6 + 1] = perpendicular.y;
                    normalsArray[i * 6 + 2] = perpendicular.z;

                    positionsArray[i * 6 + 3] = right.x;
                    positionsArray[i * 6 + 4] = right.y;
                    positionsArray[i * 6 + 5] = right.z;
                    normalsArray[i * 6 + 3] = perpendicular.x;
                    normalsArray[i * 6 + 4] = perpendicular.y;
                    normalsArray[i * 6 + 5] = perpendicular.z;
                }
                this.positionBuffer.copyFromArrayView(positionsArray);
            }

            this.startPosition = {x:targetPositionArr[1].x, y:targetPositionArr[1].y, z:targetPositionArr[1].z};

            frameState.commandList.push(this.drawCommand);

        }
    }

    destroy() {
        if (this.positionBuffer) this.positionBuffer.destroy();
        if (this.normalBuffer) this.normalBuffer.destroy();
        if (this.vertexArray) this.vertexArray.destroy();
        if (this.shaderProgram) this.shaderProgram.destroy();
    }
}
