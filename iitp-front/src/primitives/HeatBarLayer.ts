import * as Cesium from "cesium";
import {Cartesian3} from "cesium";


export default class HeatBarLayer{
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
        this.show = false;
        this.exaggeration= exaggeration;
        this.colors = hexToVec3(colors);
        //this.init();
    }

    init() {
        const context = this.viewer.scene.context;
        // this.progress = new Array(this.positions[0].length).fill(0);
        // this.currentIndex = new Array(this.positions[0].length).fill(0);
        // this.previousTime = new Array(this.positions[0].length).fill(performance.now());

        this.createNoiseTexture(context);
        this.createGeometry(context);
        this.createDrawCommand(context);
    }

    createNoiseTexture(context) {
        this.noiseValues = new Float32Array(this.gridWidth * this.gridHeight);

        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues[i] = Math.random(); // 0 ~ 1 사이의 값
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
        const geometry = Cesium.BoxGeometry.createGeometry(
            new Cesium.BoxGeometry({
                vertexFormat: Cesium.VertexFormat.POSITION_ONLY,
                maximum: new Cesium.Cartesian3(0.5, 0.5, 0.5),
                minimum: new Cesium.Cartesian3(-0.5, -0.5, 0.0)
            })
        );

        const positionAttribute = geometry.attributes.position;
        const positions = positionAttribute.values;
        const indices = geometry.indices;

        const vertexCount = positions.length / 3;

        // ✅ st 좌표 계산: BoxGeometry는 정사각형이므로 단순 반복 가능한 패턴 사용
        const stValues = new Float32Array(vertexCount * 2);
        for (let i = 0; i < vertexCount; i++) {
            const px = positions[i * 3];
            const py = positions[i * 3 + 1];

            // 정규화된 좌표로 매핑 (-0.5 ~ 0.5 → 0 ~ 1)
            stValues[i * 2] = px + 0.5;
            stValues[i * 2 + 1] = py + 0.5;
        }

        this.vertexArray = Cesium.VertexArray.fromGeometry({
            context: context,
            geometry: new Cesium.Geometry({
                attributes: {
                    position: new Cesium.GeometryAttribute({
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 3,
                        values: positions
                    }),
                    st: new Cesium.GeometryAttribute({
                        componentDatatype: Cesium.ComponentDatatype.FLOAT,
                        componentsPerAttribute: 2,
                        values: stValues
                    })
                },
                indices: indices,
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
        
            void main() {
                // texCoord를 사각형 크기 단위로 나눈다.
                //vec2 texCoord = u_noiseOffset + floor(st * u_noiseScale);  // floor를 이용해 각 사각형에 대해 같은 texCoord를 생성
                

                vec2 texCoord;
                if (exaggeration >= 1.0) {
                    texCoord = u_noiseOffset + floor(st * u_noiseScale); // 박스형
                } else {
                    texCoord = u_noiseOffset + (st * u_noiseScale); // 부드러운 히트맵형
                }
            
                // noise 값을 동일하게 반환
                float noise = texture(noiseTexture, texCoord).r;
                float height = noise * 300.0 * exaggeration;
            
                v_height = height;
                v_density = noise; // 정규화된 밀집도 [0~1]
                v_st = st;
            
                // 위쪽 꼭짓점만 밀어올림
                vec3 pos = position;
                if (position.z > 0.0) {
                    pos.z += height; 
                }
                
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
            fragColor = vec4(finalColor, 0.5);
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
            for (const pos of this.latestPositions) {
                if(pos)
                    Cesium.Cartesian3.add(sum, new Cartesian3(pos[0],pos[1],pos[2]), sum);
            }
            //console.log(sum)
            const center = Cesium.Cartesian3.divideByScalar(sum, this.latestPositions.filter(item => item !== undefined).length, new Cesium.Cartesian3());
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

    updateNoiseValues(targetPositionArr, center) {
        // 기존 noiseValues 감쇠
        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues[i] *= 0.95;
        }

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

        // 4. Y축 반전을 적용한 최종 회전 행렬
        const adjustedRotation = Cesium.Matrix3.multiply(flipYMatrix, inverseRotation, new Cesium.Matrix3());

        const cellSizeX = 100.0;
        const cellSizeY = 100.0;

        targetPositionArr.forEach(position => {
            if (!position) return;

            position = new Cartesian3(position[0], position[1], position[2]);
            // 월드 위치에서 중심점 빼기 (ENU 원점 기준 오프셋)
            const offsetFromCenter = Cesium.Cartesian3.subtract(position, center, new Cesium.Cartesian3());

            // 회전 역행렬을 곱해서 ENU 기준으로 좌표 변환
            const localENU = Cesium.Matrix3.multiplyByVector(adjustedRotation, offsetFromCenter, new Cesium.Cartesian3());

            // ENU 평면 좌표계 (x: East, y: North)에 맞춰 인덱스 계산
            const gridX = Math.floor(localENU.x / cellSizeX + this.gridWidth / 2);
            const gridY = Math.floor(localENU.y / cellSizeY + this.gridHeight / 2);

            const radius = Math.floor(1.0/this.exaggeration || 0.1); // 퍼질 반경 (exaggeration=1일 땐 자기 셀만)

            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const gx = gridX + dx;
                    const gy = gridY + dy;
                    if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const strength = this.exaggeration;
                        const falloff = Math.pow(Math.max(1.0 - distance / (radius + 0.1), 0.0), strength);
                        this.noiseValues[gy * this.gridWidth + gx] += falloff;
                    }
                }
            }
        });

        // 정규화
        const max = Math.max(...this.noiseValues);
        if (max > 0) {
            for (let i = 0; i < this.noiseValues.length; i++) {
                this.noiseValues[i] = (this.noiseValues[i] / max) * 10.0;
            }
        }

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

        // const targetPositionArr = []
        //
        // for(let i = 0; i < this.startPosition.length; ++i) {
        //
        //     let startPosition = this.positions[this.currentIndex[i]];
        //     let endPosition = this.positions[this.currentIndex[i]+1];
        //
        //     if (this.progress[i] >= 1) {
        //         this.progress[i] = 0;
        //         this.currentIndex[i] = this.currentIndex[i] + 1;
        //     } else {
        //         if(startPosition[i] == null || !endPosition || endPosition[i] == null){
        //             targetPositionArr.push(null)
        //             return;
        //         }else{
        //             if(!this.status || this.startPosition ==undefined) {
        //                 const currentTimestamp = performance.now();
        //                 this.previousTime[i] = currentTimestamp;
        //             }else{
        //                 const speedMps = this.speed / 3.6; // km/h -> m/s
        //
        //                 // 이동 시간 계산 (속도와 거리로부터 시간 계산)
        //                 const distance = Cesium.Cartesian3.distance(startPosition[i], endPosition[i]); // m 단위
        //                 const timeToTravel = distance / speedMps; // 이동 시간 (초 단위)
        //
        //                 const currentTimestamp = performance.now();
        //                 const deltaTime = (currentTimestamp - this.previousTime[i]) / 1000; // 시간 차이 (초 단위)
        //                 this.previousTime[i] = currentTimestamp;
        //
        //
        //                 this.progress[i] += (deltaTime / timeToTravel); // 시간에 비례하여 progress 증가
        //
        //                 if (this.progress[i] > 1) {
        //                     this.progress[i] = 1; // 최대값 제한
        //                 }
        //             }
        //             let interpolatedPosition = new Cesium.Cartesian3();
        //             Cesium.Cartesian3.lerp(startPosition[i], endPosition[i], this.progress[i], interpolatedPosition);
        //             targetPositionArr.push(interpolatedPosition)
        //         }
        //     }
        // }


        if (this.show && this.latestPositions && this.latestPositions.filter(item => item !== undefined).length > 0) {
            if(!this.noiseTexture){
                this.init()
            }

            let sum = new Cesium.Cartesian3(0, 0, 0);
            for (const pos of this.latestPositions) {
                if(pos)
                    Cesium.Cartesian3.add(sum, new Cartesian3(pos[0],pos[1],pos[2]), sum);
            }
            const center = Cesium.Cartesian3.divideByScalar(sum, this.latestPositions.filter(item => item !== undefined).length, new Cesium.Cartesian3());

            const modelMatrixCenter = Cesium.Transforms.eastNorthUpToFixedFrame(center);

            this.updateNoiseValues(this.latestPositions, center);

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
        this.exaggeration = exaggeration
    }

    setLatestPositions(latestPositions) {
        this.latestPositions = latestPositions;
    }

    destroy() {
        this.noiseTexture?.destroy();
        this.vertexArray?.destroy();
        //this.drawCommand.shaderProgram.destroy();
    }
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

