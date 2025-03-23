import * as  Cesium from 'cesium';
import { clamp } from '@/utils/utils'
import fragmentShader_calculateSpeed from './glsl/calculateSpeed.frag?raw';
import fragmentShader_calculateSpeed_kas from './glsl/calculateSpeed_kas.frag?raw';
import fragmentShader_updatePosition from './glsl/updatePosition.frag?raw';
import fragmentShader_postProcessingPosition from './glsl/postProcessingPosition.frag?raw';
import fragmentShader_postProcessingPosition_kas from './glsl/postProcessingPosition_kas.frag?raw';
import fragmentShader_screenDraw from './glsl/screenDraw.frag?raw';
import fragmentShader_segmentDraw from './glsl/segmentDraw.frag?raw';
import fragmentShader_trailDraw from './glsl/trailDraw.frag?raw';

import vertexShader_segmentDraw from './glsl/segmentDraw.vert?raw';
import vertexShader_fullscreen from './glsl/fullscreen.vert?raw';


const createTexture = (options, typedArray) => {
    // console.log('createTexture', options, typedArray)
    if (Cesium.defined(typedArray)) {
        // typed array needs to be passed as source option, this is required by Cesium.Texture
        var source = {};
        source.arrayBufferView = typedArray;
        options.source = source;
    }

    var texture = new Cesium.Texture(options);
    return texture;
}

const getFullscreenQuad = () => {
    var fullscreenQuad = new Cesium.Geometry({
        attributes: new Cesium.GeometryAttributes({
            position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.FLOAT,
                componentsPerAttribute: 3,
                //  v3----v2
                //  |     |
                //  |     |
                //  v0----v1
                values: new Float32Array([
                    -1, -1, 0, // v0
                    1, -1, 0, // v1
                    1, 1, 0, // v2
                    -1, 1, 0, // v3
                ])
            }),
            st: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.FLOAT,
                componentsPerAttribute: 2,
                values: new Float32Array([
                    0, 0,
                    1, 0,
                    1, 1,
                    0, 1,
                ])
            })
        }),
        indices: new Uint32Array([3, 2, 0, 0, 2, 1])
    });
    return fullscreenQuad;
}

const createFramebuffer = (context, colorTexture, depthTexture) => {
    var framebuffer = new Cesium.Framebuffer({
        context: context,
        colorTextures: [colorTexture],
        depthTexture: depthTexture
    });
    return framebuffer;
}

const createRawRenderState = (options) => {
    var translucent = true;
    var closed = false;
    var existing = {
        viewport: options.viewport,
        depthTest: options.depthTest,
        depthMask: options.depthMask,
        blending: options.blending
    };

    var rawRenderState = Cesium.Appearance.getDefaultRenderState(translucent, closed, existing);
    return rawRenderState;
}

const randomizeParticles = (maxParticles, rRange, gRange, bRange) => {
    var array = new Float32Array(4 * maxParticles);
    for (var i = 0; i < maxParticles; i++) {
        array[4 * i] = Cesium.Math.randomBetween(rRange[0], rRange[1]);
        array[4 * i + 1] = Cesium.Math.randomBetween(gRange[0], gRange[1]);
        array[4 * i + 2] = Cesium.Math.randomBetween(bRange[0], bRange[1]);
        array[4 * i + 3] = 0.0;
    }
    return array;
}


export class CustomPrimitive {
    constructor(options) {
        this.commandType = options.commandType;

        this.geometry = options.geometry;
        this.attributeLocations = options.attributeLocations;
        this.primitiveType = options.primitiveType;

        this.uniformMap = options.uniformMap;

        this.vertexShaderSource = options.vertexShaderSource;
        this.fragmentShaderSource = options.fragmentShaderSource;

        this.rawRenderState = options.rawRenderState;
        this.framebuffer = options.framebuffer;

        this.outputTexture = options.outputTexture;

        this.autoClear = Cesium.defaultValue(options.autoClear, false);
        this.preExecute = options.preExecute;

        this.show = true;
        this.commandToExecute = undefined;
        this.clearCommand = undefined;
        if (this.autoClear) {
            this.clearCommand = new Cesium.ClearCommand({
                color: new Cesium.Color(0.0, 0.0, 0.0, 0.0),
                depth: 1.0,
                framebuffer: this.framebuffer,
                pass: Cesium.Pass.OPAQUE
            });
        }
    }

    createCommand(context) {
        switch (this.commandType) {
            case 'Draw': {
                var vertexArray = Cesium.VertexArray.fromGeometry({
                    context: context,
                    geometry: this.geometry,
                    attributeLocations: this.attributeLocations,
                    bufferUsage: Cesium.BufferUsage.STATIC_DRAW,
                });

                var shaderProgram = Cesium.ShaderProgram.fromCache({
                    context: context,
                    attributeLocations: this.attributeLocations,
                    vertexShaderSource: this.vertexShaderSource,
                    fragmentShaderSource: this.fragmentShaderSource
                });

                var renderState = Cesium.RenderState.fromCache(this.rawRenderState);
                return new Cesium.DrawCommand({
                    owner: this,
                    vertexArray: vertexArray,
                    primitiveType: this.primitiveType,
                    uniformMap: this.uniformMap,
                    modelMatrix: Cesium.Matrix4.IDENTITY,
                    shaderProgram: shaderProgram,
                    framebuffer: this.framebuffer,
                    renderState: renderState,
                    pass: Cesium.Pass.OPAQUE
                });
            }
            case 'Compute': {
                return new Cesium.ComputeCommand({
                    owner: this,
                    fragmentShaderSource: this.fragmentShaderSource,
                    uniformMap: this.uniformMap,
                    outputTexture: this.outputTexture,
                    persists: true
                });
            }
        }
    }

    setGeometry(context, geometry) {
        this.geometry = geometry;
        var vertexArray = Cesium.VertexArray.fromGeometry({
            context: context,
            geometry: this.geometry,
            attributeLocations: this.attributeLocations,
            bufferUsage: Cesium.BufferUsage.STATIC_DRAW,
        });
        this.commandToExecute.vertexArray = vertexArray;
    }

    update(frameState) {
        if (!this.show) {
            return;
        }

        if (!Cesium.defined(this.commandToExecute)) {
            this.commandToExecute = this.createCommand(frameState.context);
        }

        if (Cesium.defined(this.preExecute)) {
            this.preExecute();
        }

        if (Cesium.defined(this.clearCommand)) {
            frameState.commandList.push(this.clearCommand);
        }
        frameState.commandList.push(this.commandToExecute);
    }

    isDestroyed() {
        return false;
    }

    destroy() {
        if (Cesium.defined(this.commandToExecute)) {
            this.commandToExecute.shaderProgram = this.commandToExecute.shaderProgram && this.commandToExecute.shaderProgram.destroy();
        }
        return Cesium.destroyObject(this);
    }
}
export default class ParticleSystem {
    constructor(context, data, options, viewerParameters, colorTextures, isKas) {
        this.context = context;
        this.data = data;
        this.options = options;
        this.viewerParameters = viewerParameters;
        this.colorTextures = colorTextures;
        this.isKas = isKas;

        this.particlesComputing = new ParticlesComputing(this);
        this.particlesRendering = new ParticlesRendering(this, this.particlesComputing);

        const primitiveCollection = new Cesium.PrimitiveCollection({
            asynchronous: false,
        });

        primitiveCollection.add(this.particlesComputing.primitives.calculateSpeed);
        primitiveCollection.add(this.particlesComputing.primitives.updatePosition);
        primitiveCollection.add(this.particlesComputing.primitives.postProcessingPosition);

        primitiveCollection.add(this.particlesRendering.primitives.segments);
        primitiveCollection.add(this.particlesRendering.primitives.trails);
        primitiveCollection.add(this.particlesRendering.primitives.screen);

        primitiveCollection.originalData = data;

        this.primitiveCollection = primitiveCollection;
    }

    clearFramebuffers() {
        var clearCommand = new Cesium.ClearCommand({
            color: new Cesium.Color(0.0, 0.0, 0.0, 0.0),
            depth: 1.0,
            framebuffer: undefined,
            pass: Cesium.Pass.OPAQUE
        });

        Object.keys(this.particlesRendering.framebuffers).forEach((key) => {
            clearCommand.framebuffer = this.particlesRendering.framebuffers[key];
            clearCommand.execute(this.context);
        });
    }

    refreshParticles(maxParticlesChanged) {

        this.particlesComputing.destroyParticlesTextures();
        this.particlesComputing.createParticlesTextures(this.context, this.data, this.options, this.viewerParameters);

    }

}
export class ParticlesComputing {
    constructor(particleSystem) {
        this.particleSystem = particleSystem;

        this.createWindTextures(this.particleSystem.context, this.particleSystem.data);
        this.createParticlesTextures(this.particleSystem.context, this.particleSystem.data, this.particleSystem.options, this.particleSystem.viewerParameters);
        this.createComputingPrimitives(this.particleSystem.data, this.particleSystem.options, this.particleSystem.viewerParameters);
    }

    createWindTextures(context, data) {
        var windTextureOptions = {
            context: context,
            width: data.dimensions.lon,
            height: data.dimensions.lat,
            pixelFormat: Cesium.PixelFormat.RED,        // 이게 답이다. LUMINANCE 하면 버퍼크기 안맞음. 어차피 셰이더에서도 .r만 사용
            pixelDatatype: Cesium.PixelDatatype.FLOAT,
            flipY: false,
            sampler: new Cesium.Sampler({
                // the values of texture will not be interpolated
                minificationFilter: Cesium.TextureMinificationFilter.NEAREST,       // => LINEAR 로 사용 대체 확인 필요
                magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST      // => LINEAR 로 사용 대체 확인 필요
            })
        };

        // console.log('createWindTextures', windTextureOptions)
        this.windTextures = [
            {
                U: createTexture(windTextureOptions, data.UVW0[0]),
                V: createTexture(windTextureOptions, data.UVW0[1]),
                W: createTexture(windTextureOptions, data.UVW0[2]),
            },
            {
                U: createTexture(windTextureOptions, data.UVW1[0]),
                V: createTexture(windTextureOptions, data.UVW1[1]),
                W: createTexture(windTextureOptions, data.UVW1[2]),
            },
            {
                U: createTexture(windTextureOptions, data.UVW2[0]),
                V: createTexture(windTextureOptions, data.UVW2[1]),
                W: createTexture(windTextureOptions, data.UVW2[2]),
            }
        ];
    }

    createParticlesTextures(context, data, options, viewerParameters) {
        var particlesTextureOptions = {
            context: context,
            width: options.particlesTextureSize,
            height: options.particlesTextureSize,
            pixelFormat: Cesium.PixelFormat.RGBA,
            pixelDatatype: Cesium.PixelDatatype.FLOAT,
            flipY: false,
            sampler: new Cesium.Sampler({
                // the values of texture will not be interpolated
                minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
                magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST
            })
        };

        var particlesArray = randomizeParticles(options.maxParticles, data.boundary.lon, data.boundary.lat, data.boundary.lev)
        var zeroArray = new Float32Array(4 * options.maxParticles).fill(0);

        const midAlt = (data.boundary.lev[0] + data.boundary.lev[1]) / 2;
        var centerAltArray = this.particleSystem.isKas ? new Float32Array(4 * options.maxParticles).fill(0) : randomizeParticles(options.maxParticles, data.boundary.lon, data.boundary.lat, [midAlt, midAlt])

        this.particlesTextures = {
            previousParticlesPosition: createTexture(particlesTextureOptions, centerAltArray),     // 랜덤으로 생성
            currentParticlesPosition: createTexture(particlesTextureOptions, centerAltArray),     // 랜덤으로 생성
            nextParticlesPosition: createTexture(particlesTextureOptions, centerAltArray),     // 랜덤으로 생성
            postProcessingPosition: createTexture(particlesTextureOptions, centerAltArray),     // 랜덤으로 생성

            particlesSpeed: createTexture(particlesTextureOptions, zeroArray)      // 제로로 생성
        };
    }

    destroyParticlesTextures() {
        Object.keys(this.particlesTextures).forEach((key) => {
            this.particlesTextures[key].destroy();
        });
    }

    createComputingPrimitives(data, options, viewerParameters) {
        const that = this;

        this.primitives = {
            calculateSpeed: new CustomPrimitive({
                commandType: 'Compute',
                uniformMap: {
                    U0: function () {
                        return that.windTextures[0].U;
                    },
                    V0: function () {
                        return that.windTextures[0].V;
                    },
                    W0: function () {
                        return that.windTextures[0].W;
                    },
                    U1: function () {
                        return that.windTextures[1].U;
                    },
                    V1: function () {
                        return that.windTextures[1].V;
                    },
                    W1: function () {
                        return that.windTextures[1].W;
                    },
                    U2: function () {
                        return that.windTextures[2].U;
                    },
                    V2: function () {
                        return that.windTextures[2].V;
                    },
                    W2: function () {
                        return that.windTextures[2].W;
                    },
                    altitudesOfLevel: function () {
                        return that.particleSystem.data.altitudesOfLevel;
                    },
                    currentParticlesPosition: function () {
                        return that.particlesTextures.currentParticlesPosition;
                    },
                    dimension: function () {
                        const data = that.particleSystem.data;
                        return new Cesium.Cartesian3(data.dimensions.lon, data.dimensions.lat, data.dimensions.lev);
                    },
                    minimum: function () {
                        const data = that.particleSystem.data;
                        const minimum = new Cesium.Cartesian3(data.boundary.lon[0], data.boundary.lat[0], data.boundary.lev[0]);
                        return minimum;
                    },
                    maximum: function () {
                        const data = that.particleSystem.data;
                        const maximum = new Cesium.Cartesian3(data.boundary.lon[1], data.boundary.lat[1], data.boundary.lev[1]);
                        return maximum;
                    },
                    interval: function () {
                        const data = that.particleSystem.data;
                        const dimension = new Cesium.Cartesian3(data.dimensions.lon, data.dimensions.lat, data.dimensions.lev);
                        const minimum = new Cesium.Cartesian3(data.boundary.lon[0], data.boundary.lat[0], data.boundary.lev[0]);
                        const maximum = new Cesium.Cartesian3(data.boundary.lon[1], data.boundary.lat[1], data.boundary.lev[1]);
                        const interval = new Cesium.Cartesian3(
                            (maximum.x - minimum.x) / (dimension.x - 1),
                            (maximum.y - minimum.y) / (dimension.y - 1),
                            (maximum.z - minimum.z) / (dimension.z - 1),
                        );
                        return interval;
                    },
                    uSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const uSpeedRange = new Cesium.Cartesian2(data.valueRange.U[0], data.valueRange.U[1]);
                        return uSpeedRange;
                    },
                    vSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const vSpeedRange = new Cesium.Cartesian2(data.valueRange.V[0], data.valueRange.V[1]);
                        return vSpeedRange;
                    },
                    wSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const wSpeedRange = new Cesium.Cartesian2(data.valueRange.W[0], data.valueRange.W[1]);
                        return wSpeedRange;
                    },
                    pixelSize: function () {
                        return that.particleSystem.viewerParameters.pixelSize;
                    },
                    speedFactor: function () {
                        return that.particleSystem.options.speedFactor;
                    },
                    cameraPosition: function () {
                        return new Cesium.Cartesian3(
                            that.particleSystem.viewerParameters.cameraPosition.longitude,
                            that.particleSystem.viewerParameters.cameraPosition.latitude,
                            that.particleSystem.viewerParameters.cameraPosition.height
                        );
                    },
                    frameFactor: function () {
                        return that.particleSystem.viewerParameters.frameFactor || 1
                    },
                    verticalSpeedScale: function() {
                        console.log(that.particleSystem.viewerParameters.verticalSpeedScale)
                        return that.particleSystem.viewerParameters.verticalSpeedScale;
                    },
                },
                fragmentShaderSource: new Cesium.ShaderSource({
                    sources: [this.particleSystem.isKas ? fragmentShader_calculateSpeed_kas : fragmentShader_calculateSpeed]
                }),
                outputTexture: this.particlesTextures.particlesSpeed,
                preExecute: function () {
                    // swap textures before binding
                    var temp;
                    temp = that.particlesTextures.previousParticlesPosition;
                    that.particlesTextures.previousParticlesPosition = that.particlesTextures.currentParticlesPosition;
                    that.particlesTextures.currentParticlesPosition = that.particlesTextures.postProcessingPosition;
                    that.particlesTextures.postProcessingPosition = temp;

                    // keep the outputTexture up to date
                    that.primitives.calculateSpeed.commandToExecute.outputTexture = that.particlesTextures.particlesSpeed;
                }
            }),

            updatePosition: new CustomPrimitive({
                commandType: 'Compute',
                uniformMap: {
                    currentParticlesPosition: function () {
                        return that.particlesTextures.currentParticlesPosition;
                    },
                    particlesSpeed: function () {
                        return that.particlesTextures.particlesSpeed;
                    }
                },
                fragmentShaderSource: new Cesium.ShaderSource({
                    sources: [fragmentShader_updatePosition]
                }),
                outputTexture: this.particlesTextures.nextParticlesPosition,
                preExecute: function () {
                    // keep the outputTexture up to date
                    that.primitives.updatePosition.commandToExecute.outputTexture = that.particlesTextures.nextParticlesPosition;
                }
            }),

            postProcessingPosition: new CustomPrimitive({
                commandType: 'Compute',
                uniformMap: {
                    nextParticlesPosition: function () {
                        return that.particlesTextures.nextParticlesPosition;
                    },
                    particlesSpeed: function () {
                        return that.particlesTextures.particlesSpeed;
                    },
                    randomCoefficient: function () {
                        var randomCoefficient = Math.random();
                        return randomCoefficient;
                    },
                    dropRate: function () {
                        return that.particleSystem.options.dropRate;
                    },
                    dropRateBump: function () {
                        return that.particleSystem.options.dropRateBump;
                    },
                    minimum: function () {
                        const data = that.particleSystem.data;
                        const minimum = new Cesium.Cartesian3(data.boundary.lon[0], data.boundary.lat[0], data.boundary.lev[0]);
                        const maximum = new Cesium.Cartesian3(data.boundary.lon[1], data.boundary.lat[1], data.boundary.lev[1]);
                        return new Cesium.Cartesian3(
                            clamp(Math.max(minimum.x, that.particleSystem.viewerParameters.lonRange.x - 0.25), minimum.x, maximum.x),
                            clamp(Math.max(minimum.y, that.particleSystem.viewerParameters.latRange.x - 0.25), minimum.y, maximum.y),
                            minimum.z,//clamp(Math.max(minimum.z, viewerParameters.levRange.x), minimum.z, maximum.z),
                        );
                    },
                    maximum: function () {
                        const data = that.particleSystem.data;
                        const minimum = new Cesium.Cartesian3(data.boundary.lon[0], data.boundary.lat[0], data.boundary.lev[0]);
                        const maximum = new Cesium.Cartesian3(data.boundary.lon[1], data.boundary.lat[1], data.boundary.lev[1]);
                        return new Cesium.Cartesian3(
                            clamp(Math.min(maximum.x, that.particleSystem.viewerParameters.lonRange.y + 0.25), minimum.x, maximum.x),
                            clamp(Math.min(maximum.y, that.particleSystem.viewerParameters.latRange.y + 0.25), minimum.y, maximum.y),
                            maximum.z, //clamp(Math.min(maximum.z, viewerParameters.levRange.y), minimum.z, maximum.z),
                        );
                    },
                    altitudesOfLevel: function () {
                        return that.particleSystem.data.altitudesOfLevel;
                    },
                    clippingPoints: function () {
                        return that.particleSystem.viewerParameters.clippingPoints ?? [new Cesium.Cartesian3(0, 0, 0), new Cesium.Cartesian3(0, 0, 0)];
                    }
                },
                fragmentShaderSource: new Cesium.ShaderSource({
                    sources: [that.particleSystem.isKas ? fragmentShader_postProcessingPosition_kas : fragmentShader_postProcessingPosition]
                }),
                outputTexture: this.particlesTextures.postProcessingPosition,
                preExecute: function () {
                    // keep the outputTexture up to date
                    that.primitives.postProcessingPosition.commandToExecute.outputTexture = that.particlesTextures.postProcessingPosition;
                }
            })
        }
    }

}
export class ParticlesRendering {
    constructor(particleSystem, particlesComputing) {
        this.particleSystem = particleSystem;
        this.colorTextures = this.particleSystem.colorTextures;
        if (!this.colorTextures || this.colorTextures.length !== 3 || this.colorTextures.some(e => !e)) {
            const emptyTexture = {
                context: this.particleSystem.context,
                width: 1,
                height: 1,
                pixelFormat: Cesium.PixelFormat.RGBA,        // 이게 답이다. LUMINANCE 하면 버퍼크기 안맞음. 어차피 셰이더에서도 .r만 사용
                pixelDatatype: Cesium.PixelDatatype.FLOAT,
                flipY: false,
                sampler: new Cesium.Sampler({
                    // the values of texture will not be interpolated
                    minificationFilter: Cesium.TextureMinificationFilter.NEAREST,       // => LINEAR 로 사용 대체 확인 필요
                    magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST      // => LINEAR 로 사용 대체 확인 필요
                })
            };
            this.colorTextures = [
                createTexture(emptyTexture),
                createTexture(emptyTexture),
                createTexture(emptyTexture),
            ]
        }

        this.createRenderingTextures(this.particleSystem.context, this.particleSystem.data);
        this.createRenderingFramebuffers(this.particleSystem.context);
        this.createRenderingPrimitives(this.particleSystem.context, this.particleSystem.data, this.particleSystem.options, this.particleSystem.viewerParameters, this.particleSystem.particlesComputing);
    }

    createRenderingTextures(context, data) {
        const colorTextureOptions = {
            context: context,
            width: context.drawingBufferWidth,
            height: context.drawingBufferHeight,
            pixelFormat: Cesium.PixelFormat.RGBA,
            pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE
        };
        const depthTextureOptions = {
            context: context,
            width: context.drawingBufferWidth,
            height: context.drawingBufferHeight,
            pixelFormat: Cesium.PixelFormat.DEPTH_COMPONENT,
            pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT
        };

        this.textures = {
            segmentsColor: createTexture(colorTextureOptions),
            segmentsDepth: createTexture(depthTextureOptions),

            currentTrailsColor: createTexture(colorTextureOptions),
            currentTrailsDepth: createTexture(depthTextureOptions),

            nextTrailsColor: createTexture(colorTextureOptions),
            nextTrailsDepth: createTexture(depthTextureOptions),
        };
    }

    createRenderingFramebuffers(context) {
        this.framebuffers = {
            segments: createFramebuffer(context, this.textures.segmentsColor, this.textures.segmentsDepth),
            currentTrails: createFramebuffer(context, this.textures.currentTrailsColor, this.textures.currentTrailsDepth),
            nextTrails: createFramebuffer(context, this.textures.nextTrailsColor, this.textures.nextTrailsDepth)
        }
    }

    createSegmentsGeometry(options) {
        const repeatVertex = 6;

        var st = [];
        for (var s = 0; s < options.particlesTextureSize; s++) {
            for (var t = 0; t < options.particlesTextureSize; t++) {
                for (var i = 0; i < repeatVertex; i++) {
                    st.push(s / options.particlesTextureSize);
                    st.push(t / options.particlesTextureSize);
                }
            }
        }
        st = new Float32Array(st);

        var normal = [];
        const pointToUse = [-1, 0, 1];
        const offsetSign = [-1, 1];
        for (var i = 0; i < options.maxParticles; i++) {
            for (var j = 0; j < pointToUse.length; j++) {
                for (var k = 0; k < offsetSign.length; k++) {
                    normal.push(pointToUse[j]);
                    normal.push(offsetSign[k]);
                    normal.push(0);
                }
            }
        }
        normal = new Float32Array(normal);

        const indexSize = 12 * options.maxParticles;
        var vertexIndexes = new Uint32Array(indexSize);
        for (var i = 0, j = 0, vertex = 0; i < options.maxParticles; i++) {
            vertexIndexes[j++] = vertex + 0;
            vertexIndexes[j++] = vertex + 1;
            vertexIndexes[j++] = vertex + 2;

            vertexIndexes[j++] = vertex + 2;
            vertexIndexes[j++] = vertex + 1;
            vertexIndexes[j++] = vertex + 3;

            vertexIndexes[j++] = vertex + 2;
            vertexIndexes[j++] = vertex + 4;
            vertexIndexes[j++] = vertex + 3;

            vertexIndexes[j++] = vertex + 4;
            vertexIndexes[j++] = vertex + 3;
            vertexIndexes[j++] = vertex + 5;

            vertex += repeatVertex;
        }

        var geometry = new Cesium.Geometry({
            attributes: new Cesium.GeometryAttributes({
                st: new Cesium.GeometryAttribute({
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                    componentsPerAttribute: 2,
                    values: st
                }),
                normal: new Cesium.GeometryAttribute({
                    componentDatatype: Cesium.ComponentDatatype.FLOAT,
                    componentsPerAttribute: 3,
                    values: normal
                }),
            }),
            indices: vertexIndexes
        });

        return geometry;
    }

    createRenderingPrimitives(context, data, options, viewerParameters, particlesComputing) {
        const that = this;
        this.primitives = {
            segments: new CustomPrimitive({
                commandType: 'Draw',
                attributeLocations: {
                    st: 0,
                    normal: 1
                },
                geometry: this.createSegmentsGeometry(options),
                primitiveType: Cesium.PrimitiveType.TRIANGLES,
                uniformMap: {
                    previousParticlesPosition: function () {
                        return particlesComputing.particlesTextures.previousParticlesPosition;
                    },
                    currentParticlesPosition: function () {
                        return particlesComputing.particlesTextures.currentParticlesPosition;
                    },
                    postProcessingPosition: function () {
                        return particlesComputing.particlesTextures.postProcessingPosition;
                    },
                    aspect: function () {
                        return context.drawingBufferWidth / context.drawingBufferHeight;
                    },
                    pixelSize: function () {
                        return that.particleSystem.viewerParameters.pixelSize;
                    },
                    lineWidth: function () {
                        return that.particleSystem.options.lineWidth;
                    },
                    uSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const uSpeedRange = new Cesium.Cartesian2(data.valueRange.U[0], data.valueRange.U[1]);
                        return uSpeedRange;
                    },
                    vSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const vSpeedRange = new Cesium.Cartesian2(data.valueRange.V[0], data.valueRange.V[1]);
                        return vSpeedRange;
                    },
                    wSpeedRange: function () {
                        const data = that.particleSystem.data;
                        const wSpeedRange = new Cesium.Cartesian2(data.valueRange.W[0], data.valueRange.W[1]);
                        return wSpeedRange;
                    },
                    particlesSpeed: function () {
                        return particlesComputing.particlesTextures.particlesSpeed;
                    },
                    minimum: function () {
                        const data = that.particleSystem.data;
                        const minimum = new Cesium.Cartesian3(data.boundary.lon[0], data.boundary.lat[0], data.boundary.lev[0]);        // lla boundary
                        return minimum;
                    },
                    maximum: function () {
                        const data = that.particleSystem.data;
                        const maximum = new Cesium.Cartesian3(data.boundary.lon[1], data.boundary.lat[1], data.boundary.lev[1]);        // lla boudnary
                        return maximum;
                    },
                    verticalScale: function () {
                        return that.particleSystem.viewerParameters.verticalScale ?? 1.0;
                    },
                    colorMode: function () {
                        // 0.0 == speed 기반 색상, 0.0 아닌 값 == altitude 기반 색상
                        return (that.particleSystem.viewerParameters.colorMode == 'windspeed') ? 0 :
                            (that.particleSystem.viewerParameters.colorMode == 'altitude') ? 1 :
                                2;
                    },
                    colors: function () {
                        return that.colorTextures;
                    }
                    // particleHeight: function () {
                    //     return options.particleHeight;
                    // }
                },
                vertexShaderSource: new Cesium.ShaderSource({
                    sources: [vertexShader_segmentDraw]
                }),
                fragmentShaderSource: new Cesium.ShaderSource({
                    sources: [fragmentShader_segmentDraw]
                }),
                rawRenderState: createRawRenderState({
                    // undefined value means let Cesium deal with it
                    viewport: undefined,
                    depthTest: {
                        enabled: true
                    },
                    depthMask: true
                }),
                framebuffer: this.framebuffers.segments,
                autoClear: true
            }),

            trails: new CustomPrimitive({
                commandType: 'Draw',
                attributeLocations: {
                    position: 0,
                    st: 1
                },
                geometry: getFullscreenQuad(),
                primitiveType: Cesium.PrimitiveType.TRIANGLES,
                uniformMap: {
                    segmentsColorTexture: function () {
                        return that.textures.segmentsColor;
                    },
                    segmentsDepthTexture: function () {
                        return that.textures.segmentsDepth;
                    },
                    currentTrailsColor: function () {
                        return that.framebuffers.currentTrails.getColorTexture(0);
                    },
                    trailsDepthTexture: function () {
                        return that.framebuffers.currentTrails.depthTexture;
                    },
                    fadeOpacity: function () {
                        return that.particleSystem.options.fadeOpacity;
                    }
                },
                // prevent Cesium from writing depth because the depth here should be written manually
                vertexShaderSource: new Cesium.ShaderSource({
                    defines: ['DISABLE_GL_POSITION_LOG_DEPTH'],
                    sources: [vertexShader_fullscreen]
                }),
                fragmentShaderSource: new Cesium.ShaderSource({
                    defines: ['DISABLE_LOG_DEPTH_FRAGMENT_WRITE'],
                    sources: [fragmentShader_trailDraw]
                }),
                rawRenderState: createRawRenderState({
                    viewport: undefined,
                    depthTest: {
                        enabled: true,
                        func: Cesium.DepthFunction.ALWAYS // always pass depth test for full control of depth information
                    },
                    depthMask: true
                }),
                framebuffer: this.framebuffers.nextTrails,
                autoClear: true,
                preExecute: function () {
                    // swap framebuffers before binding
                    var temp;
                    temp = that.framebuffers.currentTrails;
                    that.framebuffers.currentTrails = that.framebuffers.nextTrails;
                    that.framebuffers.nextTrails = temp;

                    // keep the framebuffers up to date
                    that.primitives.trails.commandToExecute.framebuffer = that.framebuffers.nextTrails;
                    that.primitives.trails.clearCommand.framebuffer = that.framebuffers.nextTrails;
                }
            }),

            screen: new CustomPrimitive({
                commandType: 'Draw',
                attributeLocations: {
                    position: 0,
                    st: 1
                },
                geometry: getFullscreenQuad(),
                primitiveType: Cesium.PrimitiveType.TRIANGLES,
                uniformMap: {
                    trailsColorTexture: function () {
                        return that.framebuffers.nextTrails.getColorTexture(0);
                    },
                    trailsDepthTexture: function () {
                        return that.framebuffers.nextTrails.depthTexture;
                    }
                },
                // prevent Cesium from writing depth because the depth here should be written manually
                vertexShaderSource: new Cesium.ShaderSource({
                    defines: ['DISABLE_GL_POSITION_LOG_DEPTH'],
                    sources: [vertexShader_fullscreen]
                }),
                fragmentShaderSource: new Cesium.ShaderSource({
                    defines: ['DISABLE_LOG_DEPTH_FRAGMENT_WRITE'],
                    sources: [fragmentShader_screenDraw]
                }),
                rawRenderState: createRawRenderState({
                    viewport: undefined,
                    depthTest: {
                        enabled: true
                    },
                    depthMask: false,
                    blending: {
                        enabled: true,
                    }
                }),
                framebuffer: undefined // undefined value means let Cesium deal with it
            })
        };
    }
}
