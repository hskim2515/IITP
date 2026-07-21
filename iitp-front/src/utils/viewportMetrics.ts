import * as Cesium from "cesium";
import { useNetworkExtentStore } from "@stores/useNetworkExtentStore";

/**
 * 차량 줌 티어(VEHICLE_ZOOM_TIER_PX_M) 임계값의 기준 네트워크 크기(m, 가로/세로 중 큰 쪽).
 * 부천 규모 소형 시나리오(수 km)를 상정해 잡았던 원래 임계값(30/200/800)이 딱 맞아떨어지는
 * 네트워크 크기 — normalizePixelSizeM()이 실제 네트워크 크기와 이 값의 비율로 보정한다.
 */
export const REFERENCE_NETWORK_EXTENT_M = 16000;

/**
 * 실제 네트워크 크기에 비례해 pixelSizeM을 정규화한다.
 *
 * ⚠️ 왜 필요한가: 시나리오마다 네트워크의 실제 지리적 범위가 수 km(소형 시범 지역)부터 수십 km
 * (광역시)까지 천차만별인데, 차량 줌 티어(개별/flow/히트맵/OD) 임계값은 고정된 절대 pixelSizeM
 * 값이다. 소형 네트워크에서는 고정 임계값에 도달하기 훨씬 전에 이미 네트워크 범위를 벗어난
 * bbox를 조회하게 되어(예: 부천 규모 2~3km 네트워크에서 flow 임계값 30·200이 이미 네트워크
 * 전체보다 10배 이상 넓은 영역) 데이터가 없는 빈 공간만 조회 — flow/히트맵/OD가 전부 안 보이는
 * 원인이었다. 네트워크 크기 대비 상대적인 줌 단계로 비교해야 시나리오 규모와 무관하게 항상
 * 올바른 지점에서 전환된다.
 *
 * @returns 정규화된 pixelSizeM. 네트워크 크기를 아직 모르면(시나리오 로드 전 등) 원본 그대로 반환.
 */
export function normalizePixelSizeM(pixelSizeM: number): number {
    const extentM = useNetworkExtentStore.getState().extentM;
    if (!extentM || extentM <= 0) return pixelSizeM;
    return pixelSizeM * (REFERENCE_NETWORK_EXTENT_M / extentM);
}

export interface ViewportMetrics {
    /** 화면 중앙 지면점 (ECEF) */
    ground: Cesium.Cartesian3;
    /** 카메라~화면중앙 지면점 거리 (m) */
    groundDist: number;
    /** 화면 1px에 해당하는 지면 거리 (m/px) — 줌 레벨의 공통 단위. 클수록 축소(멀리). 원본(비보정) 값 */
    pixelSizeM: number;
    /** 네트워크 실제 크기로 보정한 pixelSizeM — 차량 줌 티어 판정은 반드시 이 값을 써야 한다
     *  (VEHICLE_ZOOM_TIER_PX_M/TRAFFIC_FLOW/VEHICLE_AGGREGATION/OD_FLOW 전부 기준). */
    normalizedPixelSizeM: number;
    /** 화면 중앙 지면점 기준 bbox (WGS84 degree) */
    bbox: { w: number; s: number; e: number; n: number };
}

/**
 * 카메라 중앙 지면점 기준 pixelSizeM(줌 레벨)과 bbox를 계산하는 공용 유틸.
 *
 * ⚠️ camera.computeViewRectangle()은 쓰지 않는다 — 카메라가 기울어지면(3D 틸트) 지평선까지
 * 포함해 사각형이 화면 중심과 동떨어지거나 폭발적으로 커진다. 대신 화면 중앙 지면점 + 픽셀
 * 크기 기반으로 계산해 틸트에 강건하게 만든다.
 *
 * 이전엔 이 계산이 useSimulation.ts(차량 뷰포트 스트리밍), TrafficHeatmapCesiumLayer,
 * TrafficTailCesiumLayer 세 곳에 각각 복붙되어 있었고, 임계값(MAX_BBOX_DEG는 "도" 단위,
 * VEHICLE_AGGREGATION/TRAFFIC_FLOW는 "pixelSizeM" 단위)이 서로 다른 단위라 변환을 감으로
 * 해야 했다 — 그 결과 flow 레이어 임계값이 실제 개별 차량 범위와 안 맞는 버그가 났다.
 * 이제 모든 zoom 판정은 이 함수가 반환하는 pixelSizeM 하나로 통일한다.
 *
 * @returns 화면 중앙이 지면을 가리키지 않으면(하늘을 보는 시점 등) null.
 */
export function computeViewportMetrics(viewer: Cesium.Viewer): ViewportMetrics | null {
    const scene = viewer.scene;
    const canvas = scene.canvas;
    const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const ray = viewer.camera.getPickRay(center);
    let ground = ray ? scene.globe.pick(ray, scene) : undefined;
    if (!ground) ground = viewer.camera.pickEllipsoid(center, scene.globe.ellipsoid);
    if (!ground) return null;

    const groundDist = Cesium.Cartesian3.distance(viewer.camera.positionWC, ground);
    const frustum: any = viewer.camera.frustum;
    const fovy = frustum.fovy ?? frustum.fov ?? Cesium.Math.toRadians(60);
    const canvasH = canvas.clientHeight || 900;
    const canvasW = canvas.clientWidth || 1200;
    const pixelSizeM = (2 * groundDist * Math.tan(fovy / 2)) / canvasH;

    const halfHeightM = pixelSizeM * canvasH / 2;
    const halfWidthM  = pixelSizeM * canvasW / 2;
    const carto = Cesium.Cartographic.fromCartesian(ground);
    const centerLng = Cesium.Math.toDegrees(carto.longitude);
    const centerLat = Cesium.Math.toDegrees(carto.latitude);
    const halfLatDeg = halfHeightM / 111320;
    const halfLngDeg = (halfWidthM / 111320) / Math.max(Math.cos(carto.latitude), 0.01);

    return {
        ground,
        groundDist,
        pixelSizeM,
        normalizedPixelSizeM: normalizePixelSizeM(pixelSizeM),
        bbox: {
            w: centerLng - halfLngDeg, s: centerLat - halfLatDeg,
            e: centerLng + halfLngDeg, n: centerLat + halfLatDeg,
        },
    };
}
