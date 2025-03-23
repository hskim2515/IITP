package com.iitp.iitp_rest.util;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.Road;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.geometry.Polyline;
import java.util.ArrayList;
import java.util.List;

public class GeoJsonUtils {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public static List<Road> parseGeoJsonToRoads(JsonNode geoJson) {
        List<Road> roads = new ArrayList<>();

        if (geoJson.has("features") && geoJson.get("features").isArray()) {
            for (JsonNode feature : geoJson.get("features")) {
                JsonNode geometry = feature.get("geometry");
                JsonNode properties = feature.get("properties");

                if (geometry != null && "LineString".equals(geometry.get("type").asText())) {
                    List<Cartesian3> positions = new ArrayList<>();
                    for (JsonNode coord : geometry.get("coordinates")) {
                        double x = coord.get(0).asDouble();
                        double y = coord.get(1).asDouble();
                        double z = coord.size() > 2 ? coord.get(2).asDouble() : 0; // 높이 값이 없는 경우 0 설정
                        positions.add(new Cartesian3(x, y, z));
                    }

                    // ✅ Polyline 객체 생성
                    Polyline polyline = new Polyline(positions);

                    // ✅ Road 객체에 Polyline 저장
                    Road road = new Road(polyline);
                    road.setPolyline(polyline);
                    roads.add(road);
                }
            }
        }

        return roads;
    }
}


