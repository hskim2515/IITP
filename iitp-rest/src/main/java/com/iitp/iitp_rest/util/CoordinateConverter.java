package com.iitp.iitp_rest.util;

import org.locationtech.proj4j.ProjCoordinate;

/**
 * 네트워크 로컬 좌표(node.center/link.shape 등과 동일 좌표계) → WGS84 근사 변환.
 * SCALE_X(1/88000)는 위도 ~37.5°N 부근(수도권) 경도 1도당 거리 근사, SCALE_Y(1/111000)는 위도
 * 1도당 거리 — CoordinateUtils(네트워크/시설물 좌표 변환)와 동일 공식을 공유한다.
 */
public class CoordinateConverter {

    private static final double SCALE_X = 1.0 / 88000.0;
    private static final double SCALE_Y = 1.0 / 111000.0;

    private CoordinateConverter() {}

    /**
     * vehicle_sim.db 의 pos_x/pos_y는 링크 기준 상대좌표(진행거리+횡offset)가 아니라 network.xml
     * 의 node.center 와 동일한 좌표계의 절대 로컬 좌표다 — 실측 확인: 특정 link/connection 위의
     * pos_x/pos_y 값이 그 도형(shape)의 시작점 좌표와 정확히 일치한다(예: link shape
     * "3286.0234,1504.1684 ..." ↔ pos_x=3283.03, pos_y=1504.42). 따라서 링크 도형을 따라
     * 보간할 필요 없이 이 좌표를 직접 변환한다.
     */
    public static ProjCoordinate toAbsoluteLocal(double localX, double localY, double baseLon, double baseLat) {
        return toAbsoluteLocal(localX, localY, baseLon, baseLat, 0.0, 1.0);
    }

    /**
     * 회전(rotationDeg)·축척(scale) 반영 버전 — CoordinateUtils.transformCoordinates(네트워크/
     * 시설물 좌표 변환)와 동일한 회전행렬 공식을 공유한다. 네트워크 기준점을 캘리브레이션
     * (2점 보정)한 시나리오에서, 차량이 회전·확대된 도로 위에 정확히 겹치도록 하려면 이 버전을
     * 써야 한다 — rotationDeg=0, scale=1 이면 기존 순수 평행이동과 동일한 결과.
     */
    public static ProjCoordinate toAbsoluteLocal(
            double localX, double localY, double baseLon, double baseLat, double rotationDeg, double scale
    ) {
        double rotationRad = Math.toRadians(rotationDeg);
        double cos = Math.cos(rotationRad);
        double sin = Math.sin(rotationRad);
        double rx = (localX * cos - localY * sin) * scale;
        double ry = (localX * sin + localY * cos) * scale;
        return new ProjCoordinate(baseLon + rx * SCALE_X, baseLat + ry * SCALE_Y, 0);
    }
}
