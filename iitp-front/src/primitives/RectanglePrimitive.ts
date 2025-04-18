import * as Cesium from "cesium";

export default class RectanglePrimitive {
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
        this.show = false;


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
            in vec3 a_position;
            in vec3 a_normal;
    
            uniform mat4 u_modelViewProjectionMatrix;
            uniform mat4 u_modelViewMatrix;  // 뷰 변환 행렬 추가
            uniform float u_thickness;
            uniform float u_time;
    
            out float v_fadeFactor;
            out vec3 v_position;
            out float v_wave;
    
            void main() {
                // 🔹 카메라 기준으로 법선 벡터 변환 (뷰 행렬 적용)
                //vec3 transformedNormal = normalize(mat3(u_modelViewMatrix) * a_normal);
                vec3 transformedNormal = normalize(a_normal);
                //vec3 transformedNormal = normalize(transpose(inverse(mat3(u_modelViewMatrix))) * a_normal);


    
                // 🔹 법선이 뒤집혔을 경우 보정하여 항상 올바른 방향으로 적용
                vec3 offset = transformedNormal * u_thickness * 10.0;
                //offset *= sign(dot(a_normal, vec3(0.0, 0.0, 1.0)));
                //offset *= sign(dot(transformedNormal, vec3(0.0, 0.0, 1.0)));

    
                // 💡 시간에 따른 강한 물결 효과
                //float waveEffect = sin(u_time * 5.0 + a_position.x * 0.3) * 0.6 + 1.5;
                float waveEffect = sin(u_time * 5.0 + a_position.x * 0.3) * 0.6 + 1.5;
    
                // 💡 더욱 역동적인 높낮이 애니메이션
                // vec3 animatedPosition = a_position + vec3(0.0, 0.0, sin(u_time * 4.0 + a_position.x * 0.3) * 2.0);
                vec3 animatedPosition = a_position;
                
                // 🔹 최종 위치 계산 (강한 물결 효과 적용)
                //vec4 pos = vec4(animatedPosition + offset * waveEffect, 1.0);
                vec4 pos = vec4(animatedPosition, 1.0);
                
                // 🔥 잔상 효과 (투명도 유지)
                v_fadeFactor = max(exp(-u_time * 0.02) * waveEffect, 0.5);
                
                // 네온 트레일 효과를 위한 값 전달
                v_position = a_position;
                v_wave = waveEffect;
    
                // 📌 최종 화면 좌표 변환
                gl_Position = u_modelViewProjectionMatrix * pos;
                
            }
        `,
            fragmentShaderSource: `
            #version 300 es
            precision highp float;
            
            out vec4 fragColor;
            
            uniform float u_time;
            
            in float v_fadeFactor;
            in vec3 v_position;
            in float v_wave;
            
            void main() {
                // 🌈 네온 컬러를 더 강한 효과로 변경
                float r = abs(sin(u_time * 2.0)) * 2.0;  
                float g = abs(sin(u_time * 3.0 + 2.0)) * 2.0;
                float b = abs(sin(u_time * 4.0 + 4.0)) * 2.0;
                vec3 neonColor = vec3(r, g, b);
            
                // 💡 Glow 효과를 더 강하게
                float glow = exp(-length(v_position.xy) * 0.005) * v_wave * 6.0;
            
                // 🔥 투명도 최소값 유지하여 항상 보이도록 함
                float alpha = max(v_fadeFactor * glow, 0.8);
            
                fragColor = vec4(neonColor, alpha);
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
                u_modelViewProjectionMatrix: () => this.context.uniformState.modelViewProjection,
                u_modelViewMatrix: () => this.context.uniformState.modelView,
                u_thickness: () => this.thickness,
                u_time: () => performance.now() / 1000.0 , // 현재 시간을 셰이더에 전달

            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_FAN,
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
            if(this.show){
                frameState.commandList.push(this.drawCommand);
            }
            this.previousTime = performance.now();
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

            // 기존 positionBuffer와 normalBuffer 초기화
            let currentPositionsArray = new Float32Array(this.positionBuffer.sizeInBytes / Float32Array.BYTES_PER_ELEMENT);
            let currentNormalsArray = new Float32Array(this.normalBuffer.sizeInBytes / Float32Array.BYTES_PER_ELEMENT);


            if (targetPositionArr.length > 2) {
                const newPositionsArray = new Float32Array((targetPositionArr.length - 1) * 2 * 3);
                const newNormalsArray = new Float32Array((targetPositionArr.length - 1) * 2 * 3);

                if (currentPositionsArray.length <= newPositionsArray.length) {
                    newPositionsArray.set(currentPositionsArray);
                    newNormalsArray.set(currentNormalsArray);
                }

                for (let i = 0; i < targetPositionArr.length - 1; i++) {
                    let p1 = targetPositionArr[i];
                    let p2 = targetPositionArr[i + 1];

                    let direction = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
                    if (Cesium.Cartesian3.magnitudeSquared(direction) === 0) continue;
                    Cesium.Cartesian3.normalize(direction, direction);

                    // 🌍 지구 표면 법선 벡터 (각 위치에서의 Up 벡터)
                    let up = Cesium.Cartesian3.normalize(p1, new Cesium.Cartesian3());

                    // ⏩ 오른쪽(Right) 벡터 계산
                    let perpendicular = new Cesium.Cartesian3();
                    Cesium.Cartesian3.cross(direction, up, perpendicular);
                    Cesium.Cartesian3.normalize(perpendicular, perpendicular);

                    // ⚠️ 법선 벡터가 0이 되면 수직 방향 보정
                    if (Cesium.Cartesian3.magnitudeSquared(perpendicular) === 0) {
                        up = new Cesium.Cartesian3(0, 1, 0);  // 기본 보정 값 (필요 시 조정 가능)
                        Cesium.Cartesian3.cross(direction, up, perpendicular);
                        Cesium.Cartesian3.normalize(perpendicular, perpendicular);
                    }

                    //if (i % 2 === 0) Cesium.Cartesian3.negate(perpendicular, perpendicular);

                    let thickness = 2.0;
                    let offset = Cesium.Cartesian3.multiplyByScalar(perpendicular, thickness, new Cesium.Cartesian3());

                    let left = Cesium.Cartesian3.subtract(p1, offset, new Cesium.Cartesian3());
                    let right = Cesium.Cartesian3.add(p1, offset, new Cesium.Cartesian3());

                    let index = i * 6;
                    let arrangeArr = [left, right];
                    if (i % 2 == 1) {
                        arrangeArr = [right, left];
                    }

                    newPositionsArray[index] = arrangeArr[0].x;
                    newPositionsArray[index + 1] = arrangeArr[0].y;
                    newPositionsArray[index + 2] = arrangeArr[0].z;
                    newPositionsArray[index + 3] = arrangeArr[1].x;
                    newPositionsArray[index + 4] = arrangeArr[1].y;
                    newPositionsArray[index + 5] = arrangeArr[1].z;

                    newNormalsArray[index] = perpendicular.x;
                    newNormalsArray[index + 1] = perpendicular.y;
                    newNormalsArray[index + 2] = perpendicular.z;
                    newNormalsArray[index + 3] = perpendicular.x;
                    newNormalsArray[index + 4] = perpendicular.y;
                    newNormalsArray[index + 5] = perpendicular.z;
                }


                if (newPositionsArray.byteLength > this.positionBuffer.sizeInBytes) {
                    this.positionBuffer = new Cesium.Buffer({
                        context: frameState.context,
                        typedArray: newPositionsArray,
                        usage: Cesium.BufferUsage.STREAM_DRAW
                    });
                } else {
                    this.positionBuffer.copyFromArrayView(newPositionsArray);
                }

                if (newNormalsArray.byteLength > this.normalBuffer.sizeInBytes) {
                    this.normalBuffer = new Cesium.Buffer({
                        context: frameState.context,
                        typedArray: newNormalsArray,
                        usage: Cesium.BufferUsage.STREAM_DRAW
                    });
                } else {
                    this.normalBuffer.copyFromArrayView(newNormalsArray);
                }
            }



            //this.startPosition = {x:targetPositionArr[1].x, y:targetPositionArr[1].y, z:targetPositionArr[1].z};
            // u_time 값을 계산하여 uniformMap에 전달
            const u_time = performance.now() / 1000; // 밀리초 단위 -> 초 단위로 변환

            //DrawCommand의 uniformMap을 업데이트하여 u_time과 u_modelViewProjectionMatrix 전달
            this.drawCommand.uniformMap = {
                u_time: () =>  u_time,
                u_thickness: () => 50.0,
                u_modelViewProjectionMatrix: () =>  frameState.context.uniformState.modelViewProjection,
                u_modelViewMatrix: () => frameState.context.uniformState.modelView,
            };

            if(this.show){
                frameState.commandList.push(this.drawCommand);
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
        if (this.positionBuffer) this.positionBuffer.destroy();
        if (this.normalBuffer) this.normalBuffer.destroy();
        if (this.vertexArray) this.vertexArray.destroy();
        if (this.shaderProgram) this.shaderProgram.destroy();
    }
}
