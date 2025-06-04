import {useEffect, useRef} from 'react';
import * as Cesium from "cesium";
import {Camera, Cartesian3} from "cesium";
import {usePanelStore} from "@stores/usePanelStore";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import * as olProj from "ol/proj";
import {Coordinate} from "ol/coordinate";
import {useMapStore} from "@stores/useMapStore";

const useMapSync = () => {

    let cesiumCamera: Camera;

    const isCesiumSyncing = useRef(false)
    const isOLSyncing = useRef(false)

    const { setCesiumSyncing, setOLSyncing } = useMapStore();

    const cesiumViewer = useCesiumStore((state) => state.viewer);
    const olMap = useOpenLayersStore((state) => state.map);
    const olView = useOpenLayersStore((state) => state.view);

    useEffect(() => {
        if(olMap && olView && cesiumViewer){

            cesiumCamera = cesiumViewer.scene.camera;

            const syncCesium = () => {
                if (isCesiumSyncing.current) return;
                setCesiumSyncing(true);
                isCesiumSyncing.current = true;
                isOLSyncing.current = false;
            };

            const syncOL = () => {
                if (isOLSyncing.current) return;
                setOLSyncing(true);
                isCesiumSyncing.current = false;
                isOLSyncing.current = true;
            };

            const destination = Cartesian3.fromDegrees(126.77496, 37.49720, 10000);
            cesiumCamera.setView({
                destination
            });

            olView.on('change:center', olCenterHandler);
            olView.on('change:rotation', olRotationHandler);
            olView.on('change:resolution', olResolutionHandler);

            cesiumViewer.scene.canvas.addEventListener("mousemove", syncCesium);
            olMap.on("pointermove", syncOL);

            cesiumViewer.scene.preRender.addEventListener(syncCesiumToOL);
            return () => {
                cesiumViewer.scene.postRender.removeEventListener(syncCesiumToOL);
                cesiumViewer.scene.preRender.removeEventListener(syncCesiumToOL);
                olView.un('change:center', olCenterHandler);
                olView.un('change:rotation', olRotationHandler);
                olView.un('change:resolution', olResolutionHandler);
            };
        }

    }, [olMap, olView, cesiumViewer]);

    const syncCesiumToOL = () => {
        if (isCesiumSyncing.current) {
            const scene = cesiumViewer.scene;
            const canvas = scene.canvas;

            const screenCenter = new Cesium.Cartesian2(
                canvas.clientWidth / 2,
                canvas.clientHeight / 2
            );

            const cartesian = cesiumCamera.pickEllipsoid(screenCenter, scene.globe.ellipsoid);
            if (cartesian) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const lon = Cesium.Math.toDegrees(cartographic.longitude);
                const lat = Cesium.Math.toDegrees(cartographic.latitude);

                olView.setCenter(olProj.fromLonLat([lon, lat]));

                const cameraPosition = cesiumCamera.position;
                const cameraDirection = cesiumCamera.direction;

                const ray = new Cesium.Ray(cameraPosition, cameraDirection);
                const rayIntersection = scene.globe.pick(ray, scene);

                if (rayIntersection) {
                    const cameraToCenterDistance = Cesium.Cartesian3.distance(cameraPosition, rayIntersection);
                    const zoom = Math.max(0, 18 - Math.log2(cameraToCenterDistance) + 8.5);
                    if (zoom !== undefined) {
                        olView.setZoom(zoom);
                    }
                }

                const heading = cesiumCamera.heading;
                olView.setRotation(-heading);
            }
        }
    };

    const olResolutionHandler = () => {

        if (isOLSyncing.current) {
            const zoom = olView.getZoom();
            const center = olView.getCenter();
            const [lon, lat] = olProj.toLonLat(center as Coordinate);
            const distance = Math.pow(2, 26.3-zoom);
            const newDestination = Cartesian3.fromDegrees(lon, lat, distance);

            cesiumCamera.setView({
                destination: newDestination,
                orientation: {heading: cesiumCamera.heading, pitch: cesiumCamera.pitch, roll: cesiumCamera.roll},
            });
        }
    }

    const olRotationHandler = () => {
        if (isOLSyncing.current) {
            const center = olView.getCenter();
            const [lon, lat] = olProj.toLonLat(center as Coordinate);
            const rotation = olView.getRotation();
            cesiumCamera.setView({
                destination: Cartesian3.fromDegrees(lon, lat, cesiumCamera.positionCartographic.height),
                orientation: { heading: -rotation, pitch: cesiumCamera.pitch, roll: cesiumCamera.roll, }
            });
        }
    }

    const olCenterHandler = () => {
        if (isOLSyncing.current) {
            const center = olView.getCenter();
            const [lon, lat] = olProj.toLonLat(center as number[]);
            cesiumCamera.setView({
                destination: Cartesian3.fromDegrees(lon, lat, cesiumCamera.positionCartographic.height),
                orientation: { heading: -olView.getRotation() || 0, pitch: cesiumCamera.pitch, roll: cesiumCamera.roll}
            });
        }
    }


};


export default useMapSync;
