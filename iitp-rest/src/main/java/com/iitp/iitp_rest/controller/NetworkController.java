package com.iitp.iitp_rest.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.Network;
import com.iitp.iitp_rest.model.network.*;
import com.iitp.iitp_rest.repository.NetworkRepository;
import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


@RestController
@RequestMapping("/network")
@AllArgsConstructor
public class NetworkController {

    private final NetworkRepository networkRepository;

    @GetMapping
    public ResponseEntity<NetworkData> getNetwork() {
        NetworkData result = new NetworkData();
        List<NodeData> nodes = new ArrayList<>();
        List<LinkData> links = new ArrayList<>();

        try (InputStream is = getClass().getClassLoader().getResourceAsStream("networks/network.xml")) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(is);

            // Nodes
            NodeList nodeList = doc.getElementsByTagName("node");
            for (int i = 0; i < nodeList.getLength(); i++) {
                Element nodeElement = (Element) nodeList.item(i);
                NodeData node = new NodeData();
                node.setId(nodeElement.getAttribute("id"));
                node.setType(nodeElement.getAttribute("type"));
                node.setNumPort(Integer.parseInt(nodeElement.getAttribute("num_port")));
                node.setNumConnection(Integer.parseInt(nodeElement.getAttribute("num_connection")));
                node.setXCoord(Double.parseDouble(nodeElement.getAttribute("x_coord")));
                node.setYCoord(Double.parseDouble(nodeElement.getAttribute("y_coord")));

                // Ports
                NodeList portList = nodeElement.getElementsByTagName("port");
                for (int j = 0; j < portList.getLength(); j++) {
                    Element portElement = (Element) portList.item(j);
                    PortData port = new PortData();
                    port.setType(portElement.getAttribute("type"));
                    port.setLinkId(portElement.getAttribute("link_id"));
                    port.setDirection(portElement.getAttribute("direction"));
                    node.getPorts().add(port);
                    node.getPortLinkIds().add(port.getLinkId());
                }

                // Connections
                NodeList connList = nodeElement.getElementsByTagName("connection");
                for (int j = 0; j < connList.getLength(); j++) {
                    Element connElement = (Element) connList.item(j);
                    ConnectionData conn = new ConnectionData();
                    conn.setId(connElement.getAttribute("id"));
                    conn.setFromLink(connElement.getAttribute("from_link"));
                    conn.setFromLane(Integer.parseInt(connElement.getAttribute("from_lane")));
                    conn.setToLink(connElement.getAttribute("to_link"));
                    conn.setToLane(Integer.parseInt(connElement.getAttribute("to_lane")));
                    conn.setTurning(connElement.getAttribute("turning"));
                    conn.setLength(Double.parseDouble(connElement.getAttribute("length")));
                    conn.setWidth(Double.parseDouble(connElement.getAttribute("width")));
                    conn.setFfSpd(Double.parseDouble(connElement.getAttribute("ff_spd")));
                    node.getConnections().add(conn);
                }

                nodes.add(node);
            }

            // Links
            NodeList linkList = doc.getElementsByTagName("link");
            for (int i = 0; i < linkList.getLength(); i++) {
                Element linkElement = (Element) linkList.item(i);
                LinkData link = new LinkData();
                link.setId(linkElement.getAttribute("id"));
                link.setFromNode(linkElement.getAttribute("from_node"));
                link.setToNode(linkElement.getAttribute("to_node"));
                link.setNumLane(Integer.parseInt(linkElement.getAttribute("num_lane")));
                link.setLength(Double.parseDouble(linkElement.getAttribute("length")));
                link.setWidth(Double.parseDouble(linkElement.getAttribute("width")));
                link.setMinSpd(Double.parseDouble(linkElement.getAttribute("min_spd")));
                link.setMaxSpd(Double.parseDouble(linkElement.getAttribute("max_spd")));
                link.setFfSpd(Double.parseDouble(linkElement.getAttribute("ff_spd")));
                link.setWaveSpd(Double.parseDouble(linkElement.getAttribute("wave_spd")));
                link.setQmax(Double.parseDouble(linkElement.getAttribute("qmax")));
                link.setMaxVeh(Double.parseDouble(linkElement.getAttribute("max_veh")));
                link.setSimType(Integer.parseInt(linkElement.getAttribute("sim_type")));
                link.setType(linkElement.getAttribute("type"));
                link.setLayer(linkElement.getAttribute("layer"));
                link.setStopLine(Double.parseDouble(linkElement.getAttribute("stop_line")));
                link.setShape(linkElement.getAttribute("shape"));

                // Lanes
                NodeList laneList = linkElement.getElementsByTagName("lane");
                for (int j = 0; j < laneList.getLength(); j++) {
                    Element laneElement = (Element) laneList.item(j);
                    LaneData lane = new LaneData();
                    lane.setId(laneElement.getAttribute("id"));
                    lane.setNumCell(Integer.parseInt(laneElement.getAttribute("num_cell")));
                    lane.setLeftLaneId(laneElement.getAttribute("left_lane_id"));
                    lane.setRightLaneId(laneElement.getAttribute("right_lane_id"));

                    // Cells
                    NodeList cellList = laneElement.getElementsByTagName("cell");
                    for (int k = 0; k < cellList.getLength(); k++) {
                        Element cellElement = (Element) cellList.item(k);
                        CellData cell = new CellData();
                        cell.setId(cellElement.getAttribute("id"));
                        cell.setLength(Double.parseDouble(cellElement.getAttribute("length")));
                        cell.setOffset(Double.parseDouble(cellElement.getAttribute("offset")));
                        lane.getCells().add(cell);
                    }

                    // Segments
                    NodeList segList = laneElement.getElementsByTagName("segment");
                    for (int k = 0; k < segList.getLength(); k++) {
                        Element segElement = (Element) segList.item(k);
                        SegmentData seg = new SegmentData();
                        seg.setId(segElement.getAttribute("id"));
                        seg.setBlock(Boolean.parseBoolean(segElement.getAttribute("block")));
                        seg.setInitPoint(Double.parseDouble(segElement.getAttribute("init_point")));
                        seg.setEndPoint(Double.parseDouble(segElement.getAttribute("end_point")));
                        seg.setRightLc(segElement.getAttribute("right_lc"));
                        seg.setLeftLc(segElement.getAttribute("left_lc"));
                        lane.getSegments().add(seg);
                    }

                    link.getLanes().add(lane);
                }

                links.add(link);
            }

            result.setNodes(nodes);
            result.setLinks(links);
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private String findToNode(List<NodeData> nodes, String linkId) {
        for (NodeData node : nodes) {
            if (node.portLinkIds.contains(linkId)) {
                return node.id;
            }
        }
        return null;
    }

    @PostMapping("/save")
    public ResponseEntity<String> saveGeoJson(@RequestBody String geoJson) {
        try {
            JsonNode geojsonNode = new ObjectMapper().readTree(geoJson);  // GeoJSON 문자열을 JsonNode로 변환
            Network network = new Network();
            network.setName("Network 1");
            network.setGeojson(geojsonNode);
            networkRepository.save(network);
            return ResponseEntity.ok("GeoJSON data saved successfully");
        } catch (IOException e) {
            return ResponseEntity.status(500).body("Error parsing GeoJSON data");
        }
    }

    @GetMapping("/get/{id}")
    public ResponseEntity<JsonNode> getGeoJson(@PathVariable Long id) {
        Network network = networkRepository.findById(id).orElse(null);
        if (network == null) {
            return ResponseEntity.status(404).body(null);
        }
        return ResponseEntity.ok(network.getGeojson());  // 저장된 GeoJSON 데이터를 반환
    }
}
