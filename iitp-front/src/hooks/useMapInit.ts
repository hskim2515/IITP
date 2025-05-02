import {useEffect, useRef, useState} from 'react';
import {useCesiumStore} from "@stores/useCesiumStore";
import {Cartesian3, UrlTemplateImageryProvider, Viewer} from "cesium";
import * as Cesium from "cesium";
import PrimitiveLayerManager from "@primitives/PrimitiveLayerManager";
import { useLayerStore } from "@stores/useLayerStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { Map as OLMap, View } from "ol";
import * as olProj from "ol/proj";
import OlLayerManager from "../features/managers/OlLayerManager";

const useMapInit = (openlayersMapRef, cesiumMapRef) => {

    const setMap = useOpenLayersStore.actions.setMap();
    const setView = useOpenLayersStore.actions.setView();

    const setViewer = useCesiumStore((state) => state.setViewer);
    const setCesiumPrimitiveLayerManager = useLayerStore((state) => state.setCesiumPrimitiveLayerManager);
    const lodLevels = [1.0, 0.5, 0.2];

    const layerGroups = useLayerSchemaStore.state.groups();
    const setOlLayerManager = useLayerStore.actions.setOlLayerManager();

    const setActiveLayerGroupName = useLayerStore.actions.setActiveLayerGroupName()
    const setActiveLayerName = useLayerStore.actions.setActiveLayerName()

    const [lodModels, setLodModels] = useState(null);

    //const lodWorker = new Worker(new URL('/src/workers/lodWorker.ts', import.meta.url), { type: 'module' });

    useEffect(() => {
        cesiumMapInit();
    }, []);
    useEffect(() => {
        openLayersMapInit()
    }, [layerGroups]); // fetch로 받아온 데이터가 있어야 초기화할 수 있도록 의존성 조건 설정


    useEffect(() => {
        setActiveLayerGroupName(['baseMap'])
        setActiveLayerName(['osm'])
    }, [setActiveLayerGroupName, setActiveLayerName])

    const openLayersMapInit = () => {
        if (!openlayersMapRef.current) return;
        if (layerGroups.length === 0) return;
        // 1) Map & View 초기화
        const view = new View({
            center: olProj.fromLonLat([ 127.1216, 37.3826 ]),
            zoom: 16,
        });
        const map = new OLMap({
            target: openlayersMapRef.current,
            view,
        });
        setMap(map);
        setView(view);
        const manager = new OlLayerManager(map, view)
        setOlLayerManager(manager)
        manager.createRootGroup(layerGroups);
        manager.createBaseLayer();
        manager.createAnalysisLayer();
        manager.createODMatrixLayer();
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


export default useMapInit;