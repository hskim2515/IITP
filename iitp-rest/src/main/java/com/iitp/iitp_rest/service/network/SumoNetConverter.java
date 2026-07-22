package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.cell.CellXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkType;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.link.SimType;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.port.PortType;
import com.iitp.iitp_rest.model.network.port.PortXml;
import com.iitp.iitp_rest.model.signal.SignalResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.util.*;

/**
 * SUMO net.xml → NetworkXml + List<SignalResponse> 변환기
 *
 * 좌표 변환: SUMO 로컬(m) → WGS84 선형 보간 → 우리 로컬(m)
 * 신호 추출: junction type="traffic_light" + connection tl 속성 파싱
 */
@Slf4j
@Service
public class SumoNetConverter {

    public record ConvertResult(NetworkXml networkXml, List<SignalResponse> signals) {}

    // ── CTM 파라미터 ──────────────────────────────────────────────────────────
    private static final double SCALE_X       = 88000.0;
    private static final double SCALE_Y       = 111000.0;
    private static final double BASE_CELL_LEN = 69.44;
    private static final double JAM_DENSITY   = 150.0;

    private static final Map<String, double[]> ROAD_DEF = new LinkedHashMap<>();
    static {
        ROAD_DEF.put("motorway",       new double[]{100, 100, 6.00, 2400, 3, 3.5});
        ROAD_DEF.put("motorway_link",  new double[]{ 60,  60, 5.00, 1800, 1, 3.5});
        ROAD_DEF.put("trunk",          new double[]{ 80,  80, 5.50, 2200, 2, 3.5});
        ROAD_DEF.put("trunk_link",     new double[]{ 60,  60, 5.00, 1800, 1, 3.5});
        ROAD_DEF.put("primary",        new double[]{ 60,  60, 4.95, 1800, 2, 3.5});
        ROAD_DEF.put("primary_link",   new double[]{ 50,  50, 4.00, 1800, 1, 3.5});
        ROAD_DEF.put("secondary",      new double[]{ 50,  50, 3.62, 1800, 2, 3.5});
        ROAD_DEF.put("secondary_link", new double[]{ 40,  40, 3.19, 1800, 1, 3.5});
        ROAD_DEF.put("tertiary",       new double[]{ 40,  40, 3.00, 1800, 1, 3.5});
        ROAD_DEF.put("tertiary_link",  new double[]{ 30,  30, 2.50,  900, 1, 3.0});
        ROAD_DEF.put("residential",    new double[]{ 30,  30, 2.36,  900, 1, 3.0});
        ROAD_DEF.put("unclassified",   new double[]{ 30,  30, 2.36,  900, 1, 3.0});
        ROAD_DEF.put("service",        new double[]{ 20,  20, 2.00,  600, 1, 3.0});
        ROAD_DEF.put("_default",       new double[]{ 30,  30, 2.36,  900, 1, 3.5});
    }

    // ── 내부 파싱 레코드 ──────────────────────────────────────────────────────
    /**
     * netOffset: SUMO(0,0) → UTM 변환 시의 offset
     *   utm_x = sumo_x - netOffsetX  (netOffset이 음수이므로 실제로는 +)
     *   utm_y = sumo_y - netOffsetY
     * utmZone: projParameter에서 추출한 UTM 존 번호
     * northern: 북반구 여부
     */
    private record LocationInfo(double netOffsetX, double netOffsetY,
                                 int utmZone, boolean northern) {}
    private record LaneInfo(int index, double speed, double length, String shape) {}
    private record EdgeInfo(String sumoId, String fromJunction, String toJunction,
                             String edgeType, List<LaneInfo> lanes) {}
    private record JunctionInfo(String sumoId, String type, double x, double y) {}
    private record ConnInfo(String fromEdge, int fromLane, String toEdge, int toLane, String dir) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    public ConvertResult convert(byte[] sumoNetXml, double baseLat, double baseLon, int networkId) throws Exception {
        Document doc = parseXml(sumoNetXml);

        LocationInfo loc = parseLocation(doc);
        Map<String, JunctionInfo> junctions = parseJunctions(doc);
        Map<String, EdgeInfo>     edges     = parseEdges(doc);
        Map<String, List<ConnInfo>> connsByJunction = parseConnections(doc, edges);

        // 노드별 in/out 링크 목록
        Map<String, List<String>> inEdges  = new LinkedHashMap<>();
        Map<String, List<String>> outEdges = new LinkedHashMap<>();
        for (EdgeInfo e : edges.values()) {
            if (junctions.containsKey(e.fromJunction()))
                outEdges.computeIfAbsent(e.fromJunction(), k -> new ArrayList<>()).add(e.sumoId());
            if (junctions.containsKey(e.toJunction()))
                inEdges.computeIfAbsent(e.toJunction(), k -> new ArrayList<>()).add(e.sumoId());
        }

        // Link/Node ID 재부여 (Network ID naming 스펙) — Link=2, Node(교차로)=1,
        // Terminal(출입구)=11 로 시작하는 8자리 숫자. Link와 일반 Node는 생성 순서(=엣지
        // 원본 순서로 스캔)에 따라 하나의 인덱스를 공유하고, Terminal은 연결된 단 하나의
        // Link와 뒷자리 3자리가 동일해야 한다 — 엣지를 스캔하며 그 자리에서 endpoint
        // junction을 처음 만나면 바로 배정하면 두 규칙을 한 번에 만족한다.
        Map<String, Long> nodeIdMap = new LinkedHashMap<>();
        Map<String, Long> linkIdMap = new LinkedHashMap<>();
        NetworkIdAssigner idAssigner = new NetworkIdAssigner();
        for (EdgeInfo e : edges.values()) {
            long linkId = idAssigner.nextLinkId();
            linkIdMap.put(e.sumoId(), linkId);
            // 양 끝이 둘 다 터미널(고립된 신규 세그먼트 등)이면 뒷자리 파생은 한쪽에만 적용 —
            // 안 그러면 둘 다 같은 링크에서 파생돼 서로 다른 두 junction이 같은 id를 갖게 됨.
            boolean derivedTerminalUsed = false;
            for (String juncId : new String[]{e.fromJunction(), e.toJunction()}) {
                if (juncId == null || !junctions.containsKey(juncId) || nodeIdMap.containsKey(juncId)) continue;
                JunctionInfo junc = junctions.get(juncId);
                int total = inEdges.getOrDefault(juncId, List.of()).size()
                          + outEdges.getOrDefault(juncId, List.of()).size();
                boolean terminal = total <= 1 || "dead_end".equals(junc.type());
                if (!terminal) {
                    nodeIdMap.put(juncId, idAssigner.nextNormalNodeId());
                } else if (!derivedTerminalUsed) {
                    nodeIdMap.put(juncId, idAssigner.terminalIdFor(linkId));
                    derivedTerminalUsed = true;
                } else {
                    nodeIdMap.put(juncId, idAssigner.nextIsolatedTerminalId());
                }
            }
        }
        // 어느 엣지에도 연결되지 않은 고립 junction(비정상 데이터) — 페어링할 Link가 없어 fallback
        for (String juncId : junctions.keySet()) {
            nodeIdMap.putIfAbsent(juncId, idAssigner.nextIsolatedTerminalId());
        }

        // connection key → 우리 ID 매핑 (신호 추출에 사용)
        Map<String, Long> connKeyToId = new HashMap<>();

        // ── 노드 생성 ─────────────────────────────────────────────────────────
        List<NodeXml> nodeList = new ArrayList<>();
        for (JunctionInfo junc : junctions.values()) {
            Long ourId = nodeIdMap.get(junc.sumoId());
            List<String> ins  = inEdges.getOrDefault(junc.sumoId(), List.of());
            List<String> outs = outEdges.getOrDefault(junc.sumoId(), List.of());
            double[] lxy = sumoToLocal(junc.x(), junc.y(), loc, baseLat, baseLon);

            NodeXml node = new NodeXml();
            node.setId(ourId);
            node.setType(classifyNodeType(ins.size(), outs.size()));
            node.setCenter(fmt3(lxy[0]) + " " + fmt3(lxy[1]));

            List<PortXml> ports = new ArrayList<>();
            for (String eid : ins)  ports.add(makePort(PortType.in,  linkIdMap.get(eid)));
            for (String eid : outs) ports.add(makePort(PortType.out, linkIdMap.get(eid)));
            node.setPorts(ports);
            node.setNumPort(ports.size());

            List<ConnectionXml> conns = buildConnections(
                    connsByJunction.getOrDefault(junc.sumoId(), List.of()),
                    edges, linkIdMap, loc, baseLat, baseLon, connKeyToId);
            node.setConnections(conns);
            node.setNumConnection(conns.size());

            nodeList.add(node);
        }

        // ── 링크 생성 ─────────────────────────────────────────────────────────
        List<LinkXml> linkList = new ArrayList<>();
        for (EdgeInfo edge : edges.values()) {
            Long ourLinkId  = linkIdMap.get(edge.sumoId());
            Long fromNodeId = nodeIdMap.get(edge.fromJunction());
            Long toNodeId   = nodeIdMap.get(edge.toJunction());
            if (fromNodeId == null || toNodeId == null) continue;

            String hwType  = extractHighwayType(edge.edgeType());
            double[] defs  = roadDefs(hwType);
            int numLanes   = edge.lanes().size();
            double speedMs = edge.lanes().isEmpty() ? 30.0 / 3.6 : edge.lanes().get(0).speed();
            double length  = edge.lanes().isEmpty() ? 10.0 : edge.lanes().get(0).length();

            double maxSpd  = round1(speedMs * 3.6);
            double ffSpd   = Math.min(maxSpd, defs[1]);
            double waveSpd = defs[2];
            double qmax    = defs[3] * numLanes;
            double width   = round1(numLanes * defs[5]);
            double maxVeh  = round2(length / 1000.0 * JAM_DENSITY * numLanes);
            String linkShape = edge.lanes().isEmpty() ? ""
                    : convertShape(edge.lanes().get(0).shape(), loc, baseLat, baseLon);

            LinkXml link = new LinkXml();
            link.setId(ourLinkId);
            link.setFromNode(fromNodeId);
            link.setToNode(toNodeId);
            link.setNumLane(numLanes);
            link.setLength(round2(length));
            link.setWidth(width);
            link.setMaxSpd(maxSpd);
            link.setMinSpd(0.0);
            link.setFfSpd(round1(ffSpd));
            link.setWaveSpd(round2(waveSpd));
            link.setQmax(round1(qmax));
            link.setMaxVeh(round2(maxVeh));
            link.setSimType(SimType.Meso);
            link.setType(LinkType.straight);
            link.setLayer("");
            link.setStopLine(0.0);
            link.setShape(linkShape);
            link.setLanes(buildLanes(edge, numLanes, length, loc, baseLat, baseLon));

            linkList.add(link);
        }

        NetworkXml network = new NetworkXml();
        network.setId((long) networkId);
        network.setNodes(nodeList);
        network.setLinks(linkList);

        // ── 신호 추출 ─────────────────────────────────────────────────────────
        List<SignalResponse> signals = extractSignals(doc, nodeIdMap, connKeyToId);

        log.info("SUMO 변환 완료: 노드 {}개, 링크 {}개, 신호 connection {}개",
                nodeList.size(), linkList.size(), signals.size());
        return new ConvertResult(network, signals);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // XML 파싱
    // ─────────────────────────────────────────────────────────────────────────

    private Document parseXml(byte[] xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    private LocationInfo parseLocation(Document doc) {
        NodeList nodes = doc.getElementsByTagName("location");
        if (nodes.getLength() == 0) throw new RuntimeException("SUMO net.xml: <location> 요소 없음");
        Element el = (Element) nodes.item(0);
        String netOffsetStr = el.getAttribute("netOffset");
        String projParam    = el.getAttribute("projParameter");
        log.info("SUMO location: netOffset={}, proj={}", netOffsetStr, projParam);

        double[] netOffset = (netOffsetStr != null && !netOffsetStr.isBlank())
                ? parseDoubles(netOffsetStr) : new double[]{0.0, 0.0};
        int utmZone  = extractIntParam(projParam, "zone", 52);
        boolean northern = !projParam.contains("+south");

        return new LocationInfo(netOffset[0], netOffset[1], utmZone, northern);
    }

    private Map<String, JunctionInfo> parseJunctions(Document doc) {
        Map<String, JunctionInfo> result = new LinkedHashMap<>();
        NodeList nodes = doc.getElementsByTagName("junction");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            String id   = el.getAttribute("id");
            String type = el.getAttribute("type");
            if (id.startsWith(":") || "internal".equals(type)) continue;
            result.put(id, new JunctionInfo(id, type,
                    parseDouble(el.getAttribute("x")),
                    parseDouble(el.getAttribute("y"))));
        }
        return result;
    }

    private Map<String, EdgeInfo> parseEdges(Document doc) {
        Map<String, EdgeInfo> result = new LinkedHashMap<>();
        NodeList nodes = doc.getElementsByTagName("edge");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            String id       = el.getAttribute("id");
            String function = el.getAttribute("function");
            if (id.startsWith(":") || "internal".equals(function)) continue;

            List<LaneInfo> lanes = new ArrayList<>();
            NodeList laneNodes = el.getElementsByTagName("lane");
            for (int j = 0; j < laneNodes.getLength(); j++) {
                Element ln = (Element) laneNodes.item(j);
                lanes.add(new LaneInfo(
                        parseInt(ln.getAttribute("index")),
                        parseDouble(ln.getAttribute("speed")),
                        parseDouble(ln.getAttribute("length")),
                        ln.getAttribute("shape")));
            }
            lanes.sort(Comparator.comparingInt(LaneInfo::index));

            result.put(id, new EdgeInfo(id,
                    el.getAttribute("from"), el.getAttribute("to"),
                    el.getAttribute("type"), lanes));
        }
        return result;
    }

    private Map<String, List<ConnInfo>> parseConnections(Document doc, Map<String, EdgeInfo> edges) {
        Map<String, List<ConnInfo>> result = new LinkedHashMap<>();
        NodeList nodes = doc.getElementsByTagName("connection");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el  = (Element) nodes.item(i);
            String from = el.getAttribute("from");
            String to   = el.getAttribute("to");
            if (from.startsWith(":") || to.startsWith(":")) continue;

            EdgeInfo fromEdge = edges.get(from);
            if (fromEdge == null) continue;

            result.computeIfAbsent(fromEdge.toJunction(), k -> new ArrayList<>())
                  .add(new ConnInfo(from,
                          parseInt(el.getAttribute("fromLane")),
                          to,
                          parseInt(el.getAttribute("toLane")),
                          el.getAttribute("dir")));
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 빌더: 포트 / 연결 / 차선
    // ─────────────────────────────────────────────────────────────────────────

    private PortXml makePort(PortType type, Long linkId) {
        PortXml p = new PortXml();
        p.setType(type);
        p.setLinkId(linkId != null ? String.valueOf(linkId) : "");
        return p;
    }

    private List<ConnectionXml> buildConnections(
            List<ConnInfo> conns,
            Map<String, EdgeInfo> edges,
            Map<String, Long> linkIdMap,
            LocationInfo loc, double baseLat, double baseLon,
            Map<String, Long> connKeyToId) {

        List<ConnectionXml> result = new ArrayList<>();
        long connId = 0;

        for (ConnInfo c : conns) {
            if ("t".equalsIgnoreCase(c.dir())) continue;

            Long fromLinkId = linkIdMap.get(c.fromEdge());
            Long toLinkId   = linkIdMap.get(c.toEdge());
            if (fromLinkId == null || toLinkId == null) continue;

            Turning turning = mapDir(c.dir());
            EdgeInfo fromEdge = edges.get(c.fromEdge());
            EdgeInfo toEdge   = edges.get(c.toEdge());
            double fromSpd = laneSpeedKmh(fromEdge, c.fromLane());
            double toSpd   = laneSpeedKmh(toEdge,   c.toLane());
            double connFf  = switch (turning) {
                case Left_Turn  -> Math.min(30.0, Math.min(fromSpd, toSpd));
                case Right_Turn -> Math.min(35.0, Math.min(fromSpd, toSpd));
                default          -> Math.min(fromSpd, toSpd);
            };

            double[] from = lastPoint(fromEdge, c.fromLane(), loc, baseLat, baseLon);
            double[] to   = firstPoint(toEdge,  c.toLane(),   loc, baseLat, baseLon);
            double dx = to[0] - from[0], dy = to[1] - from[1];
            double len = Math.max(1.0, Math.sqrt(dx * dx + dy * dy));
            String shape = fmt5(from[0]) + "," + fmt5(from[1]) + " " + fmt5(to[0]) + "," + fmt5(to[1]);
            double connW = toEdge != null ? roadDefs(extractHighwayType(toEdge.edgeType()))[5] : 3.5;

            ConnectionXml conn = new ConnectionXml();
            conn.setId(connId);
            conn.setFromLink(fromLinkId);
            conn.setFromLane((long) c.fromLane());
            conn.setToLink(toLinkId);
            conn.setToLane((long) c.toLane());
            conn.setTurning(turning);
            conn.setLength(round2(len));
            conn.setWidth(connW);
            conn.setFfSpd(round2(connFf));
            conn.setShape(shape);
            result.add(conn);

            // 신호 매핑용 key 등록
            String key = c.fromEdge() + ":" + c.fromLane() + ":" + c.toEdge() + ":" + c.toLane();
            connKeyToId.put(key, connId);
            connId++;
        }
        return result;
    }

    private List<LaneXml> buildLanes(EdgeInfo edge, int numLanes, double length,
                                      LocationInfo loc, double baseLat, double baseLon) {
        List<LaneXml> result = new ArrayList<>();
        int nCells   = Math.max(1, (int) Math.ceil(length / BASE_CELL_LEN));
        double cellLen = length / nCells;

        for (LaneInfo laneInfo : edge.lanes()) {
            LaneXml lane = new LaneXml();
            lane.setId((long) laneInfo.index());
            lane.setLeftLaneId(laneInfo.index() > 0 ? String.valueOf(laneInfo.index() - 1) : "None");
            lane.setRightLaneId(laneInfo.index() < numLanes - 1 ? String.valueOf(laneInfo.index() + 1) : "None");
            lane.setRightLC(true);
            lane.setLeftLC(true);
            lane.setNumCell(nCells);
            lane.setShape(convertShape(laneInfo.shape(), loc, baseLat, baseLon));

            List<CellXml> cells = new ArrayList<>();
            double offset = 0.0;
            for (int c = 0; c < nCells; c++) {
                double clen = (c == nCells - 1) ? (length - cellLen * (nCells - 1)) : cellLen;
                CellXml cell = new CellXml();
                cell.setId((long) c);
                cell.setLength(round2(Math.max(0.01, clen)));
                cell.setOffset(round2(offset));
                cells.add(cell);
                offset += clen;
            }
            lane.setCells(cells);
            result.add(lane);
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 신호 추출
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * SUMO net.xml에서 신호 connection을 추출.
     *
     * <connection from="e1" to="e2" fromLane="0" toLane="0"
     *             tl="junctionId" linkIndex="0" dir="s" state="o"/>
     *
     * tl 속성이 있는 connection = 신호 교차로를 통과하는 회전 움직임.
     * nodeId, turnId(방향별 그룹), turning(S/L/R), connectionId를 추출.
     */
    private List<SignalResponse> extractSignals(
            Document doc,
            Map<String, Long> nodeIdMap,
            Map<String, Long> connKeyToId) {

        List<SignalResponse> signals = new ArrayList<>();
        // nodeId:direction → 이미 할당된 turnId
        Map<String, Integer> turnIdMap = new LinkedHashMap<>();

        NodeList connNodes = doc.getElementsByTagName("connection");
        for (int i = 0; i < connNodes.getLength(); i++) {
            Element el  = (Element) connNodes.item(i);
            String tl   = el.getAttribute("tl");
            if (tl.isBlank()) continue; // 신호 없는 connection

            String from = el.getAttribute("from");
            String to   = el.getAttribute("to");
            if (from.startsWith(":") || to.startsWith(":")) continue;

            Long ourNodeId = nodeIdMap.get(tl);
            if (ourNodeId == null) continue;

            int fromLane = parseInt(el.getAttribute("fromLane"));
            int toLane   = parseInt(el.getAttribute("toLane"));
            String dir   = el.getAttribute("dir");

            String connKey = from + ":" + fromLane + ":" + to + ":" + toLane;
            Long ourConnId = connKeyToId.get(connKey);
            if (ourConnId == null) continue;

            Turning turning = mapDir(dir);
            String turningVal = turning.getValue(); // "S", "L", "R"

            // 같은 노드+방향이면 같은 turnId 부여
            String turnKey = ourNodeId + ":" + turningVal;
            int turnId = turnIdMap.computeIfAbsent(turnKey, k -> turnIdMap.size());

            SignalResponse signal = new SignalResponse();
            signal.setNodeId(String.valueOf(ourNodeId));
            signal.setTurnId(String.valueOf(turnId));
            signal.setTurning(turningVal);
            signal.setType(switch (turning) {
                case Left_Turn  -> "left";
                case Right_Turn -> "right";
                default          -> "straight";
            });
            signal.setConnectionId(String.valueOf(ourConnId));
            signals.add(signal);
        }

        log.info("신호 추출: {}개 교차로, {}개 connection",
                signals.stream().map(SignalResponse::getNodeId).distinct().count(),
                signals.size());
        return signals;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 좌표 변환
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * SUMO 좌표(m) → WGS84 → 우리 로컬(m)
     * SUMO는 UTM 투영 사용: utm = sumo - netOffset
     */
    private double[] sumoToLocal(double sx, double sy, LocationInfo loc,
                                  double baseLat, double baseLon) {
        double utmX = sx - loc.netOffsetX();
        double utmY = sy - loc.netOffsetY();
        double[] wgs = utmToWgs84(utmX, utmY, loc.utmZone(), loc.northern());
        double lat = wgs[0], lon = wgs[1];
        return new double[]{(lon - baseLon) * SCALE_X, (lat - baseLat) * SCALE_Y};
    }

    /** UTM → WGS84 역변환 (Karney 알고리즘 근사) */
    private double[] utmToWgs84(double easting, double northing, int zone, boolean northern) {
        final double k0 = 0.9996, a = 6378137.0, e2 = 0.00669438;
        final double e  = Math.sqrt(e2);
        final double e1sq = e2 / (1 - e2);

        double x = easting  - 500000.0;
        double y = northern ? northing : northing - 10000000.0;

        double M   = y / k0;
        double mu  = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));
        double e1  = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
        double phi1 = mu
                + (3*e1/2    - 27*e1*e1*e1/32)   * Math.sin(2*mu)
                + (21*e1*e1/16 - 55*e1*e1*e1*e1/32) * Math.sin(4*mu)
                + (151*e1*e1*e1/96)                * Math.sin(6*mu)
                + (1097*e1*e1*e1*e1/512)           * Math.sin(8*mu);

        double sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1), tanPhi1 = Math.tan(phi1);
        double N1  = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
        double T1  = tanPhi1 * tanPhi1;
        double C1  = e1sq * cosPhi1 * cosPhi1;
        double R1  = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
        double D   = x / (N1 * k0);

        double lat = phi1
                - (N1 * tanPhi1 / R1) * (
                    D*D/2
                    - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*e1sq) * D*D*D*D/24
                    + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*e1sq - 3*C1*C1) * D*D*D*D*D*D/720);

        double lon0 = Math.toRadians((zone - 1) * 6 - 180 + 3);
        double lon  = lon0 + (
                    D
                    - (1 + 2*T1 + C1) * D*D*D/6
                    + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*e1sq + 24*T1*T1) * D*D*D*D*D/120
                ) / cosPhi1;

        return new double[]{Math.toDegrees(lat), Math.toDegrees(lon)};
    }

    private String convertShape(String sumoShape, LocationInfo loc, double baseLat, double baseLon) {
        if (sumoShape == null || sumoShape.isBlank()) return "";
        StringBuilder sb = new StringBuilder();
        for (String pt : sumoShape.trim().split("\\s+")) {
            String[] xy = pt.split(",");
            if (xy.length < 2) continue;
            double[] local = sumoToLocal(
                    Double.parseDouble(xy[0]), Double.parseDouble(xy[1]),
                    loc, baseLat, baseLon);
            if (sb.length() > 0) sb.append(' ');
            sb.append(fmt5(local[0])).append(',').append(fmt5(local[1]));
        }
        return sb.toString();
    }

    private double[] lastPoint(EdgeInfo edge, int laneIdx, LocationInfo loc, double baseLat, double baseLon) {
        if (edge == null) return new double[]{0, 0};
        LaneInfo lane = laneIdx < edge.lanes().size() ? edge.lanes().get(laneIdx) : null;
        if (lane == null || lane.shape().isBlank()) return new double[]{0, 0};
        String[] pts = lane.shape().trim().split("\\s+");
        String[] xy  = pts[pts.length - 1].split(",");
        if (xy.length < 2) return new double[]{0, 0};
        return sumoToLocal(Double.parseDouble(xy[0]), Double.parseDouble(xy[1]), loc, baseLat, baseLon);
    }

    private double[] firstPoint(EdgeInfo edge, int laneIdx, LocationInfo loc, double baseLat, double baseLon) {
        if (edge == null) return new double[]{0, 0};
        LaneInfo lane = laneIdx < edge.lanes().size() ? edge.lanes().get(laneIdx) : null;
        if (lane == null || lane.shape().isBlank()) return new double[]{0, 0};
        String[] xy = lane.shape().trim().split("\\s+")[0].split(",");
        if (xy.length < 2) return new double[]{0, 0};
        return sumoToLocal(Double.parseDouble(xy[0]), Double.parseDouble(xy[1]), loc, baseLat, baseLon);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 분류 / 조회
    // ─────────────────────────────────────────────────────────────────────────

    private NodeType classifyNodeType(int ins, int outs) {
        int total = ins + outs;
        if (total <= 1)            return NodeType.Terminal;
        if (ins == 1 && outs == 1) return NodeType.Normal;
        if (ins > outs)            return NodeType.Merging;
        if (outs > ins)            return NodeType.Diverging;
        return NodeType.Intersection;
    }

    private Turning mapDir(String dir) {
        if (dir == null) return Turning.Straight;
        return switch (dir.toLowerCase()) {
            case "l" -> Turning.Left_Turn;
            case "r" -> Turning.Right_Turn;
            default  -> Turning.Straight;
        };
    }

    private String extractHighwayType(String edgeType) {
        if (edgeType == null || edgeType.isBlank()) return "_default";
        int dot = edgeType.indexOf('.');
        return dot >= 0 ? edgeType.substring(dot + 1) : edgeType;
    }

    private double[] roadDefs(String hwType) {
        return ROAD_DEF.getOrDefault(hwType, ROAD_DEF.get("_default"));
    }

    private double laneSpeedKmh(EdgeInfo edge, int laneIdx) {
        if (edge == null || edge.lanes().isEmpty()) return 30.0;
        LaneInfo lane = laneIdx < edge.lanes().size() ? edge.lanes().get(laneIdx) : edge.lanes().get(0);
        return lane.speed() * 3.6;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // XML / 포맷 유틸
    // ─────────────────────────────────────────────────────────────────────────

    private int extractIntParam(String proj, String key, int defaultVal) {
        if (proj == null || proj.isBlank()) return defaultVal;
        String search = "+" + key + "=";
        int idx = proj.indexOf(search);
        if (idx < 0) return defaultVal;
        int start = idx + search.length();
        int end   = proj.indexOf(' ', start);
        String val = end < 0 ? proj.substring(start) : proj.substring(start, end);
        try { return Integer.parseInt(val.trim()); } catch (NumberFormatException e) { return defaultVal; }
    }

    private double[] parseDoubles(String s) {
        String[] parts = s.trim().split(",");
        double[] result = new double[parts.length];
        for (int i = 0; i < parts.length; i++) result[i] = Double.parseDouble(parts[i].trim());
        return result;
    }

    private double parseDouble(String s) {
        if (s == null || s.isBlank()) return 0.0;
        try { return Double.parseDouble(s.trim()); } catch (NumberFormatException e) { return 0.0; }
    }

    private int parseInt(String s) {
        if (s == null || s.isBlank()) return 0;
        try { return Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return 0; }
    }

    private String fmt3(double v) { return String.format("%.3f", v); }
    private String fmt5(double v) { return String.format("%.5f", v); }
    private double round1(double v) { return Math.round(v * 10.0) / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
