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
                if (geometry != null && properties != null) {
                    String featureType = properties.has("type") ? properties.get("type").asText() : "";

                    if (!"lane".equals(featureType)) {
                        continue;
                    }

                    String geometryType = geometry.get("type").asText();

                    List<Cartesian3> positions = new ArrayList<>();

                    if ("LineString".equals(geometryType)) {
                        for (JsonNode coord : geometry.get("coordinates")) {
                            double x = coord.get(0).asDouble();
                            double y = coord.get(1).asDouble();
                            double z = coord.size() > 2 ? coord.get(2).asDouble() : 0;
                            positions.add(new Cartesian3(x, y, z));
                        }
                    }
//                    else if ("MultiLineString".equals(geometryType)) {
//                        for (JsonNode coord : geometry.get("coordinates").get(0)) {
//                            double x = coord.get(0).asDouble();
//                            double y = coord.get(1).asDouble();
//                            double z = coord.size() > 2 ? coord.get(2).asDouble() : 0;
//                            positions.add(new Cartesian3(x, y, z));
//                        }
//                    }

                    if (!positions.isEmpty()) {
                        String linkId = properties.has("link_id") ? properties.get("link_id").asText() : null;
                        String laneId = properties.has("lane_id") ? properties.get("lane_id").asText() : null;

                        Double baseLon = properties.has("base_lon") ? properties.get("base_lon").asDouble() : null;
                        Double baseLat = properties.has("base_lat") ? properties.get("base_lat").asDouble() : null;

                        Polyline polyline = new Polyline(positions);
                        Road road = new Road(linkId, laneId, polyline, baseLon, baseLat);
                        roads.add(road);
                    }
                }
            }
        }
        return roads;
    }


}


