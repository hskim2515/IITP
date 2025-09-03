package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.geometry.Coordinates;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

public class CoordinateUtils {

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
        Coordinates coordinates = new Coordinates();
        coordinates.setLat(baseLatitude + y * scaleY);
        coordinates.setLng(baseLongitude + x * scaleX);
        return coordinates;
    }

    public static List<Coordinates> parseAndTransform(
            String input, double baseLongitude, double baseLatitude,
            double scaleX, double scaleY
    ) {
        List<Coordinates> relativeCoords = parse(input);
        if (relativeCoords.isEmpty()) {
            return Collections.emptyList();
        }

        return relativeCoords.stream()
                .map(relative -> transformCoordinates(
                        baseLongitude, baseLatitude,
                        relative.getLng(), relative.getLat(),
                        scaleX, scaleY))
                .collect(Collectors.toList());
    }
}
