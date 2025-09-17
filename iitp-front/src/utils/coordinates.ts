import { Coordinate as OlCoordinate } from "ol/coordinate";
import { toLonLat } from "ol/proj";
import * as Cesium from "cesium";
import { Coordinates } from "@type/openapi.gen";

/**
 * OpenLayers의 좌표(Coordinate)로부터 Coordinates 객체를 생성합니다.
 * 유효하지 않은 좌표일 경우 null을 반환합니다.
 * @param olCoordinate OpenLayers의 좌표 배열 (e.g., e.coordinate)
 * @returns {Coordinates | null} 변환된 좌표 객체 또는 null
 */
export function createCoordinatesFromOl(olCoordinate: OlCoordinate): Coordinates | null {
    if (!olCoordinate || olCoordinate.length < 2) {
        return null;
    }
    const lonLat = toLonLat(olCoordinate);
    if (typeof lonLat[0] !== 'number' || typeof lonLat[1] !== 'number') {
        return null;
    }
    return { lng: lonLat[0], lat: lonLat[1] };
}

/**
 * Cesium의 Cartesian3 좌표로부터 Coordinates 객체를 생성합니다.
 * 유효하지 않은 좌표일 경우 null을 반환합니다.
 * @param cartesian Cesium의 Cartesian3 좌표
 * @returns {Coordinates | null} 변환된 좌표 객체 또는 null
 */
export function createCoordinatesFromCesium(cartesian: Cesium.Cartesian3): Coordinates | null {
    if (!cartesian) {
        return null;
    }
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    if (!cartographic) {
        return null;
    }
    return {
        lng: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
    };
}