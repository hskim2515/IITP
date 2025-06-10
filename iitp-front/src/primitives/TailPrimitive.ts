import * as Cesium from "cesium";
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";

export default class TailPrimitive {
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


        this.trailPosition = [];
        this.MAX_TRAIL_LENGTH = 50;


        this.trails = [];
        this.positions.forEach((position) => {
            this.trails.push(this.createTrailResources(new Cartesian3(position[1],position[2],position[3])));
        })

    }

    createTrailResources(initialPosition: Cartesian3): {
        trailPosition: [];
        vertexArray: Cesium.VertexArray;
        shaderProgram: Cesium.ShaderProgram;
        drawCommand: Cesium.DrawCommand;
    } {
        const trailPosition = Array(this.MAX_TRAIL_LENGTH).fill(initialPosition);

        const flattenedTrailPositions = trailPosition.flatMap(pos => [
            pos.x, pos.y, pos.z
        ]);

        const fadeFactors = trailPosition.map((_, i) => i / trailPosition.length);
        const offsetFactors = trailPosition.flatMap((_, i) => [-5, 5]);

        const vertexArray = new Cesium.VertexArray({
            context: this.context,
            attributes: [
                {
                    index: 0,
                    vertexBuffer: Cesium.Buffer.createVertexBuffer({
                        context: this.context,
                        typedArray: new Float32Array(flattenedTrailPositions),
                        usage: Cesium.BufferUsage.STREAM_DRAW,
                    }),
                    componentsPerAttribute: 3,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
                {
                    index: 1,
                    vertexBuffer: Cesium.Buffer.createVertexBuffer({
                        context: this.context,
                        typedArray: new Float32Array(fadeFactors),
                        usage: Cesium.BufferUsage.STREAM_DRAW,
                    }),
                    componentsPerAttribute: 1,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                },
                {
                    index: 2,
                    vertexBuffer: Cesium.Buffer.createVertexBuffer({
                        context: this.context,
                        typedArray: new Float32Array(offsetFactors),
                        usage: Cesium.BufferUsage.STREAM_DRAW,
                    }),
                    componentsPerAttribute: 1,
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                }
            ],
        });

        const shaderProgram = Cesium.ShaderProgram.fromCache({
            context: this.context,
            vertexShaderSource: `
                in vec3 a_position;
                in float a_fade;
                in float a_offset;
                
                uniform mat4 u_modelViewProjectionMatrix;
                uniform vec2 u_viewportSize;
                
                out float v_fade;
                
                void main() {
                    // 월드 좌표 -> clip space
                    vec4 clip = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
                    vec2 ndc = clip.xy / clip.w;
                
                    // 화면 공간에서 수직 방향으로 오프셋 적용
                    float thickness = 3.0 / u_viewportSize.y; // 픽셀 단위 두께
                    //float thickness = baseThickness * pow(v_fade, 100.5);
                    vec2 offset = vec2(-ndc.y, ndc.x); // 카메라 기준 수직 방향
                    offset = normalize(offset) * thickness * a_offset;
                
                    vec4 offsetClip = clip;
                    offsetClip.xy += offset * clip.w; // 오프셋을 clip space에 맞게 적용
                    gl_Position = offsetClip;
                
                    v_fade = a_fade;
                }
            `,
            fragmentShaderSource: `
                #version 300 es
                precision highp float;
                
                uniform float u_time;
                in float v_fade;
                out vec4 fragColor;
                
                void main() {
                    float r = abs(sin(u_time * 2.0)) * 2.0;  
                    float g = abs(sin(u_time * 3.0 + 2.0)) * 2.0;
                    float b = abs(sin(u_time * 4.0 + 4.0)) * 2.0;
                    vec3 neonColor = vec3(r, g, b);
                    
                    fragColor = vec4(1.0 * v_fade, 0.5 * v_fade, 0.0, v_fade);
                    //fragColor = vec4(neonColor, v_fade);
                    // float glow = pow(1.0 - v_fade, 10.0);
                    // fragColor = vec4(1.0, 1.0, 0.0, glow);  // 노란색 glow 느낌  
                }
            `,
            attributeLocations: {
                a_position: 0,
                a_fade: 1,
                a_offset: 2,
            },
        });

        const drawCommand = new Cesium.DrawCommand({
            vertexArray,
            shaderProgram,
            uniformMap: {
                u_modelViewProjectionMatrix: () =>
                    this.context.uniformState.modelViewProjection,
                u_time: () => performance.now() / 1000.0,
                u_viewportSize: () => new Cesium.Cartesian2(
                    this.context.drawingBufferWidth,
                    this.context.drawingBufferHeight
                ),
            },
            primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
            renderState: Cesium.RenderState.fromCache({
                depthTest: { enabled: false },
                blending: Cesium.BlendingState.ALPHA_BLEND,
            }),
            pass: Cesium.Pass.OPAQUE,
        });

        return {
            trailPosition,
            vertexArray,
            shaderProgram,
            drawCommand,
        };
    }


    // createResources(position, index) {
    //
    //     this.trailPosition = Array(this.MAX_TRAIL_LENGTH).fill(this.convertFlatEcefToCartesian3(position)[0]); // 초기값 채우기
    //
    //     const flattenedTrailPositions = this.trailPosition.flatMap(pos => [
    //         pos.x, pos.y, pos.z
    //     ]);
    //
    //     const fadeFactors = this.trailPosition.map((_, i) => i / this.trailPosition.length);
    //
    //     this.vertexArray = new Cesium.VertexArray({
    //         context: this.context,
    //         attributes: [
    //             {
    //                 index: 0, // a_position
    //                 vertexBuffer: Cesium.Buffer.createVertexBuffer({
    //                     context: this.context,
    //                     typedArray: new Float32Array(flattenedTrailPositions),
    //                     usage: Cesium.BufferUsage.STREAM_DRAW,
    //                 }),
    //                 componentsPerAttribute: 3,
    //                 componentDatatype: Cesium.ComponentDatatype.FLOAT,
    //             },
    //             {
    //                 index: 1, // a_fade or u_index alternative
    //                 vertexBuffer: Cesium.Buffer.createVertexBuffer({
    //                     context: this.context,
    //                     typedArray: new Float32Array(fadeFactors),
    //                     usage: Cesium.BufferUsage.STREAM_DRAW,
    //                 }),
    //                 componentsPerAttribute: 1,
    //                 componentDatatype: Cesium.ComponentDatatype.FLOAT,
    //             },
    //
    //             {
    //                 index: 2, // a_offset
    //                 vertexBuffer: Cesium.Buffer.createVertexBuffer({
    //                     context: this.context,
    //                     typedArray: new Float32Array(this.trailPosition.flatMap((_, i) => [-5, 5])),
    //                     usage: Cesium.BufferUsage.STREAM_DRAW,
    //                 }),
    //                 componentsPerAttribute: 1,
    //                 componentDatatype: Cesium.ComponentDatatype.FLOAT,
    //             }
    //         ],
    //     });
    //
    //     this.shaderProgram = Cesium.ShaderProgram.fromCache({
    //         context: this.context,
    //         vertexShaderSource: `
    //             in vec3 a_position;
    //             in float a_fade;
    //             in float a_offset;
    //
    //             uniform mat4 u_modelViewProjectionMatrix;
    //             uniform vec2 u_viewportSize;
    //
    //             out float v_fade;
    //
    //             void main() {
    //                 // 월드 좌표 -> clip space
    //                 vec4 clip = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
    //                 vec2 ndc = clip.xy / clip.w;
    //
    //                 // 화면 공간에서 수직 방향으로 오프셋 적용
    //                 float thickness = 3.0 / u_viewportSize.y; // 픽셀 단위 두께
    //                 //float thickness = baseThickness * pow(v_fade, 100.5);
    //                 vec2 offset = vec2(-ndc.y, ndc.x); // 카메라 기준 수직 방향
    //                 offset = normalize(offset) * thickness * a_offset;
    //
    //                 vec4 offsetClip = clip;
    //                 offsetClip.xy += offset * clip.w; // 오프셋을 clip space에 맞게 적용
    //                 gl_Position = offsetClip;
    //
    //                 v_fade = a_fade;
    //             }
    //         `,
    //         fragmentShaderSource: `
    //             #version 300 es
    //             precision highp float;
    //
    //             uniform float u_time;
    //             in float v_fade;
    //             out vec4 fragColor;
    //
    //             void main() {
    //                 float r = abs(sin(u_time * 2.0)) * 2.0;
    //                 float g = abs(sin(u_time * 3.0 + 2.0)) * 2.0;
    //                 float b = abs(sin(u_time * 4.0 + 4.0)) * 2.0;
    //                 vec3 neonColor = vec3(r, g, b);
    //
    //                 fragColor = vec4(1.0 * v_fade, 0.5 * v_fade, 0.0, v_fade);
    //                 //fragColor = vec4(neonColor, v_fade);
    //                 // float glow = pow(1.0 - v_fade, 10.0);
    //                 // fragColor = vec4(1.0, 1.0, 0.0, glow);  // 노란색 glow 느낌
    //             }
    //         `,
    //         attributeLocations: {
    //             a_position: 0,
    //             a_fade: 1
    //         },
    //     });
    //
    //     this.drawCommand = new Cesium.DrawCommand({
    //         vertexArray: this.vertexArray,
    //         shaderProgram: this.shaderProgram,
    //         uniformMap: {
    //             u_modelViewProjectionMatrix: () =>
    //                 this.context.uniformState.modelViewProjection,
    //             u_time: () => performance.now() / 1000.0 , // 현재 시간을 셰이더에 전달
    //             u_viewportSize: () => {
    //                 return new Cesium.Cartesian2(
    //                     this.context.drawingBufferWidth,
    //                     this.context.drawingBufferHeight
    //                 );
    //             },
    //         },
    //         primitiveType: Cesium.PrimitiveType.TRIANGLE_STRIP,
    //         renderState: Cesium.RenderState.fromCache({
    //             depthTest: {
    //                 enabled: false,
    //             },
    //             blending: Cesium.BlendingState.ALPHA_BLEND,  // 알파 블렌딩 활성화
    //
    //         }),
    //         pass: Cesium.Pass.OPAQUE,
    //     });
    //
    //     this.ready = true;
    // }

    update(frameState) {

        if (this.destroyed) return; // 이미 제거된 경우 업데이트하지 않음

        if(this.show && this.latestPositions){
            this.trails.forEach((trail, index) => {
                //trail.drawCommand.execute(this.context);
                if(this.latestPositions[index]){

                    this.updateTrail(frameState, trail, index);
                }
            })
            //
            // console.log(this.latestPositions)

            //
        }

        // commandList에 추가
        // if(this.show){
        //     frameState.commandList.push(this.drawCommand);
        // }

    }

    // update(frameState) {
    //
    //     if (this.destroyed) return; // 이미 제거된 경우 업데이트하지 않음
    //
    //     if(!this.status) {
    //         this.previousTime = performance.now();
    //         if(this.show){
    //             frameState.commandList.push(this.drawCommand);
    //         }
    //         return;
    //     }
    //
    //     if (!this.positions || this.positions.length < 2) {
    //         console.error("🚨 경로 데이터가 부족하거나 초기화되지 않았습니다.");
    //         return;
    //     }
    //
    //     // speedKmh는 km/h로 주어지며 이를 m/s로 변환
    //     const speedMps = this.speed / 3.6; // km/h -> m/s
    //
    //     // 이동이 끝났으면 currentIndex 증가
    //     if (this.progress >= 1) {
    //         this.progress = 0; // 다음 이동을 위해 초기화
    //         this.currentIndex++; // 다음 위치로 이동
    //     } else {
    //         // 현재 위치와 다음 위치 가져오기
    //         let startPosition = this.positions[this.currentIndex];
    //         const nextIndex = this.currentIndex + 1;
    //         let endPosition = this.positions[nextIndex];
    //
    //         if (!startPosition || !endPosition) {
    //             return;
    //         }
    //
    //         // 이동 시간 계산 (속도와 거리로부터 시간 계산)
    //         const distance = Cesium.Cartesian3.distance(startPosition, endPosition); // m 단위
    //         const timeToTravel = distance / speedMps; // 이동 시간 (초 단위)
    //
    //         // 현재 시간과 이전 시간 간의 차이를 계산
    //         const currentTimestamp = performance.now();
    //         const deltaTime = (currentTimestamp - this.previousTime) / 1000; // 시간 차이 (초 단위)
    //         this.previousTime = currentTimestamp;
    //
    //         this.progress += (deltaTime / timeToTravel); // 시간에 비례하여 progress 증가
    //
    //         if (this.progress > 1) {
    //             this.progress = 1; // 최대값 제한
    //
    //         }
    //
    //         if(this.show){
    //             // 두 점 사이 위치 보간 (Lerp)
    //             let interpolatedPosition = new Cesium.Cartesian3();
    //             Cesium.Cartesian3.lerp(startPosition, endPosition, this.progress, interpolatedPosition);
    //
    //             // 위치 업데이트
    //             const newPositions = new Float32Array([interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z]);
    //
    //             const positionsArray = new Float32Array(this.positions.length * 3);
    //             for (let i = 0; i < 2; i++) {
    //                 positionsArray[i * 3] = this.positions[this.currentIndex+i].x;
    //                 positionsArray[i * 3 + 1] = this.positions[this.currentIndex+i].y;
    //                 positionsArray[i * 3 + 2] = this.positions[this.currentIndex+i].z;
    //             }
    //
    //
    //             this.updateTrail(interpolatedPosition);
    //         }
    //
    //
    //     }
    //     // commandList에 추가
    //     if(this.show){
    //         frameState.commandList.push(this.drawCommand);
    //     }
    //
    // }

    updateTrail(frameState, trail, index) {
        // 1. trail에 새로운 위치 추가
        trail.trailPosition.push(new Cartesian3(this.latestPositions[index][0], this.latestPositions[index][1], this.latestPositions[index][2]));

        if (trail.trailPosition.length > this.MAX_TRAIL_LENGTH) {
            trail.trailPosition.shift();
        }

        // 2. 평탄화된 포지션 배열 생성
        const flattenedTrailPositions = trail.trailPosition.flatMap(pos => [
            pos.x, pos.y, pos.z
        ]);

        // 3. fadeFactor 계산
        const fadeFactors = trail.trailPosition.map((_, i) => i / trail.trailPosition.length);

        const offsetFactor = (3 / trail.trailPosition.length)

        const offsets = trail.trailPosition.flatMap((_, i) => [- i * offsetFactor, i * offsetFactor]);

        // 4. 기존 vertexBuffer에 복사 (GPU 데이터 갱신)
        trail.vertexArray._attributes[0].vertexBuffer.copyFromArrayView(
            new Float32Array(flattenedTrailPositions)
        );

        trail.vertexArray._attributes[1].vertexBuffer.copyFromArrayView(
            new Float32Array(fadeFactors)
        );

        trail.vertexArray._attributes[2].vertexBuffer.copyFromArrayView(
            new Float32Array(offsets)
        );

        trail.drawCommand.uniformMap.u_time = () => performance.now() / 1000.0

        // this.drawCommand.uniformMap.u_viewportSize= () => {
        //     return new Cesium.Cartesian2(
        //         this.context.drawingBufferWidth,
        //         this.context.drawingBufferHeight
        //     );
        // };

        if(this.show){
            frameState.commandList.push(trail.drawCommand);
        }
    }

    convertFlatEcefToCartesian3(flatArray: number[]): Cartesian3[] {
        const result: Cartesian3[] = [];

        for (let i = 0; i < flatArray.length; i += 4) {
            const x = flatArray[i + 1];
            const y = flatArray[i + 2];
            const z = flatArray[i + 3];

            if (x === undefined || y === undefined || z === undefined) {
                continue;
            }

            const cartesian = new Cartesian3(x, y, z);
            const cartographic = Cartographic.fromCartesian(cartesian, Ellipsoid.WGS84);
            const longitude = CesiumMath.toDegrees(cartographic.longitude);
            const latitude = CesiumMath.toDegrees(cartographic.latitude);
            const height = cartographic.height;

            result.push(Cartesian3.fromDegrees(longitude, latitude, height));
        }

        return result;
    }

    float32ArrayToCartesian3(arr: Float32Array): Cartesian3 {
        if (arr.length % 3 !== 0) {
            throw new Error("Array length must be a multiple of 3.");
        }

        let x = arr[0], y = arr[1], z = arr[2];

        return new Cartesian3(x,y,z);
    }



    setSpeed(speed: number) {
        this.speed = speed;
    }
    setStatus(status: string) {
        this.status = status;
    }

    setLatestPositions(latestPositions) {
        this.latestPositions = latestPositions;
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
