import * as Cesium from "cesium";
import h337 from "heatmap.js";
import {Cartesian3} from "cesium"; // heatmap.js 라이브러리

class HeatMapBend {
    constructor(
        viewer,
        positions,
        radius = 25,
        scale = 500,
        heightMultiplier = 200,
        options = {
            maxOpacity: 1,
            minOpacity: 0,
            blur: 0.75,
            gradient: {
                0.05: "rgb(0,0,255)",
                0.35: "rgb(0,255,0)",
                0.65: "yellow",
                1: "rgb(255,0,0)",
            },
        }
    ) {
        let self = this;
        this.geoData = positions[0];
        this.positions = positions;
        this.viewer = viewer;
        this.radius = radius;
        this.scale = scale;
        this.heightMultiplier = heightMultiplier;
        this.options = options;
        this.heatmapInstance = null;
        this.rectExtremum = this.getBoundingBox(this.geoData);
        this.currentIndex = 0;
        this.progress = 0;
        self.init();
    }

    init() {
        //console.log(this.geoData)
        let self = this;
        let radius = this.radius;
        let geoData = this.geoData;
        let options = this.options;
        let scale = this.scale;
        let extremum = this.rectExtremum;
        this.minValue = 0;
        this.maxValue = 5;

        this.width = Cesium.Cartesian3.distance(
            Cesium.Cartesian3.fromDegrees(...self.rectExtremum[0]),
            Cesium.Cartesian3.fromDegrees(
                self.rectExtremum[1][0],
                self.rectExtremum[0][1]
            )
        );
        this.height = Cesium.Cartesian3.distance(
            Cesium.Cartesian3.fromDegrees(...self.rectExtremum[0]),
            Cesium.Cartesian3.fromDegrees(
                self.rectExtremum[0][0],
                self.rectExtremum[1][1]
            )
        );
        let area = this.height * this.width;
        let _w = Math.sqrt(area);
        this.scale = (this.scale || 500) / _w;

        const data = this.getDataPoints(geoData);
        const container = document.createElement("div");
        container.style.width = `${self.width * this.scale}px`;
        container.style.height = `${self.height * this.scale}px`;
        document.body.appendChild(container);
        const instance = h337.create({
            container,
            radius,
            ...options,
        });
        this.heatmapInstance = instance;
        container.style.position = "fixed";
        document.body.removeChild(container);
        console.log(this.getDataPoints(this.geoData) )
        this.heatmapInstance.setData({ max: this.maxValue, min: this.minValue, data: this.getDataPoints(this.geoData) });

        const material = new Cesium.Material({
            fabric: {
                type: "Image",
                uniforms: {
                    image: instance.getDataURL(),
                },
            },
        });

        const appearance = new Cesium.MaterialAppearance({
            flat: true,
            material: material,
            vertexShaderSource: `
    #version 300 es
    // Use 'in' for vertex shader inputs in WebGL 2.0
    in vec3 position3DHigh;
    in vec3 position3DLow;
    in vec3 normal;
    in vec2 st;
    in float batchId;

    // Use 'out' for vertex shader outputs in WebGL 2.0
    out vec3 v_positionEC;
    out vec3 v_normalEC;
    out vec2 v_st;

    void main(){
        // Compute position from Cesium's helper function
        vec4 p = czm_computePosition();

        // Apply normal-based offset
        p = vec4(p.xyz + normal * 5.0, 0.5);

        // Compute eye space position and normal
        v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
        v_normalEC = czm_normal * normal;

        // Pass texture coordinates to fragment shader
        v_st = st;

        // Transform position into clip space
        gl_Position = czm_modelViewProjectionRelativeToEye * p;
    }
`,
            fragmentShaderSource: `
    #version 300 es
    precision highp float;
    
    // 'in' for receiving inputs from the vertex shader
    in vec2 v_st;
    
    // Uniform declaration in the fragment shader

    // 'out' for fragment shader output
    out vec4 fragColor;

    void main() {
        // Fetch texture color
        vec4 color = texture(image_0, v_st);  // 'texture' instead of 'texture2D' in WebGL 2.0

        // Handle missing data (color is set to blue if missing)
        if (color.r == 0.0 && color.g == 0.0 && color.b < 1.0) {
            fragColor = vec4(0.0, 0.0, 1.0, 0.5);  // Blue for missing data
        } else {
            fragColor = vec4(color.r, color.g, color.b, 0.8);  // Standard color
        }
    }
`
        });

        let geometryInstances;

        geometryInstances = new Cesium.GeometryInstance({
            geometry: new Cesium.RectangleGeometry({
                rectangle: Cesium.Rectangle.fromDegrees(
                    ...self.rectExtremum[0],
                    ...self.rectExtremum[1]
                ),
                granularity: Cesium.Math.toRadians(0.001),
                vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
            }),
        });

        this.primitive = this.viewer.scene.primitives.add(
            new Cesium.Primitive({
                geometryInstances,
                appearance: appearance,
            })
        );
    }

    getDataPoints(data) {
        let self = this;
        const west = self.rectExtremum[0][0];
        const east = self.rectExtremum[1][0];
        const north = self.rectExtremum[1][1];
        const south = self.rectExtremum[0][1];

        return data.map((cartesian) => {
            // Convert Cartesian3 to Cartographic (lat, lon)
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);

            // Calculate position in the 2D grid
            let leftLon = lon - west;
            let topLat = north - lat;
            let left = (leftLon / (east - west)) * self.width * this.scale;
            let top = (topLat / (north - south)) * self.height * this.scale;

            return {
                x: Math.ceil(left),
                y: Math.ceil(top),
                value: 1,  // You can modify the value based on density if needed
            };
        });
    }


    // update(frameState) {
    //
    // }

    update(frameState) {
        if (this.destroyed) return;

        console.log(this.positions)
        // 경로 데이터가 충분한지 확인
        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족합니다.");
            return;
        }

        // 현재 진행 상태가 끝에 도달했을 경우
        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex++; // 다음 위치로 이동

            // 경로 데이터의 끝에 도달했을 경우, 처음으로 돌아가도록 처리
            if (this.currentIndex >= this.positions.length - 1) {
                this.currentIndex = 0;
            }
        } else {
            let startPositionArray = this.positions[this.currentIndex]; // Cartesian3 배열
            let endPositionArray = this.positions[this.currentIndex + 1];

            if (!startPositionArray || !endPositionArray) {
                return;
            }

            console.log(endPositionArray);

            // 보간할 진행 상태(progress)를 업데이트
            this.progress += 0.01; // 0.01씩 진행
            if (this.progress > 1) this.progress = 1;

            // 각 Cartesian3 요소에 대해 보간 수행
            let interpolatedPositions = startPositionArray.map((startPosition, i) => {
                let endPosition = endPositionArray[i];
                if (!endPosition) return startPosition;

                let interpolated = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(startPosition, endPosition, this.progress, interpolated);
                return interpolated;
            });

            // Float32Array로 변환
            let positionsArray = [];
            for (let i = 0; i < interpolatedPositions.length; i++) {
                positionsArray[i] = new Cartesian3(interpolatedPositions[i].x, interpolatedPositions[i].y, interpolatedPositions[i].z);
            }

            const data = this.getDataPoints(positionsArray);
            // console.log(data.length)
            // console.log(this.maxValue)
            // console.log(this.heatmapInstance)
            console.log(this.heatmapInstance.getData())
            const newData = {data:data}
            //this.heatmapInstance.setData(newData);
        }
    }

    getBoundingBox(geoData) {
        let lonMax = -1000,
            lonMin = 1000,
            latMax = -1000,
            latMin = 1000;

        geoData.forEach((item) => {
            // Convert Cartesian3 to Cartographic (lat, lon)
            const cartographic = Cesium.Cartographic.fromCartesian(item);

            // Convert radians to degrees
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);

            lonMax = lonMax > lon ? lonMax : lon;
            lonMin = lonMin < lon ? lonMin : lon;
            latMax = latMax > lat ? latMax : lat;
            latMin = latMin < lat ? latMin : lat;
        });

        return [
            [lonMin, latMin],
            [lonMax, latMax],
        ];
    }


    destroy() {
        this.primitive && this.viewer.scene.primitives.remove(this.primitive);
        this.viewer = undefined;
        this.primitive = null;
    }

    remove() {
        this.destroy();
    }

    getValueAt(longitude, latitude) {
        const minLon = this.rectExtremum[0][0];
        const maxLon = this.rectExtremum[1][0];
        const minLat = this.rectExtremum[0][1];
        const maxLat = this.rectExtremum[1][1];
        const renderer = this.heatmapInstance._renderer;
        const canvasWidth = renderer.canvas.width;
        const canvasHeight = renderer.canvas.height;
        const x = ((longitude - minLon) / (maxLon - minLon)) * canvasWidth;
        const y = canvasHeight - ((latitude - minLat) / (maxLat - minLat)) * canvasHeight;
        var img = renderer.shadowCtx.getImageData(x, y, 1, 1);
        var data = img.data[3];
        const min = renderer._min, max = renderer._max;
        return Math.abs(max - min) * (data / 255);
    }
}

export default HeatMapBend;
