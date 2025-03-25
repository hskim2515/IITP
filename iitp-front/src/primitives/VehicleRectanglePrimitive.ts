import * as Cesium from "cesium";

export default class VehicleRectanglePrimitive {
    constructor(positions, context, speed, status) {
        this.positions = positions;
        this.speed = speed;
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.destroyed = false;
        this.tailPositions = [];
        this.progress = 0;
        this.maxVertices = 3; // TRIANGLE_STRIP을 위한 최대 정점 개수
        this.thickness = 5.0; // 선 두께
        this.startPosition = positions[0];
        this.tails = 0;
        this.previousTime = performance.now(); // 마지막 업데이트 시간
        this.status = status;


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
            vertexShaderSource: `
                #version 300 es
                in vec3 a_position; // 위치 데이터
                in vec3 a_normal;   // 노멀 벡터
                
                uniform mat4 u_modelViewProjectionMatrix;
                uniform float u_thickness; // 두께 조절
                uniform float u_time;      // 시간 흐름에 따른 변화
                
                out float v_fadeFactor; // Fragment Shader로 전달할 투명도 값
                
                void main() {
                    // 방향 벡터를 계산하여 차량 경로의 두께를 조절
                    vec3 offset = normalize(a_normal) * u_thickness * 2.0;
                    
                    // 시간에 따른 부드러운 물결 효과 적용
                    float waveEffect = sin(u_time * 2.0) * 0.2 + 0.8; 
                
                    // 경로의 높낮이를 시간에 따라 약간 변경하여 자연스러운 효과 추가
                    vec3 animatedPosition = a_position + vec3(0.0, 0.0, sin(u_time + a_position.x * 0.05) * 0.5);
                
                    // 최종 위치 적용
                    vec4 pos = vec4(animatedPosition + offset * waveEffect, 1.0);
                    
                    // 투명도 계산 (시간이 지나면서 점점 흐려짐)
                    v_fadeFactor = exp(-u_time * 0.1) * waveEffect;
                
                    // MVP 행렬 적용하여 화면 좌표로 변환
                    gl_Position = u_modelViewProjectionMatrix * pos;
                }

            `,
            fragmentShaderSource: `
            #version 300 es
            precision highp float;
            out vec4 fragColor;
            uniform float u_time; // 시간에 따라 변화하는 값
            
            void main() {
                float fadeFactor = exp(-u_time * 0.1); // 시간이 흐름에 따라 점점 투명해짐
                float waveEffect = sin(u_time * 2.0) * 0.2 + 0.8; // 물결치는 듯한 투명도 변화
                fadeFactor *= waveEffect; // 흐려지는 효과와 함께 물결 효과 추가
            
                fragColor = vec4(1.0, 1.0, 0.0, fadeFactor); // 투명도가 부드럽게 변화
            }
            `,
            attributeLocations: {
                a_position: 0,
                a_normal: 1,
            },
        });

        let elapsedTime = (performance.now() - this.previousTime) / 1000.0; // 초 단위로 변환


        this.drawCommand = new Cesium.DrawCommand({
            vertexArray: this.vertexArray,
            shaderProgram: this.shaderProgram,
            uniformMap: {
                u_modelViewProjectionMatrix: () =>
                    this.context.uniformState.modelViewProjection,
                u_thickness: () => this.thickness,
                u_time: () => elapsedTime, // 현재 시간을 셰이더에 전달

            },
            primitiveType: Cesium.PrimitiveType.CUSTOM,
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

        if(!this.status) {
            frameState.commandList.push(this.drawCommand);
            return;
        }

        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족합니다.");
            return;
        }
        const speedMps = this.speed / 3.6; // km/h -> m/s

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

            // 이동 시간 계산 (속도와 거리로부터 시간 계산)
            const distance = Cesium.Cartesian3.distance(this.startPosition, endPosition); // m 단위
            const timeToTravel = distance / speedMps; // 이동 시간 (초 단위)

            const currentTimestamp = performance.now();
            const deltaTime = (currentTimestamp - this.previousTime) / 1000; // 시간 차이 (초 단위)
            this.previousTime = currentTimestamp;

            this.progress += (deltaTime / timeToTravel); // 시간에 비례하여 progress 증가

            if (this.progress > 1) {
                this.progress = 1; // 최대값 제한
            }

            const targetPositionArr = [this.startPosition]
            // 두 점 사이 위치 보간 (Lerp)
            for(let i = 0; i < this.maxVertices; i++){
                let interpolatedPosition = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(targetPositionArr[i], endPosition, this.progress, interpolatedPosition);
                targetPositionArr.push(interpolatedPosition)
            }

            if (targetPositionArr.length > 2) {
                const positionsArray = new Float32Array((targetPositionArr.length - 1) * 2 * 3);
                const normalsArray = new Float32Array((targetPositionArr.length - 1) * 2 * 3);

                for (let i = 0; i < targetPositionArr.length - 1; i++) {
                    let p1 = targetPositionArr[i];
                    let p2 = targetPositionArr[i + 1];

                    let direction = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
                    if (Cesium.Cartesian3.magnitudeSquared(direction) === 0) {
                        continue; // 두 점이 동일하면 건너뛰기
                    }
                    Cesium.Cartesian3.normalize(direction, direction);

                    // 방향 벡터와 평행하지 않은 up 벡터를 동적으로 설정
                    let up = new Cesium.Cartesian3(0, 0, 1); // 기본값으로 z축을 설정
                    // direction 벡터와 up 벡터가 평행하면, 다른 벡터를 선택
                    if (Math.abs(direction.x) > 0.9) {
                        up = new Cesium.Cartesian3(0, 1, 0); // x축이 거의 평행할 경우 y축을 사용
                    }

                    let perpendicular = new Cesium.Cartesian3();
                    Cesium.Cartesian3.cross(direction, up, perpendicular);

                    // perpendicular 벡터가 0일 경우, 다른 벡터를 사용하여 교차를 계산
                    if (Cesium.Cartesian3.magnitudeSquared(perpendicular) === 0) {
                        up = new Cesium.Cartesian3(1, 0, 0); // y축을 기준으로 교차 벡터 계산
                        Cesium.Cartesian3.cross(direction, up, perpendicular);
                    }

                    Cesium.Cartesian3.normalize(perpendicular, perpendicular); // 정규화

                    let offset = Cesium.Cartesian3.multiplyByScalar(perpendicular, this.progress * 5, new Cesium.Cartesian3());

                    if (Cesium.Cartesian3.magnitudeSquared(offset) === 0) {
                        continue; // offset이 0일 경우 해당 위치를 건너뛰기
                    }

                    let left = Cesium.Cartesian3.subtract(p1, offset, new Cesium.Cartesian3());
                    let right = Cesium.Cartesian3.add(p1, offset, new Cesium.Cartesian3());

                    positionsArray[i * 6] = left.x;
                    positionsArray[i * 6 + 1] = left.y;
                    positionsArray[i * 6 + 2] = left.z;
                    // positionsArray[i * 6 + 3] = right.x;
                    // positionsArray[i * 6 + 4] = right.y;
                    // positionsArray[i * 6 + 5] = right.z;

                    normalsArray[i * 6] = perpendicular.x;
                    normalsArray[i * 6 + 1] = perpendicular.y;
                    normalsArray[i * 6 + 2] = perpendicular.z;
                    normalsArray[i * 6 + 3] = perpendicular.x;
                    normalsArray[i * 6 + 4] = perpendicular.y;
                    normalsArray[i * 6 + 5] = perpendicular.z;
                }

                this.positionBuffer.copyFromArrayView(positionsArray);
                this.normalBuffer.copyFromArrayView(normalsArray);
            }


            //this.startPosition = {x:targetPositionArr[1].x, y:targetPositionArr[1].y, z:targetPositionArr[1].z};
            // u_time 값을 계산하여 uniformMap에 전달
            const u_time = performance.now() / 1000; // 밀리초 단위 -> 초 단위로 변환

            // DrawCommand의 uniformMap을 업데이트하여 u_time과 u_modelViewProjectionMatrix 전달
            // this.drawCommand.uniformMap = {
            //     u_time: () =>  u_time,
            //     u_thickness: () => this.progress * 5,
            //     u_modelViewProjectionMatrix: () =>  frameState.context.uniformState.modelViewProjection
            // };

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
        if (this.positionBuffer) this.positionBuffer.destroy();
        if (this.normalBuffer) this.normalBuffer.destroy();
        if (this.vertexArray) this.vertexArray.destroy();
        if (this.shaderProgram) this.shaderProgram.destroy();
    }
}
