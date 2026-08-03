package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.geometry.Coordinates;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

public class CoordinateUtils {

    private static final double SCALE_X = 1.0 / 88000.0;
    private static final double SCALE_Y = 1.0 / 111000.0;
    /** 위도 1도당 미터 근사치(SCALE_Y의 역수) — 2점 캘리브레이션의 거리/각도 계산에 사용 */
    public static final double METERS_PER_DEGREE_LAT = 1.0 / SCALE_Y;
    /** 경도 1도당 미터 근사치(SCALE_X의 역수, 수도권 위도 기준) — 2점 캘리브레이션의 거리/각도 계산에 사용 */
    public static final double METERS_PER_DEGREE_LNG = 1.0 / SCALE_X;

    /**
     * @param input xml의 shape, coord 등의 좌표문자열
     * @return Coordinates 배열로 변환
     */
    public static List<Coordinates> parse(String input) {
        if (input == null || input.trim().isEmpty()) {
            return Collections.emptyList();
        }

        String trimmedInput = input.trim();

        if (isSinglePointFormat(trimmedInput)) {
            String[] parts = trimmedInput.split("\\s+");
            if (parts.length == 2) {
                Coordinates coords = parseSinglePoint(parts);
                return coords != null ? Collections.singletonList(coords) : Collections.emptyList();
            }
        } else {
            List<Coordinates> coordinatesList = new ArrayList<>();
            String[] pointStrings = trimmedInput.split("\\s+");

            for (String pointStr : pointStrings) {
                String[] parts = pointStr.split(",");
                if (parts.length == 2) {
                    Coordinates coords = parseSinglePoint(parts);
                    if (coords != null) {
                        coordinatesList.add(coords);
                    } else {
                        return Collections.emptyList();
                    }
                } else {
                    return Collections.emptyList();
                }
            }
            return coordinatesList;
        }

        return Collections.emptyList();
    }

    /**
     * @param coordinatesStr 검사할 문자열
     * @return 쉼표가 없으면 단일 포인트, true
     */
    public static boolean isSinglePointFormat(String coordinatesStr) {
        return coordinatesStr != null && !coordinatesStr.contains(",");
    }

    private static Coordinates parseSinglePoint(String[] parts) {
        try {
            double lng = Double.parseDouble(parts[0].trim());
            double lat = Double.parseDouble(parts[1].trim());
            Coordinates coordinates = new Coordinates();
            coordinates.setLng(lng);
            coordinates.setLat(lat);
            return coordinates;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static Coordinates transformCoordinates(
            double baseLongitude,
            double baseLatitude,
            double x,
            double y,
            double scaleX,
            double scaleY
    ) {
        return transformCoordinates(baseLongitude, baseLatitude, x, y, scaleX, scaleY, 0.0, 1.0);
    }

    /**
     * 로컬 shape 좌표(x,y)를 회전(rotationRad)·축척(scale) 적용 후 기준점(baseLongitude, baseLatitude)
     * 기준으로 WGS84 변환. rotationRad=0, scale=1 이면 기존(순수 평행이동)과 동일.
     */
    public static Coordinates transformCoordinates(
            double baseLongitude,
            double baseLatitude,
            double x,
            double y,
            double scaleX,
            double scaleY,
            double rotationRad,
            double scale
    ) {
        double cos = Math.cos(rotationRad);
        double sin = Math.sin(rotationRad);
        double rx = (x * cos - y * sin) * scale;
        double ry = (x * sin + y * cos) * scale;
        Coordinates coordinates = new Coordinates();
        coordinates.setLat(baseLatitude + ry * scaleY);
        coordinates.setLng(baseLongitude + rx * scaleX);
        return coordinates;
    }

    public static List<Coordinates> parseAndTransform(
            String input, double baseLongitude, double baseLatitude
    ) {
        return parseAndTransform(input, baseLongitude, baseLatitude, 0.0, 1.0);
    }

    public static List<Coordinates> parseAndTransform(
            String input, double baseLongitude, double baseLatitude, double rotationRad, double scale
    ) {
        List<Coordinates> relativeCoords = parse(input);
        if (relativeCoords.isEmpty()) {
            return Collections.emptyList();
        }

        return relativeCoords.stream()
                .map(relative -> transformCoordinates(
                        baseLongitude, baseLatitude,
                        relative.getLng(), relative.getLat(),
                        SCALE_X, SCALE_Y, rotationRad, scale))
                .collect(Collectors.toList());
    }

    /**
     * WGS84 점(lng,lat)을 특정 (baseLongitude,baseLatitude,rotationRad,scale) 정변환의 역변환으로
     * 로컬 shape 좌표(x,y)로 되돌린다. 2점 캘리브레이션에서 "현재 지도에 표시된 점"이 원래 로컬
     * shape 좌표계의 어느 지점이었는지 역산할 때 사용 — 이전에 회전/축척이 이미 적용돼 있어도
     * (curRotationRad, curScale 을 그대로 넘기면) 정확히 역산된다.
     *
     * @return double[]{x, y} 로컬 shape 좌표
     */
    public static double[] inverseTransform(
            double baseLongitude, double baseLatitude, double lng, double lat, double rotationRad, double scale
    ) {
        double rx = (lng - baseLongitude) / SCALE_X;
        double ry = (lat - baseLatitude) / SCALE_Y;
        double cos = Math.cos(rotationRad);
        double sin = Math.sin(rotationRad);
        double x = (rx * cos + ry * sin) / scale;
        double y = (-rx * sin + ry * cos) / scale;
        return new double[]{x, y};
    }

    /**
     * WGS84 다중 좌표(링크 등)를 network.xml의 shape 속성 형식("x,y x,y ...", 소수 5자리)으로
     * 인코딩 — inverseTransform의 역방향 짝. KtdbNetworkConverter.buildShape와 동일 포맷.
     */
    public static String encodeShape(
            List<Coordinates> coords, double baseLongitude, double baseLatitude, double rotationRad, double scale
    ) {
        if (coords == null || coords.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Coordinates c : coords) {
            if (c == null || c.getLng() == null || c.getLat() == null) continue;
            double[] xy = inverseTransform(baseLongitude, baseLatitude, c.getLng(), c.getLat(), rotationRad, scale);
            if (sb.length() > 0) sb.append(' ');
            sb.append(String.format("%.5f", xy[0])).append(',').append(String.format("%.5f", xy[1]));
        }
        return sb.toString();
    }

    /**
     * WGS84 단일 좌표(노드 center)를 network.xml의 center 속성 형식("x y", 콤마 없이 공백
     * 구분, 소수 3자리)으로 인코딩 — KtdbNetworkConverter.setCenter와 동일 포맷(isSinglePointFormat
     * 이 콤마 없는 문자열을 단일 포인트로 판별하므로 shape 와 구분됨).
     */
    public static String encodeCenter(
            Coordinates c, double baseLongitude, double baseLatitude, double rotationRad, double scale
    ) {
        if (c == null || c.getLng() == null || c.getLat() == null) return "";
        double[] xy = inverseTransform(baseLongitude, baseLatitude, c.getLng(), c.getLat(), rotationRad, scale);
        return String.format("%.3f", xy[0]) + " " + String.format("%.3f", xy[1]);
    }
}
