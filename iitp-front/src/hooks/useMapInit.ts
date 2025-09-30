import { MutableRefObject, useEffect, useState } from 'react';
import { useCesiumStore } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { Cartesian3, Viewer } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { Map as OLMap, View } from "ol";
import * as olProj from "ol/proj";

const useMapInit = (openlayersMapRef: MutableRefObject<HTMLDivElement | null>, cesiumMapRef: MutableRefObject<Element | null>) => {

    const setMap = useOpenLayersStore.actions.setMap();
    const setView = useOpenLayersStore.actions.setView();

    const setViewer = useCesiumStore((state) => state.setViewer);
    const setLayerManager = useLayerStore((state) => state.setLayerManager);
    const lodLevels = [1.0, 0.5, 0.2];

    const layerGroups = useLayerSchemaStore.state.groups();

    const setActiveLayerGroupName = useLayerStore.actions.setActiveLayerGroupName()
    const setActiveLayerName = useLayerStore.actions.setActiveLayerName()

    const [lodModels, setLodModels] = useState(null);

    //const lodWorker = new Worker(new URL('/src/workers/lodWorker.ts', import.meta.url), { type: 'module' });

    useEffect(() => {
        if (!cesiumMapRef.current) return;
        if (layerGroups.length === 0) return;
        initializeMaps().then(() => console.log("initializeMaps"));
    }, [layerGroups, cesiumMapRef.current]);

    const initializeMaps = async () => {
        openLayersMapInit();
        await cesiumMapInit();
    };

    useEffect(() => {
        setActiveLayerGroupName(['baseMap'])
        setActiveLayerName(['osm'])
    }, [setActiveLayerGroupName, setActiveLayerName])

    const openLayersMapInit = () => {
        if (!openlayersMapRef.current) return;
        // 1) Map & View 초기화
        const view = new View({
            center: olProj.fromLonLat([126.77496, 37.49720]),
            zoom: 16,
        });
        const olMap = new OLMap({
            pixelRatio: 1,
            target: openlayersMapRef.current,
            view,
        });
        setMap(olMap);
        setView(view);

        return {olMap}
    }

    const cesiumMapInit = async () => {
        if (!cesiumMapRef.current) return;
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
            creditContainer: document.createElement("div")
            // contextOptions: {
            //     webgl: gl, // ✅ OpenLayers의 WebGL 컨텍스트 재사용
            // },
        });

        cesiumViewer.camera.setView({
            destination: Cartesian3.fromDegrees(126.77496, 37.49720, 10000) // Adjust the height as needed
        });

        cesiumViewer.cesiumWidget.creditDisplay.container.style.display = "none";

        cesiumViewer.scene.globe.depthTestAgainstTerrain = true;
        cesiumViewer.scene.useDepthPicking = true

        cesiumViewer.scene.backgroundColor = Cesium.Color.BLACK;
        cesiumViewer.scene.skyAtmosphere.show = false;
        cesiumViewer.scene.skyBox.show = false;
        cesiumViewer.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        cesiumViewer.scene.globe.enableLighting = false;

        // cesiumViewer.scene.light = new Cesium.DirectionalLight({
        //     direction: new Cesium.Cartesian3(0.0, 0.0, 0.0) // 빛 없음
        // });

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
            console.log(`Error loading tileset: ${error}`);
        }

        return {
            cesiumViewer
        }
    }
};

export default useMapInit;