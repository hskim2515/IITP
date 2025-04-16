import { useEffect, useRef, useState } from 'react';
import { Cartesian3, GeoJsonDataSource, Viewer, UrlTemplateImageryProvider, JulianDate } from "cesium";
import * as Cesium from "cesium";
import FieldPrimitive from "@primitives/FieldPrimitive.ts";
import LinePrimitive from "@primitives/LinePrimitive.ts";
import RectanglePrimitive from "@primitives/RectanglePrimitive.ts";
import DomePrimitive from "@primitives/DomePrimitive.ts";
import DensityPrimitive from "@primitives/DensityPrimitive.ts";
import { useCesiumStore } from "@stores/useCesiumStore.ts";


const MapCesium2: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {    const cesiumContainer = useRef(null);
    const [speedFactor, setSpeedFactor] = useState(100);
    const [numVehicle, setNumVehicle] = useState(3000);
    const [lodModels, setLodModels] = useState(null);
    const vehicleDataRef = useRef(null);

    const setViewer = useCesiumStore((state) => state.setViewer);
    const viewer = useCesiumStore((state) => state.viewer);

    const lodWorker = new Worker(new URL('/src/worker/lodWorker.ts', import.meta.url), { type: 'module' });
    const worker = new Worker(new URL('/src/worker/changeModelWorker.ts', import.meta.url), { type: 'module' });
    const heatmapWorker = new Worker(new URL('/src/worker/heatmapWorker.ts', import.meta.url), { type: 'module' });
    const lodLevels = [1.0, 0.5, 0.2];

    const czmlDataSourceRef = useRef(null);
    const heatmapRectangleRef = useRef(null);
    const heatmapCanvasRef = useRef(null);
    const heatmapLayerRef = useRef(null);


    //const worker2 = new Worker(new URL('/src/worker/changeModelWorker.ts', import.meta.url), { type: 'module' });
    //const worker3 = new Worker(new URL('/src/worker/changeModelWorker.ts', import.meta.url), { type: 'module' });

    useEffect(() => {
        async function loadCesium() {
            if (!cesiumContainer.current) return;
            Cesium.Ion.defaultAccessToken = '';  // Set your Cesium Ion access token here

            const newViewer = new Viewer(cesiumContainer.current, {
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
            });

            newViewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
                url: 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c'],
                credit: '© OpenStreetMap contributors'
            }));

            newViewer.scene.globe.depthTestAgainstTerrain = true;


            // Set the initial view to Daejeon
            newViewer.camera.setView({
                destination: Cartesian3.fromDegrees(127.1216, 37.3826, 10000) // Adjust the height as needed
            });

            const clock = newViewer.clock;

            // 시간 간격 설정 (1초마다 시간 변화)
            clock.multiplier = 1;  // 1초마다 1초씩 시간이 증가하도록 설정
            clock.shouldAnimate = true; // 애니메이션 활성화

            setViewer(newViewer);

            fetch("CesiumMilkTruck.glb")
                .then(res => res.arrayBuffer())
                .then(glbBuffer => {
                    lodWorker.postMessage({ glbBuffer, lodLevels });

                    lodWorker.onmessage = (event) => {
                        if (event.data.success) {
                            console.log('LOD 생성 완료:', event.data.lodBuffers);
                            setLodModels(event.data.lodBuffers)
                        } else {
                            console.error('LOD 생성 실패:', event.data.error);
                        }
                    };
                });

            // Load GeoJSON for roads
            // GeoJsonDataSource.load('network.geojson',{
            //     clampToGround: true
            // }).then((dataSource) => {
            //     dataSource.entities.values.filter((entity) => {
            //         if (!entity.polyline) {
            //             entity.point = undefined;
            //             entity.billboard = undefined;
            //         }
            //     })
            //     newViewer.dataSources.add(dataSource);
            // });
            try {

                const tileset = await Cesium.Cesium3DTileset.fromUrl(
                    "http://192.168.10.182/ngii-buildings/3d/sn/tileset.json",
                    //"http://192.168.10.182/ngii-buildings/3DTiles_mouna/gyunggi/tileset.json",
                    //"https://175.197.92.213:10203/three-d-tiles/griw_back/tileset.json",
                );

                //const tileData = newViewer.scene.primitives.add(tileset);

                // console.log(tileData.root)
                //
                // // 1. Bounding Volume 가져오기
                // const boundingVolume = tileData.root.boundingVolume;
                // const obb = boundingVolume.boundingVolume;


                // if (obb instanceof Cesium.OrientedBoundingBox) {
                //     // 2. OBB 중심과 변환 행렬 가져오기
                //     const center = obb.center;
                //     const halfAxes = obb.halfAxes;
                //
                //     // 3. X, Y 방향 끝점 계산 (4개 꼭짓점)
                //     const cornerPoints = [
                //         Cesium.Matrix3.multiplyByVector(halfAxes, new Cesium.Cartesian3(1, 1, 0), new Cesium.Cartesian3()),  // 오른쪽 위
                //         Cesium.Matrix3.multiplyByVector(halfAxes, new Cesium.Cartesian3(-1, 1, 0), new Cesium.Cartesian3()), // 왼쪽 위
                //         Cesium.Matrix3.multiplyByVector(halfAxes, new Cesium.Cartesian3(-1, -1, 0), new Cesium.Cartesian3()),// 왼쪽 아래
                //         Cesium.Matrix3.multiplyByVector(halfAxes, new Cesium.Cartesian3(1, -1, 0), new Cesium.Cartesian3())  // 오른쪽 아래
                //     ];
                //
                //     let minLat = Number.POSITIVE_INFINITY;
                //     let minLon = Number.POSITIVE_INFINITY;
                //     let maxLat = Number.NEGATIVE_INFINITY;
                //     let maxLon = Number.NEGATIVE_INFINITY;
                //
                //     // 4. 꼭짓점을 WGS84 좌표로 변환
                //     for (const corner of cornerPoints) {
                //         const worldCorner = Cesium.Cartesian3.add(center, corner, new Cesium.Cartesian3());
                //         const cartographic = Cesium.Cartographic.fromCartesian(worldCorner);
                //         const lon = Cesium.Math.toDegrees(cartographic.longitude);
                //         const lat = Cesium.Math.toDegrees(cartographic.latitude);
                //
                //         minLon = Math.min(minLon, lon);
                //         maxLon = Math.max(maxLon, lon);
                //         minLat = Math.min(minLat, lat);
                //         maxLat = Math.max(maxLat, lat);
                //     }
                //
                //     //const rectangle = Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat);
                //
                //     heatmapRectangleRef.current = Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat);
                //
                //     heatmapLayerRef.current = newViewer.imageryLayers.addImageryProvider(
                //         new Cesium.SingleTileImageryProvider({
                //             url: "",
                //             rectangle: heatmapRectangleRef.current,
                //             tileWidth: 512, // 이미지의 가로 크기 설정
                //             tileHeight: 512 // 이미지의 세로 크기 설정
                //         })
                //     );
                // }

                // const boundingSphere = tileData.boundingSphere;
                //
                // // 해당 위치로 이동
                // newViewer.camera.flyToBoundingSphere(boundingSphere, {
                //     duration: 2.0, // 2초 동안 이동
                //     offset: new Cesium.HeadingPitchRange(0, -0.5, boundingSphere.radius * 2.0),
                // });

                tileData.imageBasedLighting.imageBasedLightingFactor.x = 3
                tileData.imageBasedLighting.imageBasedLightingFactor.y = 3

            } catch (error) {
                console.log(`Error loading tileset: ${error}`);
            }
        }
        loadCesium().then(() => {
            // 히트맵


        });
    }, []);

    useEffect(() => {
        if (!viewer) return;

        fetch("http://localhost:8080/vehicle/generate-positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numVehicle, speedFactor }),
        })
            .then(response => response.json())
            .then(({ positions }) => {

                viewer.scene.primitives.removeAll()

                const primitives = new Cesium.PrimitiveCollection();
                const heatmapPrimitives = new Cesium.PrimitiveCollection();

                //const heatmap = new HeatmapPrimitive(positions.flat(), viewer.scene.context);
                //heatmapPrimitives.add(heatmap)

                const timeBasedPositions = transformToTimeBasedPositions(positions);

                const vehicleDensityPrimitive = new DensityPrimitive(timeBasedPositions, viewer.scene.context);
                primitives.add(vehicleDensityPrimitive);

                positions.forEach((position,i) => {
                    //if(i == 0){
                        const vehicleFieldPrimitive = new FieldPrimitive(position, viewer.scene.context);
                        const vehicleRootPrimitive = new LinePrimitive(position, viewer.scene.context);
                        const vehicleRectanglePrimitive = new RectanglePrimitive(position, viewer.scene.context);
                        const vehicleDomePrimitive = new DomePrimitive(position, viewer.scene.context);
                        primitives.add(vehicleFieldPrimitive);
                        primitives.add(vehicleRootPrimitive);
                        primitives.add(vehicleRectanglePrimitive);
                        primitives.add(vehicleDomePrimitive);
                    //}

                });

                // 모든 FieldPrimitive 객체를 viewer의 scene에 추가
                viewer.scene.primitives.add(primitives);
                //viewer.scene.primitives.add(heatmapPrimitives);

                viewer.scene.preRender.addEventListener((scene, time) => {
                    //timeFieldPrimitive.update(viewer.scene.frameState)
                    // if(primitives){
                    //     for (const primitive of primitives._primitives) {
                    //         primitive.update(scene.frameState);
                    //     }
                    // }

                    // const cameraPositionWC = viewer.camera.positionWC;
                    // if(vehicleDataRef.current){
                    //     const currentTime = viewer.clock.currentTime;
                    //     const newVehicleData = vehicleDataRef.current
                    //     //console.log(newVehicleData)
                    //     worker.postMessage({ newVehicleData, cameraPositionWC });
                    //     updateHeatmap(vehicleDataRef.current, currentTime, heatmapRectangleRef.current);
                    // }
                });
                // worker.onmessage = (e) => {
                //     vehicleDataRef.current = e.data;
                //     e.data.forEach(data => {
                //         if(data.changed){
                //             //console.log(data)
                //             const vehicleEntity = newCzmlDataSource.entities.getById(data.id);
                //             //console.log(vehicleEntity)
                //             if (data.displayType === "model") {
                //                 vehicleEntity.path = undefined;
                //                 vehicleEntity.point = undefined;
                //                 vehicleEntity.model = new Cesium.ModelGraphics({
                //                     uri: lodModels[data.lod],
                //                     scale: 1.0,
                //                     minimumPixelSize: 30,
                //                     maximumScale: 2.0,
                //                     heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                //                 });
                //             }
                //             else if(data.displayType === "point") {
                //                 vehicleEntity.model = undefined;
                //                 vehicleEntity.path = undefined;
                //                 vehicleEntity.point = new Cesium.PointGraphics({
                //                     color: Cesium.Color.RED,
                //                     outlineColor: Cesium.Color.BLACK,
                //                     outlineWidth: 1,
                //                     pixelSize: 10,
                //                     heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                //                 });
                //             }
                //             else if(data.displayType === "line") {
                //                 //console.log(data)
                //                 vehicleEntity.model = undefined;
                //                 vehicleEntity.point = undefined;
                //                 vehicleEntity.path = new Cesium.PolylineGraphics({
                //                     material: new Cesium.PolylineOutlineMaterialProperty({
                //                         color: Cesium.Color.RED.withAlpha(0.3), // 주 색상 (보라색)
                //                         //outlineColor: Cesium.Color.CYAN, // 외곽선 색상 (청록색)
                //                         //outlineWidth: 5, // 외곽선 두께
                //                     }),
                //                     width: 10, // 선 두께
                //                     leadTime: 10, // 앞쪽으로 보이는 길이
                //                     trailTime: 10, // 뒤쪽으로 보이는 길이
                //                     resolution: 5, // 경로 해상도
                //                     // positions: new Cesium.CallbackProperty(() => {
                //                     //     return vehiclePositions; // 동적으로 업데이트되는 위치 배열
                //                     // }, false),
                //                     heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                //                 });
                //             }
                //         }
                //     });
                // };

                heatmapWorker.onmessage = (event) => {
                    viewer.imageryLayers.raise(heatmapLayerRef.current);

                    const { heatmapDataUrl } = event.data;

                    // Make sure heatmapLayerRef.current is properly initialized
                    if (heatmapLayerRef.current) {
                        console.log(heatmapDataUrl);
                        // Directly set the `url` to update the image
                        heatmapLayerRef.current.url = heatmapDataUrl;

                        // Cesium will handle image reloading after the URL change
                        heatmapLayerRef.current._image = heatmapDataUrl; // If necessary, update the internal _image property as well
                    }
                };
                // const newCzmlDataSource = new Cesium.CzmlDataSource();
                //
                // newCzmlDataSource.load(czml).then(() => {
                //     viewer.dataSources.add(newCzmlDataSource);
                //     czmlDataSourceRef.current = newCzmlDataSource; // 레퍼런스 업데이트
                // });
            });

        const updateHeatmap = (vehicleData, currentTime, bounds) => {
            heatmapWorker.postMessage({
                vehicleData,
                width: 256,
                height: 256,
                bounds,
                currentTime
            });
        };
        const transformToTimeBasedPositions = (vehiclePositions)=> {
            if (vehiclePositions.length === 0) return [];

            const timeSteps = vehiclePositions[0].length; // 시점 개수 (모든 차량이 동일한 시점 개수를 가정)
            const timeBasedPositions = Array.from({ length: timeSteps }, () => []);

            vehiclePositions.forEach((vehicleData) => {
                vehicleData.forEach((entry, timeIndex) => {
                    console.log(entry)

                    timeBasedPositions[timeIndex]?.push(new Cesium.Cartesian3(entry.x, entry.y, entry.z));
                });
            });
            return timeBasedPositions;
        }

        return () => worker.terminate();
    }, [viewer, numVehicle, speedFactor]);

    return (
        <div style={{ position: "relative", ...style }}>
            <div ref={cesiumContainer} style={{ width: "100%", height: "90vh" }}  />
            <div style={{ position: 'absolute', top: '20px', left: '20px', backgroundColor: 'black', padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>시간: {speedFactor.toFixed(5)}</label>
                <input type="range" min="100" max="1000" step="10" value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={{ position: 'absolute', top: '100px', left: '20px', backgroundColor: 'black', padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>대수: {numVehicle}</label>
                <input type="range" min="50" max="5000" step="50" value={numVehicle} onChange={(e) => setNumVehicle(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
        </div>
    );
};

export default MapCesium2;
