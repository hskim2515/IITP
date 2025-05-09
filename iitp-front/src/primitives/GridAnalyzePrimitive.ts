import * as Cesium from "cesium";
import {Cartesian3} from "cesium";
import {combine} from "zustand/middleware/combine";


export default class GridAnalyzePrimitive{
    constructor(viewer, positions, speed, status, colors, exaggeration, gridWidth = 100, gridHeight = 100) {
        this.viewer = viewer;
        this.positions = positions;
        this.startPosition = this.positions[0]
        this.endPosition = this.positions[1]
        this.speed = speed;
        this.gridWidth = gridWidth;
        this.gridHeight = gridHeight;
        this.noiseValues = new Float32Array(gridWidth * gridHeight);
        this.noiseTexture = null;
        this.vertexArray = null;
        this.drawCommand = null;
        this.progress = [];
        this.status = status;
        this.previousTime = [] // 마지막 업데이트 시간
        this.currentIndex = [];
        this.show = true;
        this.exaggeration= exaggeration;
        this.colors = hexToVec3(colors);
        this.init();
    }

    init() {
        console.log(this.exaggeration)
        const context = this.viewer.scene.context;
        this.progress = new Array(this.positions[0].length).fill(0);
        this.currentIndex = new Array(this.positions[0].length).fill(0);
        this.previousTime = new Array(this.positions[0].length).fill(performance.now());

        this.createNoiseTexture(context);
        this.createGeometry(context);
        this.createDrawCommand(context);
    }

    createNoiseTexture(context) {
        this.noiseValues = new Float32Array(this.gridWidth * this.gridHeight);

        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues.fill(new Cartesian3(0,0,0)); // 0 ~ 1 사이의 값
        }


        this.noiseTexture = new Cesium.Texture({
            context: context,
            pixelFormat: Cesium.PixelFormat.RED,
            pixelDatatype: Cesium.PixelDatatype.FLOAT,
            source: {
                width: this.gridWidth,
                height: this.gridHeight,
                arrayBufferView: this.noiseValues
            },
            sampler: new Cesium.Sampler({
                wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
                wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
                minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
                magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR
            })
        });
    }

    createGeometry(context) {
        // === 1. 화살표 구성 ===
        const shaftHeight = 0.6;
        const shaftRadius = 0.05;

        const headHeight = 0.3;
        const headRadius = 0.12;

        const segments = 16;

        const positions = [];
        const indices = [];
        const stValues = [];

        let index = 0;

        // === 2. 원기둥 몸통 생성 (Y축을 중심으로 회전) ===
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;

            const x1 = Math.cos(theta1) * shaftRadius;
            const y1 = Math.sin(theta1) * shaftRadius;

            const x2 = Math.cos(theta2) * shaftRadius;
            const y2 = Math.sin(theta2) * shaftRadius;

            // 두 삼각형으로 원기둥 면 구성
            positions.push(x1, y1, 0);                  // bottom1
            positions.push(x2, y2, 0);                  // bottom2
            positions.push(x1, y1, shaftHeight);        // top1

            positions.push(x2, y2, 0);                  // bottom2
            positions.push(x2, y2, shaftHeight);        // top2
            positions.push(x1, y1, shaftHeight);        // top1

            for (let j = 0; j < 6; j++) {
                const px = j % 2 === 0 ? x1 : x2;
                const py = j % 2 === 0 ? y1 : y2;
                stValues.push(px * 0.5 + 0.5, py * 0.5 + 0.5);
            }

            indices.push(index, index + 1, index + 2);
            indices.push(index + 3, index + 4, index + 5);
            index += 6;
        }

        // === 3. 원뿔 화살촉 생성 ===
        const tipZ = shaftHeight + headHeight;
        const coneCenter = [0, 0, tipZ];

        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;

            const x1 = Math.cos(theta1) * headRadius;
            const y1 = Math.sin(theta1) * headRadius;

            const x2 = Math.cos(theta2) * headRadius;
            const y2 = Math.sin(theta2) * headRadius;

            // 화살촉 삼각형
            positions.push(x1, y1, shaftHeight);
            positions.push(x2, y2, shaftHeight);
            positions.push(...coneCenter);

            stValues.push(x1 * 0.5 + 0.5, y1 * 0.5 + 0.5);
            stValues.push(x2 * 0.5 + 0.5, y2 * 0.5 + 0.5);
            stValues.push(0.5, 0.5); // 중심점

            indices.push(index, index + 1, index + 2);
            index += 3;
        }

        const positionArray = new Float32Array(positions);
        const stArray = new Float32Array(stValues);
        const indexArray = new Uint16Array(indices);

        // === 4. VertexArray 생성 ===
        this.vertexArray = Cesium.VertexArray.fromGeometry({
            context: context,
            geometry: new Cesium.Geometry({
                attributes: {
                    position: new Cesium.GeometryAttribute({
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 3,
                        values: positionArray
                    }),
                    st: new Cesium.GeometryAttribute({
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 2,
                        values: stArray
                    })
                },
                indices: indexArray,
                primitiveType: Cesium.PrimitiveType.TRIANGLES
            }),
            attributeLocations: {
                position: 0,
                st: 1
            }
        });
    }



    createDrawCommand(context) {

        const vertexShader = `
            #version 300 es
            precision highp float;
            
            layout(location = 0) in vec3 position;
            layout(location = 1) in vec2 st;
            
            uniform sampler2D noiseTexture;
            
            uniform mat4 u_modelViewProjectionMatrix;
            uniform vec2 u_noiseOffset;
            uniform vec2 u_noiseScale;
            
            uniform float exaggeration;
            
            out float v_height;
            out float v_density;
            out vec2 v_st;
            
            // 방향 벡터를 회전 행렬로 변환
            mat3 getDirectionRotation(vec3 dir) {
                vec3 z = normalize(dir);
                vec3 up = vec3(0.0, 0.0, 1.0);
                vec3 x = normalize(cross(up, z));
                vec3 y = cross(z, x);
                return mat3(x, y, z);
            }
            
            void main() {
                vec2 texCoord;
                // if (exaggeration >= 1.0) {
                //     texCoord = u_noiseOffset + floor(st * u_noiseScale);
                // } else {
                //     texCoord = u_noiseOffset + (st * u_noiseScale);
                // }
            
                // 방향 벡터 RGB → [-1, 1]
                vec3 raw = texture(noiseTexture, texCoord).rgb * 2.0 - 1.0;
                float density = length(raw);
                vec3 direction = normalize(raw);
            
                float height = density * 300.0 * exaggeration;
            
                v_height = height;
                v_density = density;
                v_st = st;
            
                vec3 pos = position;
            
                // if (pos.z > 0.0) {
                //     pos.z += 10.0;
                // }
                //pos.z = 10.0
                // 방향 회전 적용
                mat3 rotation = getDirectionRotation(direction);
                pos = rotation * pos;
            
                gl_Position = u_modelViewProjectionMatrix * vec4(pos, 1.0);
            }
            
            `;

        const fragmentShader = `
            #version 300 es
            precision highp float;
        
            in float v_height;
            in float v_density;
            in vec2 v_st;
        
            uniform float u_time;
            
            uniform vec3 grade1Color;
            uniform vec3 grade2Color;
            uniform vec3 grade3Color;
            uniform vec3 grade4Color;
        
            out vec4 fragColor;
        
            vec3 colormap(float value) {
                return clamp(
                    value < 0.25 ? grade1Color :
                    value < 0.5  ? grade2Color :
                    value < 0.75 ? grade3Color :
                                   grade4Color,
                    0.0, 1.0
                );
            }
        
            void main() {
            // 카메라 방향에 따른 광원 방향 설정
            vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));  // 기본 광원 방향
        
            float normalizedHeight = pow(v_height / 300.0, 1.3);
            vec3 baseColor = colormap(normalizedHeight);
        
            // Light simulation
            float light = clamp(dot(normalize(vec3(0.0, 0.0, 1.0)), lightDir), 0.3, 1.0);
            
            // Ambient Light 추가 (주변광)
            vec3 ambientLight = vec3(0.3, 0.3, 0.3);  // 약간의 배경광을 추가
            baseColor += ambientLight;
        
            // Border effect
            float edge = smoothstep(0.0, 0.05, v_st.x) *
                         smoothstep(0.0, 0.05, v_st.y) *
                         smoothstep(0.0, 0.05, 1.0 - v_st.x) *
                         smoothstep(0.0, 0.05, 1.0 - v_st.y);
            float border = 1.0 - edge;
        
            // 혼잡 지역 pulse 효과 (밀집도 > 0.8)
            if (normalizedHeight > 0.8) {
                float pulse = 0.5 + 0.5 * sin(u_time * 5.0);
                baseColor = mix(baseColor, grade4Color, pulse);
            }
        
            //vec3 finalColor = mix(vec3(0.0), baseColor * light, border);
            vec3 finalColor = mix(vec3(0.0), baseColor * light, 1.0);
            fragColor = vec4(finalColor, 1.0);
            }
        
        `;


        try{
            const shaderProgram = Cesium.ShaderProgram.fromCache({
                context: context,
                vertexShaderSource: vertexShader,
                fragmentShaderSource: fragmentShader,
                attributeLocations: {
                    position: 0,
                    st: 1
                }
            });

            this.drawCommands = [];

            // 다수의 위치 좌표 평균으로 중심 계산
            let sum = new Cesium.Cartesian3(0, 0, 0);
            for (const pos of this.positions[0]) {
                Cesium.Cartesian3.add(sum, pos, sum);
            }
            const center = Cesium.Cartesian3.divideByScalar(sum, this.positions[0].length, new Cesium.Cartesian3());

            const modelMatrixCenter = Cesium.Transforms.eastNorthUpToFixedFrame(center);

            for (let y = 0; y < this.gridHeight; y++) {
                for (let x = 0; x < this.gridWidth; x++) {
                    const tx = x - this.gridWidth / 2;
                    const ty = y - this.gridHeight / 2;

                    const offset = new Cesium.Cartesian3(tx * 500, ty * 500, 0); // ENU 오프셋
                    const localPosition = Cesium.Matrix4.multiplyByPoint(modelMatrixCenter, offset, new Cesium.Cartesian3());

                    const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(localPosition);
                    const exaggeration = this.exaggeration; // 예: 0.1 ~ 2.0
                    const baseScale = 100.0;

                    // 낮을수록 퍼짐 (최소값 제한)
                    const xyScale = baseScale / Math.max(1.0, 0.01);
                    const zScale = 1.0;

                    this.scale = new Cesium.Cartesian3(xyScale, xyScale, zScale);
                    //this.scale = new Cesium.Cartesian3(100.0, 100.0, 1.0);

                    const scaleMatrix = Cesium.Matrix4.fromScale(this.scale, new Cesium.Matrix4());
                    const finalModelMatrix = Cesium.Matrix4.multiply(modelMatrix, scaleMatrix, new Cesium.Matrix4());

                    const viewMatrix = this.viewer.scene.context.uniformState.view;
                    const projectionMatrix = this.viewer.scene.context.uniformState.projection;

                    const mvMatrix = Cesium.Matrix4.multiply(viewMatrix, finalModelMatrix, new Cesium.Matrix4());
                    const mvpMatrix = Cesium.Matrix4.multiply(projectionMatrix, mvMatrix, new Cesium.Matrix4());

                    const drawCommand = new Cesium.DrawCommand({
                        vertexArray: this.vertexArray,
                        shaderProgram: shaderProgram,
                        uniformMap: {
                            u_modelViewProjectionMatrix: () => mvpMatrix,
                            u_time:() => performance.now() / 1000.0,

                            noiseTexture: () => this.noiseTexture,
                            u_noiseOffset: () => new Cesium.Cartesian2(x / this.gridWidth, y / this.gridHeight),
                            u_noiseScale: () => new Cesium.Cartesian2(1.0 / this.gridWidth, 1.0 / this.gridHeight),
                            grade1Color: () => this.colors[0],
                            grade2Color: () => this.colors[1],
                            grade3Color: () => this.colors[2],
                            grade4Color: () => this.colors[3],
                            exaggeration: () => this.exaggeration,
                        },
                        renderState: Cesium.RenderState.fromCache({
                            depthTest: { enabled: true },
                            blending: Cesium.BlendingState.ALPHA_BLEND
                        }),
                        pass: Cesium.Pass.OPAQUE
                    });
                    //this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 100000.0));

                    //drawCommand.boundingVolume = new Cesium.BoundingSphere(localPosition, 10000.0);
                    this.drawCommands.push({ drawCommand, x, y });  // x, y를 저장해두기
                }
            }


        }catch (error){
            console.error(error);
        }
    }

    updateValues(center) {
        // 기존 noiseValues 감쇠
        // for (let i = 0; i < this.noiseValues.length; i++) {
        //     this.noiseValues[i] *= 0.95;
        // }
        this.noiseValues = new Array(this.gridWidth * this.gridHeight).fill(0);

        // 4. Y축 반전을 적용한 최종 회전 행렬

        this.targetPositionArr.forEach((position, i) => {
            if (!position || !this.originPositionArr[i] || position == this.originPositionArr[i]) return;

            //console.log(this.originPositionArr[i], position)

            const direction = calculateDirection(this.originPositionArr[i], position)

            console.log(direction)

            // const startGridIndex = getGridIndex(this.originPositionArr[i], center); // 시작점 그리드 인덱스
            // const endGridIndex = getGridIndex(position, center); // 끝점 그리드 인덱스


            // if(this.noiseValues[startGridIndex]){
            //     //console.log("startGridIndex", startGridIndex, this.noiseValues[startGridIndex]);
            //     this.noiseValues[startGridIndex] = Cartesian3.add(this.noiseValues[startGridIndex], direction, this.noiseValues[startGridIndex]);
            // }
            // 시작점과 끝점 그리드 셀에 방향 벡터 누적

            // if(this.noiseValues[endGridIndex]){
            //     this.noiseValues[endGridIndex] = Cartesian3.add(this.noiseValues[endGridIndex], direction, this.noiseValues[endGridIndex]);
            // }
            const radius = Math.floor(1.0/this.exaggeration || 0.1); // 퍼질 반경 (exaggeration=1일 땐 자기 셀만)

            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const gx = Math.floor(this.originPositionArr[i].x / 1) + dx;
                    const gy = Math.floor(this.originPositionArr[i].y / 1) + dy;
                    if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const strength = 1.0; // 강도
                        const falloff = Math.pow(Math.max(1.0 - distance / (radius + 0.1), 0.0), strength);
                        // 방향 벡터와 함께 합산
                        const gridIndex = gy * this.gridWidth + gx;
                        const weightedDirection = Cartesian3.multiplyByScalar(direction, falloff, new Cartesian3());
                        this.noiseValues[gridIndex] = Cartesian3.add(this.noiseValues[gridIndex], weightedDirection, this.noiseValues[gridIndex]);
                    }
                }
            }

        });

        // 정규화
        // const max = Math.max(...this.noiseValues);
        // if (max > 0) {
        //     for (let i = 0; i < this.noiseValues.length; i++) {
        //         this.noiseValues[i] = (this.noiseValues[i] / max );
        //     }
        // }

        // 텍스처에 반영
        this.noiseTexture.copyFrom({
            source: {
                width: this.gridWidth,
                height: this.gridHeight,
                arrayBufferView: this.noiseValues
            }
        });
    }

    update(frameState) {

        if(this.targetPositionArr){

            this.originPositionArr = [...this.targetPositionArr]
        }

        this.targetPositionArr = []

        for(let i = 0; i < this.startPosition.length; ++i) {

            let startPosition = this.positions[this.currentIndex[i]];
            let endPosition = this.positions[this.currentIndex[i]+1];

            if (this.progress[i] >= 1) {
                this.progress[i] = 0;
                this.currentIndex[i] = this.currentIndex[i] + 1;
            } else {
                if(startPosition[i] == null || !endPosition || endPosition[i] == null){
                    this.targetPositionArr.push(null)
                    return;
                }else{
                    if(!this.status || this.startPosition ==undefined) {
                        const currentTimestamp = performance.now();
                        this.previousTime[i] = currentTimestamp;
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
                    }
                    let interpolatedPosition = new Cesium.Cartesian3();
                    Cesium.Cartesian3.lerp(startPosition[i], endPosition[i], this.progress[i], interpolatedPosition);
                    this.targetPositionArr.push(interpolatedPosition)
                }
            }
        }


        if (this.show) {

            let sum = new Cesium.Cartesian3(0, 0, 0);
            for (const pos of this.targetPositionArr) {
                Cesium.Cartesian3.add(sum, pos, sum);
            }
            const center = Cesium.Cartesian3.divideByScalar(sum, this.targetPositionArr.length, new Cesium.Cartesian3());

            const modelMatrixCenter = Cesium.Transforms.eastNorthUpToFixedFrame(center);

            if(this.originPositionArr && this.status){

                this.updateValues(center);
            }

            for (let i = 0; i < this.drawCommands.length; i++) {
                const { drawCommand, x, y } = this.drawCommands[i];

                const tx = x - this.gridWidth / 2;
                const ty = y - this.gridHeight / 2;

                const offset = new Cesium.Cartesian3(tx * 100, ty * 100, 0); // ENU 오프셋

                const localPosition = Cesium.Matrix4.multiplyByPoint(modelMatrixCenter, offset, new Cesium.Cartesian3());

                const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(localPosition);

                const baseScale = 100.0;

                // 낮을수록 퍼짐 (최소값 제한)
                const xyScale = baseScale / Math.max(this.exaggeration, 1.0);
                const zScale = this.exaggeration;

                this.scale = new Cesium.Cartesian3(xyScale, xyScale, zScale);

                const scaleMatrix = Cesium.Matrix4.fromScale(this.scale, new Cesium.Matrix4());
                const finalModelMatrix = Cesium.Matrix4.multiply(modelMatrix, scaleMatrix, new Cesium.Matrix4());

                const viewMatrix = this.viewer.scene.context.uniformState.view;
                const projectionMatrix = this.viewer.scene.context.uniformState.projection;

                const mvMatrix = Cesium.Matrix4.multiply(viewMatrix, finalModelMatrix, new Cesium.Matrix4());
                const mvpMatrix = Cesium.Matrix4.multiply(projectionMatrix, mvMatrix, new Cesium.Matrix4());

                drawCommand.uniformMap.u_modelViewProjectionMatrix = () => mvpMatrix;
                drawCommand.uniformMap.u_time= () => performance.now() / 1000.0;
                drawCommand.uniformMap.u_noiseOffset = () => new Cesium.Cartesian2(x / this.gridWidth, y / this.gridHeight);
            }

            for (const command of this.drawCommands) {
                frameState.commandList.push(command.drawCommand);
            }
        }
    }

    setSpeed(speed: number) {
        this.speed = speed;
    }

    setStatus(status: string) {
        this.status = status;
    }

    setColors(colors: string[]) {
        this.colors = hexToVec3(colors);
    }

    setExaggeration(exaggeration: number) {
        console.log(exaggeration);
        this.exaggeration = exaggeration
    }

    destroy() {
        this.noiseTexture.destroy();
        this.vertexArray.destroy();
        //this.drawCommand.shaderProgram.destroy();
    }
}

function calculateDirection(start: Cartesian3, end: Cartesian3): Cartesian3 {
    // if(start.equals(end)){
    //     return new Cartesian3(0,0,0)
    // }
    const direction = Cartesian3.subtract(end, start, new Cartesian3());
    Cartesian3.normalize(direction, direction);
    return direction;
}

function getGridIndex(position, center): number {

    // 중심점 기준 ENU 회전행렬만 추출 (위치 정보 제외)
    const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const rotationMatrix = Cesium.Matrix4.getMatrix3(enuMatrix, new Cesium.Matrix3());

    // ENU → 월드 좌표로 변환된 위치를 다시 되돌리기 위해 회전 역행렬을 적용 (전치)
    const inverseRotation = Cesium.Matrix3.transpose(rotationMatrix, new Cesium.Matrix3());

    // 3. Y축 반전 행렬 생성
    const flipYMatrix = new Cesium.Matrix3(
        1,  0,  0,
        0, -1,  0,
        0,  0,  1
    );

    const adjustedRotation = Cesium.Matrix3.multiply(flipYMatrix, inverseRotation, new Cesium.Matrix3());

    const cellSizeX = 100.0;
    const cellSizeY = 100.0;

    // 월드 위치에서 중심점 빼기 (ENU 원점 기준 오프셋)
    const offsetFromCenter = Cesium.Cartesian3.subtract(position, center, new Cesium.Cartesian3());

    // 회전 역행렬을 곱해서 ENU 기준으로 좌표 변환
    const localENU = Cesium.Matrix3.multiplyByVector(adjustedRotation, offsetFromCenter, new Cesium.Cartesian3());

    // ENU 평면 좌표계 (x: East, y: North)에 맞춰 인덱스 계산
    const gridX = Math.floor(localENU.x / cellSizeX + 100 / 2);
    const gridY = Math.floor(localENU.y / cellSizeY + 100 / 2);

    return gridY * 100 + gridX;
}

function hexToVec3(colors: string[]) {
    let colorArray = []
    colors.forEach((hex) => {
        // Remove #
        hex = hex.replace("#", "");

        // Expand shorthand form (e.g. "f00") to full form (e.g. "ff0000")
        if (hex.length === 3) {
            hex = hex.split("").map(ch => ch + ch).join("");
        }

        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;

        return colorArray.push(new Cesium.Cartesian3(Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3))))
    })

    return colorArray;

}

