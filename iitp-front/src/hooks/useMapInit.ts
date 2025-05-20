import {useEffect, useRef, useState} from 'react';
import {useCesiumStore} from "@stores/useCesiumStore";
import {Cartesian3, UrlTemplateImageryProvider, Viewer} from "cesium";
import * as Cesium from "cesium";
import PrimitiveLayerManager from "../managers/PrimitiveLayerManager";
import { useLayerStore } from "@stores/useLayerStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { Map as OLMap, View } from "ol";
import * as olProj from "ol/proj";
import {LayerManager} from "../managers/LayerManager";
import BaseMapLayerManager from "../managers/BaseMapLayerManager";
import {multiply} from "ol/transform";
import VectorLayerManager from "../managers/VectorLayerManager";
import TileLayerManager from "../managers/TileLayerManager";
import { useSimulationStore } from "@stores/useSimulationStore";

const useMapInit = (openlayersMapRef, cesiumMapRef) => {

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
            center: olProj.fromLonLat([ 127.3845, 36.3504 ]),
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
            destination: Cartesian3.fromDegrees(127.3845, 36.3504, 10000) // Adjust the height as needed
        });
        cesiumViewer.scene.globe.depthTestAgainstTerrain = true;
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

            const tileset = await Cesium.Cesium3DTileset.fromUrl(
                "http://192.168.10.182/ngii-buildings/3d/sn/tileset.json",
                //"http://192.168.10.182/ngii-buildings/3DTiles_mouna/gyunggi/tileset.json",
                //"https://175.197.92.213:10203/three-d-tiles/griw_back/tileset.json",
            );
        } catch (error) {
            console.log(`Error loading tileset: ${ error }`);
        }

        return {
            cesiumViewer
        }
    }
};

export default useMapInit;