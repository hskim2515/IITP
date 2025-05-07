package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleState;
import org.w3c.dom.*;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class VehicleParserUtil {

//    public static List<VehicleState> parseDebugging(InputStream debuggingStream) {
//        List<VehicleState> vehicles = new ArrayList<>();
//        try {
//            Document doc = loadXML(debuggingStream);
//            NodeList nodes = doc.getElementsByTagName("veh");
//            for (int i = 0; i < nodes.getLength(); i++) {
//                Element e = (Element) nodes.item(i);
//                VehicleState v = new VehicleState();
//                v.setId(e.getAttribute("id"));
//                v.setTimestep(parseDouble(e.getAttribute("timestep")));
//                v.setLinkId(e.getAttribute("linkId"));
//                v.setLaneId(e.getAttribute("laneId"));
//                v.setPosX(parseDouble(e.getAttribute("posX")));
//                v.setPosY(parseDouble(e.getAttribute("posY")));
//                v.setSpeed(parseDouble(e.getAttribute("spd")));
//                v.setAcceleration(parseDouble(e.getAttribute("acc")));
//                v.setSpacing(parseDouble(e.getAttribute("spacing")));
//                v.setMode(e.getAttribute("mode"));
//                v.setLeaderId(e.getAttribute("leaderId"));
//                v.setLeaderSpeed(parseDouble(e.getAttribute("leaderSpd")));
//                v.setTargetLaneId(e.getAttribute("targetlaneId"));
//                v.setSimMode(e.getAttribute("simMode"));
//                v.setSrc(e.getAttribute("src"));
//                v.setSink(e.getAttribute("sink"));
//                v.setNewSink(e.getAttribute("newSink"));
//                v.setV2x(e.getAttribute("v2x"));
//                v.setV2xMsgType(e.getAttribute("v2xMsgType"));
//                v.setV2xValue(parseDouble(e.getAttribute("v2xValue")));
//                vehicles.add(v);
//            }
//        } catch (Exception ignored) {}
//        return vehicles;
//    }

//    public static List<VehicleState> parseStatistics(InputStream statisticsStream) {
//        List<VehicleState> vehicles = new ArrayList<>();
//        try {
//            Document doc = loadXML(statisticsStream);
//            NodeList vehNodes = doc.getElementsByTagName("veh");
//            for (int i = 0; i < vehNodes.getLength(); i++) {
//                Element e = (Element) vehNodes.item(i);
//                VehicleState v = new VehicleState();
//                v.setId(e.getAttribute("id"));
//                v.setSrc(e.getAttribute("src"));
//                v.setSink(e.getAttribute("sink"));
//                v.setNewSink(e.getAttribute("newSink"));
//                v.setAvgSpeed(parseDouble(e.getAttribute("avgSpeed")));
//                v.setTravelTime(parseDouble(e.getAttribute("travelTime")));
//                v.setTravelDistance(parseDouble(e.getAttribute("travelDistance")));
//                v.setDelayTime(parseDouble(e.getAttribute("delayTime")));
//                v.setTravelCost(parseInt(e.getAttribute("travelCost")));
//
//                NodeList linkNodes = e.getElementsByTagName("link");
//                if (linkNodes.getLength() > 0) {
//                    Element link = (Element) linkNodes.item(0);
//                    v.setLinkId(link.getAttribute("linkId"));
//                    v.setArrivalTime(parseDouble(link.getAttribute("arrivalTime")));
//                    v.setDepartureTime(parseDouble(link.getAttribute("departureTime")));
//                    v.setFinancialCost(parseInt(link.getAttribute("financialCost")));
//                }
//                vehicles.add(v);
//            }
//        } catch (Exception ignored) {}
//        return vehicles;
//    }

    public static List<VehicleState> parseVisualizer(InputStream visualizerStream) {
        List<VehicleState> vehicles = new ArrayList<>();
        try {
            Document doc = loadXML(visualizerStream);
            NodeList nodes = doc.getElementsByTagName("veh");
            for (int i = 0; i < nodes.getLength(); i++) {
                Element e = (Element) nodes.item(i);
                VehicleState v = new VehicleState();
                v.setId(e.getAttribute("id"));
                v.setTimestep(parseDouble(e.getAttribute("timestep")));
                v.setLinkId(e.getAttribute("link_id"));
                v.setLaneId(e.getAttribute("lane_id"));
                v.setPosX(parseDouble(e.getAttribute("pos_x")));
                v.setPosY(parseDouble(e.getAttribute("pos_y")));
                vehicles.add(v);
            }
        } catch (Exception ignored) {}
        return vehicles;
    }

    // Document 객체 생성 메서드 (InputStream을 사용하여 XML 로드)
    private static Document loadXML(InputStream stream) throws Exception {
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(stream);
    }

    // Double 값 파싱 (빈값이나 None 처리)
    private static double parseDouble(String value) {
        if (value == null || value.isEmpty() || value.equals("None")) return -1;
        try {
            return Double.parseDouble(value);
        } catch (Exception e) {
            return 0;
        }
    }

    // Integer 값 파싱 (빈값 처리)
    private static int parseInt(String value) {
        if (value == null || value.isEmpty()) return 0;
        try {
            return Integer.parseInt(value);
        } catch (Exception e) {
            return 0;
        }
    }
}
