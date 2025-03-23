import * as Cesium from "cesium";

export default class VehicleDensityPrimitive {
    constructor(positions, context) {
        this.positions = positions; // CZML에서 가져온 positions
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.destroyed = false; // 객체가 제거되었는지 여부를 추적
        this.progress = 0;

        this.createResources();
    }
    createResources() {
        // 초기 위치 설정
        const initialPositions = this.positions[0]
        let positionsArray = new Float32Array(initialPositions.length * 3);

        for (let i = 0; i < initialPositions.length; i++) {
            positionsArray[i * 3] = initialPositions[i].x;
            positionsArray[i * 3 + 1] = initialPositions[i].y;
            positionsArray[i * 3 + 2] = initialPositions[i].z;
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
        uniform vec3 u_positions[500]; // 최대 100개의 point 데이터
        uniform int u_numPoints; // 현재 존재하는 point 개수
        out float v_minDistance;
        out vec2 v_pointCoord; 

        void main() {
            float minDist = 99999999.0;
            for (int i = 0; i < u_numPoints; i++) {
                float dist = distance(a_position, u_positions[i]);
                if (dist > 0.0 && dist < minDist) {
                    minDist = dist;
                }
            }
            v_minDistance = minDist;

            gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
            gl_PointSize = mix(100.0, 10.0, smoothstep(0.0, 100.0, minDist));

            v_pointCoord = (gl_Position.xy / gl_Position.w) * 0.5 + 0.5;
        }
    `,
            fragmentShaderSource: `
        #version 300 es
        #extension GL_OES_standard_derivatives : enable
        precision highp float;
        in float v_minDistance;
        in vec2 v_pointCoord;
        out vec4 fragColor;
        
        void main() {
            vec2 uv = gl_PointCoord - vec2(0.5, 0.5);
            float dist = length(uv) * 1.2; // 0~1 범위로 정규화
            float alpha = smoothstep(0.5, 0.45, dist); // 가장자리 부드럽게 처리
            
            if (alpha < 0.01) {
                discard;
            }
        
            float t = smoothstep(0.0, 100.0, v_minDistance);
            vec3 color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), t);
            
            fragColor = vec4(color, alpha);
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
                u_positions: () => positionsArray,
                u_numPoints: () => initialPositions.length,
            },
            primitiveType: Cesium.PrimitiveType.POINTS,
            renderState: Cesium.RenderState.fromCache({
                depthTest: {
                    enabled: false,
                },
                blending: Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState) {
        if (this.destroyed) return;

        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족합니다.");
            return;
        }

        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex++;
        } else {
            let startPosition = this.positions[this.currentIndex];
            const nextIndex = this.currentIndex + 1;
            let endPosition = this.positions[nextIndex];

            if (!startPosition || !endPosition) {
                return;
            }

            this.progress += 0.05;
            if (this.progress > 1) this.progress = 1;

            const interpolatedPosition = startPosition.map((position, i) => {
                let result = new Cesium.Cartesian3();
                if(i != startPosition.length-1){
                    Cesium.Cartesian3.lerp(position, endPosition[i], this.progress, result);
                    return result
                }
            });

            let positionsArray = new Float32Array(interpolatedPosition.length * 3);

            for (let i = 0; i < interpolatedPosition.length-1; i++) {
                positionsArray[i * 3] = interpolatedPosition[i].x;
                positionsArray[i * 3 + 1] = interpolatedPosition[i].y;
                positionsArray[i * 3 + 2] = interpolatedPosition[i].z;
            }

            this.vertexBuffer.copyFromArrayView(positionsArray);

            this.drawCommand.uniformMap = {
                u_modelViewProjectionMatrix: () => this.context.uniformState.modelViewProjection,
                u_positions: () => {
                    let vec3Array = [];
                    for (let i = 0; i < interpolatedPosition.length-1; i++) {
                        vec3Array.push(new Cesium.Cartesian3(
                            interpolatedPosition[i].x,
                            interpolatedPosition[i].y,
                            interpolatedPosition[i].z
                        ));
                    }
                    return vec3Array; // ✅ GLSL에서 vec3 배열로 받을 수 있음
                },
                u_numPoints: () => interpolatedPosition.length,
            };
        }

        frameState.commandList.push(this.drawCommand);
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
