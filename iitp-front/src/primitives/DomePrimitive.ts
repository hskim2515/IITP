import * as Cesium from "cesium";

export default class DomePrimitive {
    constructor(positions, context, speed, status) {
        this.positions = positions; // CZML에서 가져온 positions
        this.speed = speed;
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.previousTime = performance.now(); // 마지막 업데이트 시간
        this.destroyed = false; // 객체가 제거되었는지 여부를 추적
        this.tailLength = 10; // 꼬리 길이 (몇 프레임에 해당하는 위치가 남을지 결정)
        this.tailPositions = []; // 꼬리 위치를 저장할 배열
        this.progress = 0;
        this.status = status;
        this.show = false;

        this.createResources();
    }

    createResources() {
        // 초기 위치 설정
        const initialPosition = this.positions[0];
        const positionsArray = new Float32Array([initialPosition.x, initialPosition.y, initialPosition.z]);

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
                    gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
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
                    enabled: false,
                },
                blending: Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState) {

        if (this.destroyed) return; // 이미 제거된 경우 업데이트하지 않음

        if(!this.status) {
            this.previousTime = performance.now();
            if(this.show){
                frameState.commandList.push(this.drawCommand);
            }
            return;
        }

        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족하거나 초기화되지 않았습니다.");
            return;
        }

        // speedKmh는 km/h로 주어지며 이를 m/s로 변환
        const speedMps = this.speed / 3.6; // km/h -> m/s

        // 이동이 끝났으면 currentIndex 증가
        if (this.progress >= 1) {
            this.progress = 0; // 다음 이동을 위해 초기화
            this.currentIndex++; // 다음 위치로 이동
        } else {
            // 현재 위치와 다음 위치 가져오기
            let startPosition = this.positions[this.currentIndex];
            const nextIndex = this.currentIndex + 1;
            let endPosition = this.positions[nextIndex];

            if (!startPosition || !endPosition) {
                return;
            }

            // 이동 시간 계산 (속도와 거리로부터 시간 계산)
            const distance = Cesium.Cartesian3.distance(startPosition, endPosition); // m 단위
            const timeToTravel = distance / speedMps; // 이동 시간 (초 단위)

            const currentTimestamp = performance.now();
            const deltaTime = (currentTimestamp - this.previousTime) / 1000; // 시간 차이 (초 단위)
            this.previousTime = currentTimestamp;

            this.progress += (deltaTime / timeToTravel); // 시간에 비례하여 progress 증가

            if (this.progress > 1) {
                this.progress = 1; // 최대값 제한
            }


            if(this.show){
                // 두 점 사이 위치 보간 (Lerp)
                let interpolatedPosition = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(startPosition, endPosition, this.progress, interpolatedPosition);

                // 위치 업데이트
                const newPositions = new Float32Array([interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z]);
                this.vertexBuffer.copyFromArrayView(newPositions);
            }

        }

        if(this.show){
            frameState.commandList.push(this.drawCommand);
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
