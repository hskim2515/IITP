import {useEffect, useRef, useState} from 'react';
import {useCesiumStore} from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import {Cartesian3, HeightReference, Viewer} from "cesium";
import PrimitiveLayerManager from "../managers/PrimitiveLayerManager";
import {useLayerStore} from "@stores/useLayerStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {useLayerSchemaStore} from "@stores/useLayerSchemaStore";
import {Map as OLMap, View} from "ol";
import * as olProj from "ol/proj";
import {LayerManager} from "../managers/LayerManager";
import BaseMapLayerManager from "../managers/BaseMapLayerManager";
import VectorLayerManager from "../managers/VectorLayerManager";
import TileLayerManager from "../managers/TileLayerManager";
import {useSimulationStore} from "@stores/useSimulationStore";
import {usePropertyStore} from "@stores/usePropertyStore";
import cesium from "vite-plugin-cesium";
import {useEventStore} from "@stores/useEventStore";


type Node = { id: string; x?: number; y?: number; lng?: number; lat?: number };
type Link = { source: string; target: string };


const useMapInit = (openlayersMapRef, cesiumMapRef) => {

    const setMap = useOpenLayersStore.actions.setMap();
    const setView = useOpenLayersStore.actions.setView();

    const setViewer = useCesiumStore((state) => state.setViewer);
    const setLayerManager = useLayerStore((state) => state.setLayerManager);
    const lodLevels = [1.0, 0.5, 0.2];

    const layerGroups = useLayerSchemaStore.state.groups();

    const setActiveLayerGroupName = useLayerStore.actions.setActiveLayerGroupName()
    const setActiveLayerName = useLayerStore.actions.setActiveLayerName()

    const setProperty = usePropertyStore((state) => state.setProperty);


    const [lodModels, setLodModels] = useState(null);

    //const lodWorker = new Worker(new URL('/src/workers/lodWorker.ts', import.meta.url), { type: 'module' });

    useEffect(() => {
        if(!cesiumMapRef.current) return;
        if (layerGroups.length === 0) return;
        initializeMaps().then(() => console.log("initializeMaps"));
    }, [layerGroups, cesiumMapRef.current]);

    const initializeMaps = async () => {
        const { olMap } = openLayersMapInit();
        const { cesiumViewer } = await cesiumMapInit();

        const vectorLayerManager = new VectorLayerManager(olMap, useLayerStore)
        const tileLayerManager = new TileLayerManager(olMap)

        const primitiveLayerManager = new PrimitiveLayerManager(cesiumViewer, useLayerStore);
        const basemapLayerManager = new BaseMapLayerManager(cesiumViewer)

        const layerManager = new LayerManager(
            primitiveLayerManager,
            basemapLayerManager,
            cesiumViewer,
            vectorLayerManager,
            tileLayerManager,
            olMap,
            useSimulationStore
        );

        fetch(process.env.VITE_API_URL + "/network", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        })
        .then((response) => {
            return response.json();
        })
        .then(({nodes, links, lanes, cells, segments}) => {

            const nodeIds = new Set(nodes.map(n => n.id));
            const safeLinks = links.filter(link => {
                return nodeIds.has(link.source) && nodeIds.has(link.target);
            });

            const baseLng = 126.7325;
            const baseLat = 37.4928;
            const scale = 0.00001;

            nodes.forEach(node => {
                node.lng = baseLng + (node.xCoord/ 88000);
                node.lat = baseLat + (node.yCoord/ 111000);
            });

            // 링크 그리기
            for (const link of links) {
                const [firstPointStr, lastPointStr] = link.shape.split(" ");
                const [x1, y1] = firstPointStr.split(",").map(parseFloat);
                const [x2, y2] = lastPointStr.split(",").map(parseFloat);

                const source = nodes.find(n => n.id === link.fromNode);
                const target = nodes.find(n => n.id === link.toNode);
                if (!source || !target || !link.lanes) continue;

                // WGS84 좌표 → Cartesian3
                const sourceCart = Cesium.Cartesian3.fromDegrees(baseLng + x1/ 88000, baseLat + y1/ 111000);
                const targetCart = Cesium.Cartesian3.fromDegrees(baseLng + x2/ 88000, baseLat + y2/ 111000);

                // 방향 벡터 계산 (ENU 상)
                const direction = Cesium.Cartesian3.subtract(targetCart, sourceCart, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(direction, direction);

                // 수직 벡터 계산 (ENU 평면에서 Z 제외한 수직 벡터)
                const up = Cesium.Cartesian3.UNIT_Z;
                const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(right, right);

                const laneWidth = link.width / link.lanes.length;


                cesiumViewer.entities.add(new Cesium.Entity({
                    corridor: {
                        cornerType: Cesium.CornerType.MITERED,
                        positions: [sourceCart, targetCart],
                        width: link.width, // 레인별 폭 적용
                        material: new Cesium.ImageMaterialProperty({
                            image: 'road4.jpg',
                            repeat: new Cesium.Cartesian2(1, 1),
                            transparent: true
                        }),
                        height: 0.02,
                    },
                    properties:link
                }));

                const laneCount = link.lanes.length || 2; // 차선 수

                const corridorGeometry = new Cesium.CorridorGeometry({
                    positions: [sourceCart, targetCart],
                    height:0.01,
                    width: link.width - 0.1,
                    vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
                    cornerType: Cesium.CornerType.MITERED,
                });

                const geometryInstance = new Cesium.GeometryInstance({
                    geometry: corridorGeometry,
                    id: 'road-corridor',
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE),
                    }
                });

                const primitive = new Cesium.Primitive({
                    geometryInstances: geometryInstance,
                    appearance: new Cesium.MaterialAppearance({
                        material: new Cesium.Material({
                            fabric: {
                                type: 'CustomRoadMaterial',
                                uniforms: {
                                    baseColor: Cesium.Color.BLACK,
                                    lineColor: Cesium.Color.WHITE,
                                    laneCount: laneCount,
                                    repeat: 50.0,       // 도로 길이 방향 반복 횟수 (줄 수)
                                    dashLength: 0.5,
                                    gapLength: 0.5,

                                },
                                source:
                                `czm_material czm_getMaterial(czm_materialInput materialInput) {
                    czm_material material = czm_getDefaultMaterial(materialInput);

                    vec2 st = materialInput.st;

                    float laneStep = 1.0 / float(laneCount);
                    float stripe = mod(st.t * repeat, dashLength + gapLength) < dashLength ? 1.0 : 0.0;

                    float laneLine = 0.0;
                    for (int i = 1; i < 10; i++) {
                        if (float(i) >= float(laneCount)) break;

                        float center = float(i) * laneStep;
                        float dist = abs(st.t - center);
                        laneLine += step(dist, 0.005) * stripe; // 선 굵기 조정
                    }

                    material.diffuse = mix(baseColor.rgb, lineColor.rgb, laneLine);
                    material.alpha = mix(baseColor.a, lineColor.a, laneLine);

                    return material;
                }
`
            }
            }),
                faceForward: true,
                    closed: false,
            }),
                asynchronous: false,
                    show: true,
            });


                cesiumViewer.scene.primitives.add(primitive);

                for (let i = 0; i < link.lanes.length; i++) {
                    const offset = (i - (link.lanes.length - 1) / 2.0) * laneWidth;

                    // 레인 오프셋 계산 (ENU 기준으로 right 방향으로 offset)
                    const laneOffset = Cesium.Cartesian3.multiplyByScalar(right, offset, new Cesium.Cartesian3());

                    const laneSource = Cesium.Cartesian3.add(sourceCart, laneOffset, new Cesium.Cartesian3());
                    const laneTarget = Cesium.Cartesian3.add(targetCart, laneOffset, new Cesium.Cartesian3());
                    link.lanes[i].laneSource = laneSource
                    link.lanes[i].laneTarget = laneTarget

                }
            }

            for (const node of nodes) {
                // const center = Cesium.Cartesian3.fromDegrees(node.lng, node.lat);

                // === 1. Node 표시 ===
                // cesiumViewer.entities.add({
                //     position: center,
                //     point: {
                //         pixelSize: 8,
                //         color: Cesium.Color.ORANGE
                //     },
                //     // label: {
                //     //     text: node.id,
                //     //     font: '12px sans-serif',
                //     //     scale: 0.6,
                //     //     pixelOffset: new Cesium.Cartesian2(10, -10),
                //     //     showBackground: true,
                //     //     backgroundColor: Cesium.Color.WHITE
                //     // }
                // });
                // const ports = node.ports
                const connections = node.connections

                // if(ports){
                //     // === 2. Port 표시 ===
                //     for (const port of node.ports || []) {
                //         const link = links.find(l => l.id === port.linkId);
                //         if (!link) continue;
                //
                //         const targetNode = port.direction === 'in'
                //             ? nodes.find(n => n.id === link.fromNode)
                //             : nodes.find(n => n.id === link.toNode);
                //
                //         if (!targetNode || !targetNode.lat || !targetNode.lng) continue;
                //
                //         const target = Cesium.Cartesian3.fromDegrees(targetNode.lng, targetNode.lat);
                //
                //         const dir = Cesium.Cartesian3.subtract(target, center, new Cesium.Cartesian3());
                //         const len = Cesium.Cartesian3.magnitude(dir);
                //
                //         if (len === 0 || isNaN(len)) {
                //             // console.warn('Invalid direction vector: zero-length or NaN', { center, target });
                //             continue; // skip this item
                //         }
                //         const portPos = Cesium.Cartesian3.add(center, dir, new Cesium.Cartesian3());
                //
                //         // cesiumViewer.entities.add({
                //         //     position: portPos,
                //         //     point: {
                //         //         pixelSize: 10,
                //         //         heightReference:HeightReference.CLAMP_TO_GROUND,
                //         //         color: port.direction === 'in' ? Cesium.Color.GREEN : Cesium.Color.RED
                //         //     }
                //         // });
                //     }
                // }

                if (connections) {
                    for (const conn of node.connections || []) {
                        const fromLink = links.find(l => l.id === conn.fromLink);
                        const toLink = links.find(l => l.id === conn.toLink);
                        if (!fromLink || !toLink) continue;

                        const fromLaneIdx = parseInt(conn.fromLane);
                        const toLaneIdx = parseInt(conn.toLane);

                        const fromLane = fromLink.lanes[fromLaneIdx];
                        const toLane = toLink.lanes[toLaneIdx];
                        if (!fromLane || !toLane || !fromLane.laneTarget || !toLane.laneSource) continue;

                        // if(conn.turning !== 'S'){
                        //
                        //     const points = [fromLane.laneTarget, center, toLane.laneSource]
                        //
                        //     const spline = new Cesium.CatmullRomSpline({
                        //         times: [0.0, 0.5, 1.0],
                        //         points
                        //     });
                        //
                        //     const curve = [];
                        //     for (let i = 0; i <= 100; i++) {
                        //         curve.push(spline.evaluate(i / 100));
                        //     }
                        //
                        //     cesiumViewer.entities.add({
                        //         polyline: {
                        //             positions: curve,
                        //             width: 2,
                        //             clampToGround: true,
                        //             material: Cesium.Color.PURPLE.withAlpha(0.6)
                        //         }
                        //     });
                        // }

                        cesiumViewer.entities.add({
                            polyline: {
                                positions: [fromLane.laneTarget, toLane.laneSource],
                                width: 5,
                                arcType: Cesium.ArcType.GEODESIC,
                                material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.WHITE.withAlpha(0.8)),
                                clampToGround: true,
                            },
                            //properties : conn
                        });

                        cesiumViewer.entities.add({
                            corridor: {
                                cornerType: Cesium.CornerType.MITERED,
                                outline: true,
                                outlineColor: Cesium.Color.BLACK,
                                shadows: Cesium.ShadowMode.ENABLED,
                                positions: [fromLane.laneTarget, toLane.laneSource],
                                width: conn.width, // 레인별 폭 적용
                                material: Cesium.Color.GREY.withAlpha(0.5),
                                heightReference: HeightReference.CLAMP_TO_GROUND,
                                //height: 0,
                                //extrudedHeight: 1, // 평면
                            },
                            properties : conn
                        });
                        conn.from = fromLane.laneTarget
                        conn.to = toLane.laneSource

                    }

                }

            }

            fetch(process.env.VITE_API_URL + "/signal", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            })
                .then((response) => {
                    return response.json();
                })
                .then(({nodes : signalNodes}) => {
                    console.log(signalNodes);
                    signalNodes.forEach(node => {
                        node.turns.forEach(turn => {
                            turn.connList.forEach(connId => {
                                const targetNode = nodes.find(t => t.id === node.id)
                                const conn = findConnectionById(targetNode, connId); // conn에서 from → to 좌표 구함
                                if (!conn) return;

                                const from = conn.from;
                                const to = conn.to;

                                cesiumViewer.entities.add({
                                    polyline: {
                                        positions: [from, to],
                                        width: 4,
                                        material: turn.type === "RTOR"
                                            ? Cesium.Color.YELLOW
                                            : Cesium.Color.CYAN.withAlpha(0.6),
                                    },
                                    description: `turn ${turn.turning} (conn: ${connId})`,
                                });
                            });
                        });
                    });

                })
            cesiumViewer.zoomTo(cesiumViewer.entities);
        });

        useEventStore.getState().cesiumEventManager.bind('select', (e) => {
                const picked = cesiumViewer.scene.pick(e.position);
                if (Cesium.defined(picked) && picked.id?.properties) {
                    const props: Record<string, any> = {};
                    const cartesian = cesiumViewer.scene.camera.pickEllipsoid(e.position, cesiumViewer.scene.globe.ellipsoid);
                    if (cartesian) {
                        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                        const longitude = Cesium.Math.toDegrees(cartographic.longitude);
                        const latitude = Cesium.Math.toDegrees(cartographic.latitude);
                        const height = cartographic.height;

                        props.longitude = longitude;
                        props.latitude = latitude;
                        props.height = height; // 높이도 함께 포함
                    }
                    const propBag = picked.id.properties;
                    propBag.propertyNames.forEach((key: string) => {
                        props[key] = propBag[key].getValue(Cesium.JulianDate.now());
                    });
                    setProperty(props);
                } else {
                    setProperty(null);
                }
        });

        // const handler = new Cesium.ScreenSpaceEventHandler(cesiumViewer.scene.canvas);
        //
        // handler.setInputAction((movement) => {
        //     const picked = cesiumViewer.scene.pick(movement.position);
        //     if (Cesium.defined(picked) && picked.id?.properties) {
        //         const props: Record<string, any> = {};
        //         const cartesian = cesiumViewer.scene.camera.pickEllipsoid(movement.position, cesiumViewer.scene.globe.ellipsoid);
        //         if (cartesian) {
        //             const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        //             const longitude = Cesium.Math.toDegrees(cartographic.longitude);
        //             const latitude = Cesium.Math.toDegrees(cartographic.latitude);
        //             const height = cartographic.height;
        //
        //             props.longitude = longitude;
        //             props.latitude = latitude;
        //             props.height = height; // 높이도 함께 포함
        //         }
        //         const propBag = picked.id.properties;
        //         propBag.propertyNames.forEach((key: string) => {
        //             props[key] = propBag[key].getValue(Cesium.JulianDate.now());
        //         });
        //         setProperty(props);
        //     } else {
        //         setProperty(null);
        //     }
        // }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        setLayerManager(layerManager);
        layerManager.addBaseMapLayer(layerGroups);
    };

    useEffect(() => {
        setActiveLayerGroupName(['baseMap'])
        setActiveLayerName(['osm'])
    }, [setActiveLayerGroupName, setActiveLayerName])

    const openLayersMapInit = () => {
        // 1) Map & View 초기화
        const view = new View({
            center: olProj.fromLonLat([ 126.77496, 37.49720 ]),
            zoom: 16,
        });
        const olMap = new OLMap({
            target: openlayersMapRef.current,
            view,
        });
        setMap(olMap);
        setView(view);

        return { olMap }
    }

    const cesiumMapInit = async () => {
        Cesium.Ion.defaultAccessToken = '';  // Set your Cesium Ion access token here
        const cesiumViewer = new Viewer(cesiumMapRef.current, {
            //terrain: new Cesium.Terrain(Cesium.CesiumTerrainProvider.fromUrl('http://175.197.92.213:10201/terrain-tile/dem05_ellipsoid')),
            shouldAnimate: true,
            selectionIndicator: false,
            timeline: false,
            animation: false,
            navigationHelpButton: false,
            homeButton: false,
            sceneModePicker: false,
            geocoder: false,
            fullscreenButton: false,
            infoBox: false,
            requestRenderMode: true,
            maximumRenderTimeChange: Infinity,
            baseLayerPicker: false,
            // contextOptions: {
            //     webgl: gl, // ✅ OpenLayers의 WebGL 컨텍스트 재사용
            // },
        });

        cesiumViewer.camera.setView({
            destination: Cartesian3.fromDegrees(126.77496, 37.49720, 10000) // Adjust the height as needed
        });
        cesiumViewer.scene.globe.depthTestAgainstTerrain = true;
        cesiumViewer.scene.useDepthPicking = true
        setViewer(cesiumViewer);

        fetch("CesiumMilkTruck.glb")
            .then(res => res.arrayBuffer())
            .then(glbBuffer => {
                // lodWorker.postMessage({ glbBuffer, lodLevels });
                //
                // lodWorker.onmessage = (event) => {
                //     if (event.data.success) {
                //         console.log('LOD 생성 완료:', event.data.lodBuffers);
                //         setLodModels(event.data.lodBuffers)
                //     } else {
                //         console.error('LOD 생성 실패:', event.data.error);
                //     }
                // };
            });

        try {

            // const tileSet1 = await Cesium.Cesium3DTileset.fromUrl(
            //     "https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon/$S_1_7_from_tileset.json",
            //     //"http://192.168.10.182/ngii-buildings/3DTiles_mouna/gyunggi/tileset.json",
            //     //"https://175.197.92.213:10203/three-d-tiles/griw_back/tileset.json",
            // );
            // const tileSet2 = await Cesium.Cesium3DTileset.fromUrl("https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon/$S_2_4_from_tileset.json")
            // const tileSet3 = await Cesium.Cesium3DTileset.fromUrl("https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon-bridge/tileset.json")
            // cesiumViewer.scene.primitives.add(tileSet1)
            // cesiumViewer.scene.primitives.add(tileSet2)
            // cesiumViewer.scene.primitives.add(tileSet3)
        } catch (error) {
            console.log(`Error loading tileset: ${ error }`);
        }

        return {
            cesiumViewer
        }
    }
    const findConnectionById = (node, connId) => {
        return node.connections?.find(conn => conn.id === connId);
    }
};

export default useMapInit;