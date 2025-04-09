import * as Cesium from "cesium";

class HeatMapLayer{
    constructor(viewer, positions, speed, status, gridWidth = 35, gridHeight = 35) {
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
        this.init();
    }

    init() {
        const context = this.viewer.scene.context;
        this.progress = new Array(this.positions[0].length).fill(0);
        this.currentIndex = new Array(this.positions[0].length).fill(0);
        this.previousTime = new Array(this.positions[0].length).fill(performance.now());

        this.createNoiseTexture(context);
        this.createGeometry(context);
        this.createDrawCommand(context);
    }

    createNoiseTexture(context) {
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
        const positions = new Float32Array([
            -1, -1, 0,  // 좌하단
            1, -1, 0,  // 우하단
            1,  1, 0,  // 우상단
            -1,  1, 0   // 좌상단
        ]);

        const textureCoordinates = new Float32Array([
            0, 0,  // 좌하단
            1, 0,  // 우하단
            1, 1,  // 우상단
            0, 1   // 좌상단
        ]);

        const indices = new Uint16Array([
            0, 1, 2,  // 첫 번째 삼각형
            0, 2, 3   // 두 번째 삼각형
        ]);

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
                        values: textureCoordinates
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

        const vertexShader =
            `
        #version 300 es
        precision highp float;

        layout(location = 0) in vec3 position;
        layout(location = 1) in vec2 st;

        out vec2 v_st;

        uniform mat4 u_modelViewProjectionMatrix;

        void main() {
            v_st = st;  // UV 좌표 그대로 전달
            gl_Position = vec4(position, 1.0);
        }`


        const fragmentShader = `
            #version 300 es
            precision highp float;
            
            uniform sampler2D noiseTexture;
            in vec2 v_st;
            out vec4 fragColor;
            
            vec3 colormap(float value) {
                return clamp(
                    value < 0.25 ? vec3(0.0, 4.0 * value, 0.5) :
                    value < 0.5  ? vec3(0.0, 1.0, 1.0 - 4.0 * (value - 0.25)) :
                    value < 0.75 ? vec3(4.0 * (value - 0.5), 1.0, 0.0) :
                                   vec3(1.0, 1.0 - 4.0 * (value - 0.75), 0.0),
                    0.0, 1.0
                );
            }
            
            void main() {
                float noise = texture(noiseTexture, v_st).r;
                vec3 color = colormap(noise);
                
                // 파란색 영역 (noise 0.25 이하)이면 투명하게 처리
                float alpha = noise < 0.25 ? 0.0 : 0.8;
            
                fragColor = vec4(color, alpha);
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

            this.drawCommand = new Cesium.DrawCommand({
                vertexArray: this.vertexArray,
                shaderProgram: shaderProgram,
                uniformMap: {
                    noiseTexture: () => this.noiseTexture,
                },
                renderState: Cesium.RenderState.fromCache({
                    depthTest: {
                        enabled: false
                    },
                    blending: Cesium.BlendingState.ALPHA_BLEND
                }),
                pass: Cesium.Pass.OPAQUE
            });
        }catch (error){
            console.error(error);
        }
    }

    updateNoiseValues(targetPositionArr) {
        //this.noiseValues.fill(0);
        // 기존 값 감쇠 (잔상 효과)
        for (let i = 0; i < this.noiseValues.length; i++) {
            this.noiseValues[i] *= 0.95;
        }
        targetPositionArr.forEach(position => {
            if (position && position.x) {
                const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position);
                if(!screenPos){
                    return;
                }

                const x = Math.round(screenPos.x / this.viewer.scene.canvas.width * this.gridWidth);
                const y = Math.round(screenPos.y / this.viewer.scene.canvas.height * this.gridHeight);

                if (x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight) {
                    this.noiseValues[y * this.gridWidth + x] += 1.0;
                }
            }
        });

        let max = 5.0;
        if (max > 0) {
            for (let i = 0; i < this.noiseValues.length; i++) {
                this.noiseValues[i] /= max;
                //this.noiseValues[i] *= 2;
            }
        }

        // 텍스처에 복사
        this.noiseTexture.copyFrom({
            source: {
                width: this.gridWidth,
                height: this.gridHeight,
                arrayBufferView: this.noiseValues
            }
        });
    }


    update(frameState) {

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
                    targetPositionArr.push(interpolatedPosition)
                }
            }
        }
        this.updateNoiseValues(targetPositionArr);

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
        this.noiseTexture.destroy();
        this.vertexArray.destroy();
        this.drawCommand.shaderProgram.destroy();
    }
}

export default HeatMapLayer;
