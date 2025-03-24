package com.iitp.iitp_rest.model.geometry;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Cartesian3 {
    private double x;
    private double y;
    private double z;

    public static Cartesian3 fromDegrees(double lon, double lat, double height) {
        // WGS84 타원체 기준 반지름 (meters)
        final double a = 6378137.0;  // Equatorial radius (Semi-major axis)
        final double f = 1 / 298.257223563; // Flattening
        final double e2 = 2 * f - f * f;  // Eccentricity squared

        // 경위도를 라디안으로 변환
        double lonRad = Math.toRadians(lon);
        double latRad = Math.toRadians(lat);

        // WGS84 타원체에서의 N (반경)
        double N = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(latRad), 2));

        // ECEF 좌표 변환 공식
        double x = (N + height) * Math.cos(latRad) * Math.cos(lonRad);
        double y = (N + height) * Math.cos(latRad) * Math.sin(lonRad);
        double z = ((1 - e2) * N + height) * Math.sin(latRad);

        return new Cartesian3(x, y, z);
    }

    // 두 점 사이의 유클리드 거리 계산
    public static double distance(Cartesian3 a, Cartesian3 b) {
        double dx = a.getX() - b.getX();
        double dy = a.getY() - b.getY();
        double dz = a.getZ() - b.getZ();
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}