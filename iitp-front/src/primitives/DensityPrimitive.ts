import * as Cesium from "cesium";

export default class DensityPrimitive {
    constructor(positions, context, speed, status) {
        this.positions = positions; // CZML에서 가져온 positions
        this.speed = speed;
        this.ready = false;
        this.context = context;
        this.destroyed = false; // 객체가 제거되었는지 여부를 추적
        this.progress = [];
        this.status = status;
        this.previousTime = [] // 마지막 업데이트 시간
        this.currentIndex = [];

        this.createResources();
    }
    createResources() {
        // 초기 위치 설정
        const initialPositions = this.positions[0]
        this.progress = new Array(this.positions[0].length).fill(0);
        this.currentIndex = new Array(this.positions[0].length).fill(0);
        this.previousTime = new Array(this.positions[0].length).fill(performance.now());
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



        if(!this.status || this.startPosition ==undefined) {
            frameState.commandList.push(this.drawCommand);
            return;
        }

        const targetPositionArr = []

        for(let i = 0; i < this.startPosition.length; ++i) {

            let startPosition = this.positions[this.currentIndex[i]];
            let endPosition = this.positions[this.currentIndex[i]+1];

            if (this.progress[i] >= 1) {
                this.progress[i] = 0;
                this.currentIndex[i] = this.currentIndex[i] + 1;
            } else {
                if(startPosition[i] == null || !endPosition || endPosition[i] == null){
                    targetPositionArr.push(null)
                }else{
                    const speedMps = this.speed / 3.6; // km/h -> m/s

                    // 이동 시간 계산 (속도와 거리로부터 시간 계산)
                    const distance = Cesium.Cartesian3.distance(startPosition[i], endPosition[i]); // m 단위
                    const timeToTravel = distance / speedMps; // 이동 시간 (초 단위)

                    const currentTimestamp = performance.now();
                    const deltaTime = (currentTimestamp - this.previousTime[i]) / 1000; // 시간 차이 (초 단위)
                    this.previousTime[i] = currentTimestamp;

                    this.progress[i] += (deltaTime / timeToTravel); // 시간에 비례하여 progress 증가

                    if (this.progress[i] > 1) {
                        this.progress[i] = 1; // 최대값 제한
                    }

                    let interpolatedPosition = new Cesium.Cartesian3();
                    Cesium.Cartesian3.lerp(startPosition[i], endPosition[i], this.progress[i], interpolatedPosition);
                    targetPositionArr.push(interpolatedPosition)
                    this.vertexBuffer.copyFromArrayView(interpolatedPosition);

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

                    frameState.commandList.push(this.drawCommand);
                }
            }
        }


    }

    setSpeed(speed: number) {
        this.speed = speed;
    }

    setStatus(status: string) {
        this.status = status;
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
