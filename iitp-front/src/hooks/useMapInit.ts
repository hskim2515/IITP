import * as olProj from "ol/proj";
import {Map as OLMap, View} from "ol";
import {useEffect, useRef, useState} from 'react';
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import WebGLTileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import {useCesiumStore} from "@stores/useCesiumStore";
import {Cartesian3, UrlTemplateImageryProvider, Viewer} from "cesium";
import * as Cesium from "cesium";
import { Group, Heatmap } from "ol/layer";
import VectorSource from "ol/source/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { useLayerStore } from "@stores/useLayerStore";
import VectorLayer from "ol/layer/Vector";
import PrimitiveLayerManager from "@primitives/PrimitiveLayerManager";
import { useLayerStore } from "@stores/useLayerStore";



const useOpenLayersMapInit = (openlayersMapRef, cesiumMapRef) => {

    const setMap = useOpenLayersStore((state) => state.setMap);
    const setView = useOpenLayersStore((state) => state.setView);

    const setViewer = useCesiumStore((state) => state.setViewer);
    const setCesiumPrimitiveLayerManager = useLayerStore((state) => state.setCesiumPrimitiveLayerManager);
    const lodLevels = [1.0, 0.5, 0.2];

    const setOlVehicleLayer = useLayerStore((state) => state.setOlVehicleLayer);
    const setHeatmapLayer = useLayerStore((state) => state.setHeatmapLayer);
    const setTripLayer = useLayerStore((state) => state.setTripLayer);
    const vehicleVectorSource = new VectorSource();

    const heatmapRectangleRef = useRef(null);
    const heatmapCanvasRef = useRef(null);
    const heatmapLayerRef = useRef(null);

    const [lodModels, setLodModels] = useState(null);

    //const lodWorker = new Worker(new URL('/src/workers/lodWorker.ts', import.meta.url), { type: 'module' });

    let olMap: OLMap, olView: View;

    useEffect(() => {
        olMapInit();
        cesiumMapInit();
    }, []);

    const olVehicleLayerInit = () => {
        const layer =
            new WebGLVectorLayer({
                source: vehicleVectorSource,
                style: {
                    'circle-radius': 5,
                    'circle-fill-color': 'rgb(84,182,255)',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                },
                zIndex: 110,
            });
        layer.set("customName", "vehicle")
        setOlVehicleLayer(layer)
        return layer
    }

    const olHeatmapLayerInit = () => {
        const layer =
            new Heatmap({
                source: vehicleVectorSource,
                blur: 15,
                radius: 8,
                weight: () => 1,
                visible: false,
                zIndex: 220
            })
        layer.set("customName", "heatmap")
        setHeatmapLayer(layer)
        return layer;
    }

    const olTripLayerInit = () => {
        const layer =
            new WebGLVectorLayer({
                source: new VectorSource(),
                style: {
                    'stroke-color': 'rgba(0,0,0,0.15)',
                    'stroke-width': 2,
                },
                visible: false,
                zIndex: 10
            })
        layer.set("customName", "trip")
        setTripLayer(layer)
        return layer;
    }

    const olLayerGroupInit = () => {
        // heatmap과 trip 레이어 생성
        const heatmapLayer = olHeatmapLayerInit();
        const tripLayer = olTripLayerInit();

        // 두 레이어를 포함하는 그룹 생성
        const group = new Group({
            layers: [heatmapLayer, tripLayer],
        });
        group.set("customGroupName", "layer");
        return group;
    };

    const olMapInit = () => {
        if (openlayersMapRef.current) {
            olView = new View({
                center: olProj.fromLonLat([127.1216, 37.3826]),
                zoom: 16,
            });

            olMap = new OLMap({
                target: openlayersMapRef.current,
                view: olView,
                layers: [
                    new WebGLTileLayer({
                        source: new OSM(),
                    }),
                ],
            });

            setMap(olMap);
            setView(olView);

            olMap.addLayer(olVehicleLayerInit())
            olMap.addLayer(olLayerGroupInit())
        }
    }

    const cesiumMapInit = () => {
        async function loadCesium() {
            if (!cesiumMapRef.current) return;
            Cesium.Ion.defaultAccessToken = '';  // Set your Cesium Ion access token here
            const newViewer = new Viewer(cesiumMapRef.current, {
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

            newViewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
                url: 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c'],
                credit: '© OpenStreetMap contributors'
            }));

            // Set the initial view to Daejeon
            newViewer.camera.setView({
                destination: Cartesian3.fromDegrees(127.1216, 37.3826, 10000) // Adjust the height as needed
            });
            newViewer.scene.globe.depthTestAgainstTerrain = true;

            const manager = new PrimitiveLayerManager(newViewer, useLayerStore);

            setViewer(newViewer);
            setCesiumPrimitiveLayerManager(manager);

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

                const tileset = await Cesium.Cesium3DTileset.fromUrl(
                    "http://192.168.10.182/ngii-buildings/3d/sn/tileset.json",
                    //"http://192.168.10.182/ngii-buildings/3DTiles_mouna/gyunggi/tileset.json",
                    //"https://175.197.92.213:10203/three-d-tiles/griw_back/tileset.json",
                );
            } catch (error) {
                console.log(`Error loading tileset: ${error}`);
            }
        }
        loadCesium().then(() => {
            // 히트맵

        });
    }
};


export default useOpenLayersMapInit;