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

//                if (geometry != null && "LineString".equals(geometry.get("type").asText())) {
//                    List<Cartesian3> positions = new ArrayList<>();
//                    for (JsonNode coord : geometry.get("coordinates")) {
//                        double x = coord.get(0).asDouble();
//                        double y = coord.get(1).asDouble();
//                        double z = coord.size() > 2 ? coord.get(2).asDouble() : 0; // 높이 값이 없는 경우 0 설정
//                        positions.add(new Cartesian3(x, y, z));
//                    }
//
//                    // ✅ Polyline 객체 생성
//                    Polyline polyline = new Polyline(positions);
//
//                    // ✅ Road 객체에 Polyline 저장
//                    Road road = new Road(polyline);
//                    road.setPolyline(polyline);
//                    roads.add(road);
//                }
                if (geometry != null && "MultiLineString".equals(geometry.get("type").asText())) {
                    List<Cartesian3> positions = new ArrayList<>();
                    for (JsonNode coord : geometry.get("coordinates").get(0)) {
                        double x = coord.get(0).asDouble();
                        double y = coord.get(1).asDouble();
                        double z = coord.size() > 2 ? coord.get(2).asDouble() : 0;
                        positions.add(new Cartesian3(x, y, z));
                    }

                    String linkId = properties.has("link_id") ? properties.get("link_id").asText() : null;
                    String laneId = properties.has("lane_id") ? properties.get("lane_id").asText() : null;

                    Double baseLon = properties.has("base_lon") ? properties.get("base_lon").asDouble() : null;
                    Double baseLat = properties.has("base_lat") ? properties.get("base_lat").asDouble() : null;

                    Polyline polyline = new Polyline(positions);

                    Road road = new Road(linkId, laneId, polyline, baseLon, baseLat);  // linkId와 polyline을 전달
                    roads.add(road);
                }
            }
        }

        return roads;
    }
}


