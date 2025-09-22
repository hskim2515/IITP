import * as Cesium from "cesium";
import OLMap from "ol/Map";
import Feature from "ol/Feature";
import { Pixel } from "ol/pixel";
import { Geometry } from "ol/geom";
import BaseLayer from "ol/layer/Base";

/**
 * Cesium에서 픽킹을 수행하는 최적화된 함수
 * @param viewer Cesium 뷰어 인스턴스
 * @param position 화면 좌표
 * @param filter 선택적 필터 함수
 * @returns 픽킹된 객체 또는 null
 */
export function pickFromCesium(
    viewer: Cesium.Viewer,
    position: Cesium.Cartesian2,
    filter?: (item: any) => boolean
) {
    if (!viewer?.scene) return null;

    // 1) 가장 위에 있는 객체 먼저 확인 (가장 빠름)
    const topPicked = viewer.scene.pick(position);
    if (topPicked && (!filter || filter(topPicked))) {
        return topPicked;
    }

    // 2) 필터가 없고 topPicked가 없으면 바로 null 반환
    if (!filter) return null;

    // 3) 필터가 있는 경우만 drillPick 수행
    const allPicked = viewer.scene.drillPick(position);
    if (!allPicked?.length) return null;

    // 첫 번째로 조건에 맞는 객체 반환
    return allPicked.find(filter) || null;
}

/**
 * OpenLayers에서 픽킹을 수행하는 최적화된 함수
 * @param map OpenLayers 맵 인스턴스
 * @param pixel 픽셀 좌표
 * @param filter 선택적 필터 함수
 * @param layerFilter 선택적 레이어 필터 함수
 * @returns 픽킹된 피처 또는 null
 */
export function pickFromOpenLayers<G extends Geometry = Geometry>(
    map: OLMap,
    pixel: Pixel,
    filter?: (feature: Feature<G>) => boolean,
    layerFilter?: (layer: BaseLayer) => boolean
): Feature<G> | null {
    if (!map) return null;

    let result: Feature<G> | null = null;
    const options = layerFilter ? { layerFilter } : undefined;

    // 한 번의 순회로 처리 - 성능 최적화
    map.forEachFeatureAtPixel(
        pixel,
        (feature) => {
            const typedFeature = feature as Feature<G>;
            if (!filter || filter(typedFeature)) {
                result = typedFeature;
                return true;
            }
            return false;
        },
        options
    );

    return result;
}