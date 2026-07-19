import {useEffect, useRef} from 'react';
import * as Cesium from "cesium";
import {Camera, Cartesian3} from "cesium";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import * as olProj from "ol/proj";
import {Coordinate} from "ol/coordinate";
import {useMapStore} from "@stores/useMapStore";

/** EPSG:3857 zoom 0 해상도 (m/px, 256px 타일) */
const BASE_RES = 156543.03392804097;

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

    /**
     * OL 해상도(m/px) ↔ Cesium 카메라-지면 거리(m) 변환 계수.
     * distance = resolution × factor. 화면 픽셀 높이와 수직 FOV에서 유도 —
     * (기존 하드코딩 26.3/26.5 지수는 방향별로 달라 왕복마다 0.2줌씩 어긋나고,
     *  화면 높이·위도에 따라 3D가 더 확대되어 보이는 편차의 원인이었음)
     */
    const distancePerResolution = (): number => {
        const canvas = cesiumViewer.scene.canvas;
        const h = canvas.clientHeight || 800;
        const frustum: any = cesiumCamera.frustum;
        const fovy: number = frustum?.fovy ?? Cesium.Math.PI_OVER_THREE;
        return h / (2 * Math.tan(fovy / 2));
    };

    const syncCesiumToOL = () => {
        // 로드뷰(파노라마) 표시 중엔 Cesium 캔버스가 가려져 사용자 조작이 불가능한데도
        // isCesiumSyncing 이 이전 상태로 남아 있을 수 있다. 이때 파노라마 훅의 followCamera 가
        // 옮긴 카메라(위치=로드뷰 지점, pitch 유지)의 "바라보는 지점"을 OL center 로 밀면
        // 로드뷰→카메라→OL→로드뷰 순환으로 로드뷰가 끝없이 걸어가는 루프가 된다 → 차단.
        if (useMapStore.getState().panoramaActive) return;
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
                    // 지면 m/px = 거리 / factor. OL zoom = log2(BASE_RES·cos(lat) / res)
                    // (EPSG:3857 해상도는 위도 보정 필요 — 같은 화면 배율이 되도록 cos(lat) 반영)
                    const res = cameraToCenterDistance / distancePerResolution();
                    const zoom = Math.max(0, Math.log2((BASE_RES * Math.cos(cartographic.latitude)) / res));
                    olView.setZoom(zoom);
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
            // syncCesiumToOL 의 역변환 (동일 공식 — 왕복 드리프트 없음)
            const latRad = (lat ?? 0) * Math.PI / 180;
            const res = (BASE_RES * Math.cos(latRad)) / Math.pow(2, zoom ?? 16);
            const distance = res * distancePerResolution();
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
