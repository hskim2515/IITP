import * as Cesium from "cesium";

class heatMapBend {
    constructor(
        viewer,
        geoData = [],
        boundary,
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
        this.geoData = geoData;
        this.boundary = boundary;
        this.viewer = viewer;
        this.radius = radius;
        this.scale = scale;
        this.heightMultiplier = heightMultiplier;
        this.options = options;
        this.heatmapInstance = null
        self.init();
    }

    init() {
        let self = this;
        let radius = this.radius;
        let geoData = this.geoData;
        let options = this.options;
        let scale = this.scale;
        let extremum = getExtremum(geoData);
        this.rectExtremum = extremum.rectExtremum;
        this.minValue = extremum.min;
        this.maxValue = extremum.max;
        this.width = Cesium.Cartesian3.distance(
            Cesium.Cartesian3.fromDegrees(...self.rectExtremum[0]),
            Cesium.Cartesian3.fromDegrees(
                self.rectExtremum[1][0],
                self.rectExtremum[0][1]
            )
        );
        if (this.minValue == this.maxValue) {
            this.maxValue = this.minValue + 1;
        }
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
        this.heatmapInstance = instance
        container.style.position = "fixed";
        document.body.removeChild(container);
        instance.setData({ max: this.maxValue, min: this.minValue, data: data });

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
        #extension GL_OES_standard_derivatives : enable
        attribute vec3 position3DHigh;
        attribute vec3 position3DLow;
        attribute vec3 normal;
        attribute vec2 st;
        attribute float batchId;
    
        varying vec3 v_positionEC;
        varying vec3 v_normalEC;
        varying vec2 v_st;
    
        uniform sampler2D image_0;
    
        void main(){
          vec4 p = czm_computePosition();
          vec4 color = texture2D(image_0, st);
          p = vec4(p.xyz + normal * color.a * 5.0 * ${this.heightMultiplier.toFixed(1)}, 0.5);
          v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
          v_normalEC = czm_normal * normal;
          v_st = st;
    
          gl_Position = czm_modelViewProjectionRelativeToEye * p;
        }
      `,
            fragmentShaderSource: `
        varying vec2 v_st;
        void main() {
          vec4 color = texture2D(image_0, v_st);
          if(color.r == 0.0 && color.g == 0.0 && color.b < 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 1.0, 0.5);
          }
          else {
            gl_FragColor = vec4(color.r, color.g, color.b, 0.8);
          } 
        }
      `
        });

        let geometryInstances

        if(!this.boundary && Array.isArray(this.boundary) && this.boundary.length) {
            geometryInstances = new Cesium.GeometryInstance({
                geometry: new Cesium.RectangleGeometry({
                    rectangle: Cesium.Rectangle.fromDegrees(
                        ...self.rectExtremum[0],
                        ...self.rectExtremum[1]
                    ),
                    granularity: Cesium.Math.toRadians(0.001),
                    vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
                }),
            })
        } else {
            geometryInstances = this.boundary.map(item => {
                return new Cesium.GeometryInstance({
                    geometry: new Cesium.PolygonGeometry({
                        polygonHierarchy: new Cesium.PolygonHierarchy(item),
                        granularity: Cesium.Math.toRadians(0.001),
                        vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
                    })
                })
            })
        }

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
        return data.map(({ lon, lat, value }) => {
            let leftLon = lon - west;
            let topLat = north - lat;
            let left = (leftLon / (east - west)) * self.width * this.scale;
            let top = (topLat / (north - south)) * self.height * this.scale;
            return {
                x: Math.ceil(left),
                y: Math.ceil(top),
                value,
            };
        });
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
        const minLon = this.rectExtremum[0][0] ; // 最小经度
        const maxLon = this.rectExtremum[1][0];  // 最大经度
        const minLat = this.rectExtremum[0][1];  // 最小纬度
        const maxLat = this.rectExtremum[1][1];   // 最大纬度
        const renderer = this.heatmapInstance._renderer
        const canvasWidth = renderer.canvas.width;
        const canvasHeight = renderer.canvas.height;
        const x = ((longitude - minLon) / (maxLon - minLon)) * canvasWidth;
        const y = canvasHeight - ((latitude - minLat) / (maxLat - minLat)) * canvasHeight;
        var img = renderer.shadowCtx.getImageData(x, y, 1, 1);
        var data = img.data[3];
        const min = renderer._min, max = renderer._max
        return Math.abs(max-min) * (data/255)
    }
}
const getExtremum = (geoData) => {
    let lonMax = -1000,
        lonMin = 1000,
        latMax = -1000,
        latMin = 1000,
        valueMax = 0,
        valueMin = 0;
    if (!geoData || geoData.length == 0) return [];
    geoData.map((item) => {
        lonMax = lonMax > parseFloat(item.lon) ? lonMax : parseFloat(item.lon);
        lonMin = lonMin < parseFloat(item.lon) ? lonMin : parseFloat(item.lon);
        latMax = latMax > parseFloat(item.lat) ? latMax : parseFloat(item.lat);
        latMin = latMin < parseFloat(item.lat) ? latMin : parseFloat(item.lat);
        valueMax = valueMax > item.value ? valueMax : item.value;
        valueMin = valueMin < item.value ? valueMin : item.value;
    });
    return {
        rectExtremum: [
            [lonMin, latMin],
            [lonMax, latMax],
        ],
        min: valueMin,
        max: valueMax,
    };
};

export default heatMapBend;