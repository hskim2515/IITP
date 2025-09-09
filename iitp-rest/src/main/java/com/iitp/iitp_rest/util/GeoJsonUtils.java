package com.iitp.iitp_rest.util;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.network.RoadResponse;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.geometry.Polyline;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class GeoJsonUtils {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public static List<RoadResponse.Road> parseGeoJsonToRoads(JsonNode geoJson) {
        List<RoadResponse.Road> roads = new ArrayList<>();

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
                        //Road road = new Road(linkId, laneId, polyline, baseLon, baseLat);
                        //roads.add(road);
                    }
                }
            }
        }
        return roads;
    }
    public static List<RoadResponse.Road> parseXmlToRoads(InputStream xmlInputStream) {
        List<RoadResponse.Road> roads = new ArrayList<>();

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(xmlInputStream);
            doc.getDocumentElement().normalize();

            NodeList linkList = doc.getElementsByTagName("link");

            for (int i = 0; i < linkList.getLength(); i++) {
                Element linkElement = (Element) linkList.item(i);
                String linkId = linkElement.getAttribute("id");

                NodeList laneList = linkElement.getElementsByTagName("lane");

                for (int j = 0; j < laneList.getLength(); j++) {
                    Element laneElement = (Element) laneList.item(j);
                    String laneId = laneElement.getAttribute("id");

                    List<Cartesian3> positions = new ArrayList<>();

                    String shapeStr = laneElement.getAttribute("shape");
                    Double baseEasting = null;
                    Double baseNorthing = null;

                    Double targetEasting = null;
                    Double targetNorthing = null;

                    if (shapeStr != null && !shapeStr.isEmpty()) {
                        String[] coords = shapeStr.trim().split(" ");
                        if (coords.length > 0) {
                            String[] firstCoord = coords[0].split(",");
                            String[] endCoord = coords[1].split(",");
                            if (firstCoord.length >= 2) {
                                baseEasting = Double.parseDouble(firstCoord[0]);
                                baseNorthing = Double.parseDouble(firstCoord[1]);
                            }
                            if(endCoord.length >= 2) {
                                targetEasting = Double.parseDouble(endCoord[0]);
                                targetNorthing = Double.parseDouble(endCoord[1]);
                            }

                            for (String coordPair : coords) {
                                String[] xy = coordPair.split(",");
                                if (xy.length >= 2) {
                                    double x = Double.parseDouble(xy[0]);
                                    double y = Double.parseDouble(xy[1]);
                                    positions.add(new Cartesian3(x, y, 0));
                                }
                            }
                        }
                    }


                    if (!positions.isEmpty()) {
                        Polyline polyline = new Polyline(positions);
                        RoadResponse.Road road = new RoadResponse.Road(linkId, laneId, polyline, baseEasting, baseNorthing, targetEasting, targetNorthing);
                        roads.add(road);
                    }
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
        }

        return roads;
    }


}


