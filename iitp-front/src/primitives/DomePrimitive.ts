import * as Cesium from "cesium";

export default class DomePrimitive {
    constructor(positions, context, speed, status) {
        this.positions = positions; // CZML에서 가져온 positions
        this.speed = speed;
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.previousTime = Date.now(); // 마지막 업데이트 시간
        this.destroyed = false; // 객체가 제거되었는지 여부를 추적
        this.progress = 0;
        this.status = status;
        this.show = false;

        this.createResources();
    }

    createResources(){
        // 초기 위치 설정
        const positionsArray = new Float32Array(this.positions.length * 3);
        for (let i = 0; i < this.positions.length; i++) {
            positionsArray[i * 3]     = this.positions[i][1];
            positionsArray[i * 3 + 1] = this.positions[i][2];
            positionsArray[i * 3 + 2] = this.positions[i][3];
        }

        this.vertexBuffer = Cesium.Buffer.createVertexBuffer({
            context: this.context,
            typedArray: positionsArray,
            usage: Cesium.BufferUsage.DYNAMIC_DRAW, // 데이터가 계속 변경되므로 DYNAMIC_DRAW 사용
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
                    vec3 position = a_position;
                    position.z += 5.0; // z 방향으로 올림

                    gl_Position = u_modelViewProjectionMatrix * vec4(position, 1.0);
                    gl_PointSize = 10.0;
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;
                out vec4 fragColor;
                void main() {
                
                    vec2 uv = gl_PointCoord - vec2(0.5, 0.5);
                    float dist = length(uv) * 1.2; // 0~1 범위로 정규화
                    float alpha = smoothstep(0.5, 0.45, dist); // 가장자리 부드럽게 처리
                    
                    if (alpha < 0.01) {
                        discard;
                    }
                    fragColor = vec4(vec3(1.0, 0.5, 0.0), alpha * 0.5);
                    //fragColor = vec4(1.0, 1.0, 0.0, alpha);
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
                u_modelViewProjectionMatrix: () =>
                    this.context.uniformState.modelViewProjection,
            },
            primitiveType: Cesium.PrimitiveType.POINTS,
            renderState: Cesium.RenderState.fromCache({
                depthTest: {
                    enabled: true,
                },
                blending: Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState) {
        if (this.destroyed || !this.show) return;
        // 워커에서 받은 위치를 vertexBuffer에 반영
        const filteredPositions = this.latestPositions?.filter(item => item != null)
        if (this.latestPositions && filteredPositions.length > 0) {

            this.latestPositions = filteredPositions

            const flatResult = new Float32Array(this.latestPositions.length * 3);
            for (let i = 0; i < this.latestPositions.length; i++) {
                flatResult[i * 3] = this.latestPositions[i][0];
                flatResult[i * 3 + 1] = this.latestPositions[i][1];
                flatResult[i * 3 + 2] = this.latestPositions[i][2];
            }

            if (!this.vertexBuffer || this.vertexBuffer.sizeInBytes !== flatResult.byteLength) {
                if (this.vertexBuffer) {
                    this.vertexBuffer.destroy(); // 기존 버퍼 파괴
                }
                this.vertexBuffer = Cesium.Buffer.createVertexBuffer({
                    context: frameState.context,
                    typedArray: flatResult,
                    usage: Cesium.BufferUsage.DYNAMIC_DRAW
                });

                this.drawCommand.vertexArray = new Cesium.VertexArray({
                    context: frameState.context,
                    attributes: [
                        {
                            index: 0,
                            vertexBuffer: this.vertexBuffer,
                            componentsPerAttribute: 3,
                            componentDatatype: Cesium.ComponentDatatype.FLOAT,
                        }
                    ]
                });
            } else {
                this.vertexBuffer.copyFromArrayView(flatResult.buffer);
            }

            this.drawCommand.count = this.latestPositions.length;

            frameState.commandList.push(this.drawCommand);
        }
    }

    async adjustPositionsToTerrain(positions: Cesium.Cartographic[]): Promise<Cartesian3[]> {
        const updated = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions);
        return updated.map(cart => Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, cart.height));
    }


    setSpeed(speed: number) {
        this.speed = speed;
    }

    setStatus(status: string) {
        this.status = status;
    }

    setLatestPositions(latestPositions) {
        this.latestPositions = latestPositions.positions;
    }

    destroy() {
        if (this.vertexBuffer) {
            this.vertexBuffer.destroy();
        }
        if (this.vertexArray) {
            this.vertexArray.destroy();
        }
        if (this.shaderProgram) {
            this.shaderProgram.destroy();
        }
    }
}

