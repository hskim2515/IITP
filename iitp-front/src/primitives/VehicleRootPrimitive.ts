import * as Cesium from "cesium";

export default class VehicleRootPrimitive {
    constructor(positions, context) {
        this.positions = positions; // CZML에서 가져온 positions
        this.currentIndex = 0;
        this.ready = false;
        this.context = context;
        this.previousTime = performance.now(); // 마지막 업데이트 시간
        this.destroyed = false; // 객체가 제거되었는지 여부를 추적
        this.tailLength = 10; // 꼬리 길이 (몇 프레임에 해당하는 위치가 남을지 결정)
        this.tailPositions = []; // 꼬리 위치를 저장할 배열
        this.progress = 0;

        this.createResources();
    }

    createResources() {
        // 초기 위치 설정
        const initialPosition = this.positions[0];
        const positionsArray = new Float32Array(this.positions.length * 3);
        for (let i = 0; i < this.positions.length; i++) {
            positionsArray[i * 3] = this.positions[i].x;
            positionsArray[i * 3 + 1] = this.positions[i].y;
            positionsArray[i * 3 + 2] = this.positions[i].z;
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
            gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
        }
    `,
            fragmentShaderSource: `
        #version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() {
            fragColor = vec4(1.0, 1.0, 0.0, 0.8); // 노란색 선
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
            primitiveType: Cesium.PrimitiveType.LINES,
            renderState: Cesium.RenderState.fromCache({
                depthTest: {
                    enabled: false,
                },
                blending: Cesium.BlendingState.ALPHA_BLEND,  // 알파 블렌딩 활성화

            }),
            pass: Cesium.Pass.OPAQUE,
        });

        this.ready = true;
    }

    update(frameState) {

        if (this.destroyed) return; // 이미 제거된 경우 업데이트하지 않음

        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족하거나 초기화되지 않았습니다.");
            return;
        }

        // 이동이 끝났으면 currentIndex 증가
        if (this.progress >= 1) {

            this.progress = 0; // 다음 이동을 위해 초기화
            //if (this.currentIndex < this.positions.length - 2) {
                this.currentIndex++; // 다음 위치로 이동
            //}
        }else{
            // 현재 위치와 다음 위치 가져오기
            let startPosition = this.positions[this.currentIndex];
            const nextIndex = this.currentIndex + 1;
            let endPosition = this.positions[nextIndex];

            if (!startPosition || !endPosition) {
                return;
            }

            // progress 증가 (이동 속도를 조절하려면 증가 값을 조정)
            this.progress += 0.05; // 0.02씩 증가 (속도를 변경하려면 조절)
            if (this.progress > 1) {
                this.progress = 1; // 최대값 제한
            }

            // 두 점 사이 위치 보간 (Lerp)
            let interpolatedPosition = new Cesium.Cartesian3();
            Cesium.Cartesian3.lerp(startPosition, endPosition, this.progress, interpolatedPosition);

            // 위치 업데이트
            const newPositions = new Float32Array([interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z]);

            const positionsArray = new Float32Array(this.positions.length * 3);
            for (let i = 0; i < 2; i++) {
                positionsArray[i * 3] = this.positions[this.currentIndex+i].x;
                positionsArray[i * 3 + 1] = this.positions[this.currentIndex+i].y;
                positionsArray[i * 3 + 2] = this.positions[this.currentIndex+i].z;
            }

            this.vertexBuffer.copyFromArrayView(positionsArray);


        }
        // commandList에 추가
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
