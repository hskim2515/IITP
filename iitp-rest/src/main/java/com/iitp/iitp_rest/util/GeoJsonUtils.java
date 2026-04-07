package com.iitp.iitp_rest.util;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
import com.iitp.iitp_rest.model.geometry.Cartesian3;
import com.iitp.iitp_rest.model.geometry.Polyline;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

            // 1st pass: from_link halfWidth 맵 + shape 맵 구성 (connection 파싱에서 사용)
            Map<String, Double> linkHalfWidthMap = new HashMap<>();
            Map<String, List<double[]>> linkShapeMap = new HashMap<>();
            for (int i = 0; i < linkList.getLength(); i++) {
                Element el = (Element) linkList.item(i);
                String lid = el.getAttribute("id");
                double w = 0;
                try { w = Double.parseDouble(el.getAttribute("width")); } catch (NumberFormatException ignored) {}
                linkHalfWidthMap.put(lid, w / 2.0);

                String shStr = el.getAttribute("shape");
                if (shStr != null && !shStr.isEmpty()) {
                    List<double[]> pts = new ArrayList<>();
                    for (String cp : shStr.trim().split(" ")) {
                        String[] xy = cp.split(",");
                        if (xy.length >= 2) pts.add(new double[]{Double.parseDouble(xy[0]), Double.parseDouble(xy[1])});
                    }
                    if (!pts.isEmpty()) linkShapeMap.put(lid, pts);
                }
            }

            for (int i = 0; i < linkList.getLength(); i++) {
                Element linkElement = (Element) linkList.item(i);
                String linkId = linkElement.getAttribute("id");

                // pos_x/pos_y는 링크 기준 좌표계 (link-local frame)이므로 link shape 사용
                String shapeStr = linkElement.getAttribute("shape");
                double width = 0;
                int numLane = 1;
                try { width = Double.parseDouble(linkElement.getAttribute("width")); } catch (NumberFormatException ignored) {}
                try { numLane = Integer.parseInt(linkElement.getAttribute("num_lane")); } catch (NumberFormatException ignored) {}
                double halfWidth = width / 2.0;

                Double baseEasting = null;
                Double baseNorthing = null;
                Double targetEasting = null;
                Double targetNorthing = null;
                List<Cartesian3> positions = new ArrayList<>();

                if (shapeStr != null && !shapeStr.isEmpty()) {
                    String[] coords = shapeStr.trim().split(" ");
                    if (coords.length >= 2) {
                        String[] firstCoord = coords[0].split(",");
                        String[] lastCoord = coords[coords.length - 1].split(",");
                        if (firstCoord.length >= 2) {
                            baseEasting = Double.parseDouble(firstCoord[0]);
                            baseNorthing = Double.parseDouble(firstCoord[1]);
                        }
                        if (lastCoord.length >= 2) {
                            targetEasting = Double.parseDouble(lastCoord[0]);
                            targetNorthing = Double.parseDouble(lastCoord[1]);
                        }
                        for (String coordPair : coords) {
                            String[] xy = coordPair.split(",");
                            if (xy.length >= 2) {
                                positions.add(new Cartesian3(Double.parseDouble(xy[0]), Double.parseDouble(xy[1]), 0));
                            }
                        }
                    }
                }

                if (!positions.isEmpty()) {
                    Polyline polyline = new Polyline(positions);
                    RoadResponse.Road road = new RoadResponse.Road(linkId, null, polyline, baseEasting, baseNorthing, targetEasting, targetNorthing, halfWidth, numLane, null);
                    roads.add(road);
                }
            }

            // 교차로 connection 파싱: DB에서 node_id를 link_id로 사용하는 구간 처리
            // lane_id = connection id, pos_x = connection shape 기준 진행 거리
            NodeList nodeList = doc.getElementsByTagName("node");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeElement = (Element) nodeList.item(i);
                String nodeId = nodeElement.getAttribute("id");

                NodeList connList = nodeElement.getElementsByTagName("connection");
                for (int j = 0; j < connList.getLength(); j++) {
                    Element connElement = (Element) connList.item(j);
                    String connId      = connElement.getAttribute("id");
                    String connShape   = connElement.getAttribute("shape");
                    String fromLinkId  = connElement.getAttribute("from_link");
                    String toLinkId    = connElement.getAttribute("to_link");
                    String turning     = connElement.getAttribute("turning"); // "S", "R", "L"

                    if (connShape == null || connShape.isEmpty()) continue;
                    String[] coords = connShape.trim().split(" ");
                    if (coords.length < 2) continue;

                    String[] first = coords[0].split(",");
                    String[] last  = coords[coords.length - 1].split(",");
                    if (first.length < 2 || last.length < 2) continue;

                    double bx = Double.parseDouble(first[0]);
                    double by = Double.parseDouble(first[1]);
                    double tx = Double.parseDouble(last[0]);
                    double ty = Double.parseDouble(last[1]);

                    double fromLinkHalfWidth = linkHalfWidthMap.getOrDefault(fromLinkId, 0.0);

                    List<Cartesian3> connPositions = new ArrayList<>();
                    for (String cp : coords) {
                        String[] xy = cp.split(",");
                        if (xy.length >= 2)
                            connPositions.add(new Cartesian3(Double.parseDouble(xy[0]), Double.parseDouble(xy[1]), 0));
                    }
                    Polyline polyline = new Polyline(connPositions);

                    // non-straight connection: 노드 center를 Bezier 제어점으로 사용 (항상 안정적)
                    List<double[]> bezierShape = null;
                    if (!"S".equals(turning)) {
                        String centerAttr = nodeElement.getAttribute("center");
                        if (centerAttr != null && !centerAttr.isBlank()) {
                            String[] centerParts = centerAttr.trim().split("\\s+");
                            if (centerParts.length >= 2) {
                                double cpx = Double.parseDouble(centerParts[0]);
                                double cpy = Double.parseDouble(centerParts[1]);

                                // effectiveControl = mid + (control - mid) * 0.9
                                double midx = (bx + tx) / 2, midy = (by + ty) / 2;
                                double ecpx = midx + (cpx - midx) * 0.4;
                                double ecpy = midy + (cpy - midy) * 0.4;

                                int N = 20;
                                bezierShape = new ArrayList<>(N + 1);
                                for (int k = 0; k <= N; k++) {
                                    double t2 = (double) k / N;
                                    double mt = 1 - t2;
                                    double px = mt * mt * bx + 2 * t2 * mt * ecpx + t2 * t2 * tx;
                                    double py = mt * mt * by + 2 * t2 * mt * ecpy + t2 * t2 * ty;
                                    bezierShape.add(new double[]{px, py});
                                }
                            }
                        }
                    }

                    // roadMap key: "nodeId_connId"
                    roads.add(new RoadResponse.Road(nodeId + "_" + connId, null, polyline, bx, by, tx, ty, fromLinkHalfWidth, 1, bezierShape));
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
        }

        return roads;
    }

    /**
     * network.xml에서 각 링크의 차선 중심선 shape를 파싱합니다.
     * 반환: Map<link_id, Map<lane_id, List<[x, y]>>>
     */
    public static Map<String, Map<String, List<double[]>>> parseXmlToLaneShapes(InputStream xmlInputStream) {
        Map<String, Map<String, List<double[]>>> laneShapes = new HashMap<>();
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
                Map<String, List<double[]>> lanesMap = new HashMap<>();

                for (int j = 0; j < laneList.getLength(); j++) {
                    Element laneElement = (Element) laneList.item(j);
                    String laneId = laneElement.getAttribute("id");
                    String shapeStr = laneElement.getAttribute("shape");

                    List<double[]> points = new ArrayList<>();
                    if (shapeStr != null && !shapeStr.isEmpty()) {
                        for (String coordPair : shapeStr.trim().split(" ")) {
                            String[] xy = coordPair.split(",");
                            if (xy.length >= 2) {
                                points.add(new double[]{
                                    Double.parseDouble(xy[0]),
                                    Double.parseDouble(xy[1])
                                });
                            }
                        }
                    }
                    if (!points.isEmpty()) {
                        lanesMap.put(laneId, points);
                    }
                }

                if (!lanesMap.isEmpty()) {
                    laneShapes.put(linkId, lanesMap);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return laneShapes;
    }


}


