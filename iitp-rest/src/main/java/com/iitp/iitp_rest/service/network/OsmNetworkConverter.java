package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.osm.OsmNode;
import com.iitp.iitp_rest.model.osm.OsmWay;
import lombok.extern.log4j.Log4j2;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * OSM 데이터 → network.xml 형식의 XML 문자열 변환기
 *
 * 좌표 변환: local_x = (lon - baseLon) * 88000
 *            local_y = (lat - baseLat) * 111000
 *
 * ID 규칙 (Network ID naming 스펙, {@link NetworkIdAssigner} 참고):
 *   1xxxxxxx : 교차로/일반 노드 (2개 이상 링크 연결) — Link와 생성 순서 인덱스 공유
 *   11xxxxxx : 터미널 노드 (1개 링크만 연결, 출입구) — 연결된 Link와 뒷자리 3자리 동일
 *   2xxxxxxx : 링크
 *
 * 주의: connection의 차선별 연결은 휴리스틱 기반 → 수동 보정 권장
 */
@Log4j2
@Service
public class OsmNetworkConverter {

    // ── 좌표 변환 상수 ──────────────────────────────────────────────────────
    private static final double SCALE_X = 88000.0;  // lon → m
    private static final double SCALE_Y = 111000.0; // lat → m

    // ── CTM 파라미터 ─────────────────────────────────────────────────────────
    private static final double BASE_CELL_LEN = 69.44; // 50km/h × 5s 기준 셀 길이(m)
    private static final double JAM_DENSITY   = 150.0; // 차량밀도 (veh/km/lane)

    // ── 도로 유형별 기본값 ──────────────────────────────────────────────────
    private static final Map<String, double[]> ROAD_DEF = new LinkedHashMap<>();
    static {
        //                                   maxSpd  ffSpd  waveSpd  qmax/lane  lanes  laneW
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

    // ── 내부 그래프 엣지 ─────────────────────────────────────────────────────
    private static class GraphEdge {
        final long fromOsmId;
        final long toOsmId;
        final List<Long> shapeNodeIds; // from → ... → to
        final OsmWay way;

        GraphEdge(long fromOsmId, long toOsmId, List<Long> shapeNodeIds, OsmWay way) {
            this.fromOsmId = fromOsmId;
            this.toOsmId = toOsmId;
            this.shapeNodeIds = shapeNodeIds;
            this.way = way;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param osmNodes  Overpass 응답의 OSM 노드 목록
     * @param osmWays   Overpass 응답의 OSM way 목록
     * @param baseLat   로컬 좌표 원점 위도
     * @param baseLon   로컬 좌표 원점 경도
     * @param networkId Network 엘리먼트의 id 속성
     * @return network.xml 형식의 XML 문자열
     */
    public String convert(List<OsmNode> osmNodes, List<OsmWay> osmWays,
                          double baseLat, double baseLon, int networkId) {

        // 1. OSM 노드 맵
        Map<Long, OsmNode> nodeMap = osmNodes.stream()
                .collect(Collectors.toMap(OsmNode::getId, n -> n));

        // 2. 그래프 엣지 구성 (교차점·터미널을 노드로, 사이 geometry는 shape로)
        List<GraphEdge> edges = buildGraph(nodeMap, osmWays);
        log.info("그래프 엣지: {}개", edges.size());

        // 3. 네트워크 노드 ID 집합 (edge 출발·도착점)
        Set<Long> netOsmNodeIds = new LinkedHashSet<>();
        for (GraphEdge e : edges) {
            netOsmNodeIds.add(e.fromOsmId);
            netOsmNodeIds.add(e.toOsmId);
        }

        // 4. 각 네트워크 노드의 in/out degree
        Map<Long, Integer> inDeg  = new HashMap<>();
        Map<Long, Integer> outDeg = new HashMap<>();
        for (GraphEdge e : edges) {
            outDeg.merge(e.fromOsmId, 1, Integer::sum);
            inDeg.merge(e.toOsmId,   1, Integer::sum);
        }

        // 5+6. Link/Node ID 할당 (Network ID naming 스펙) — Link=2, Node(교차로)=1,
        // Terminal(출입구)=11 로 시작하는 8자리 숫자. Link와 일반 Node는 생성 순서(=엣지
        // 원본 순서로 스캔)에 따라 하나의 인덱스를 공유하고, Terminal은 연결된 단 하나의
        // Link와 뒷자리 3자리가 동일해야 한다 — 엣지를 스캔하며 그 자리에서 endpoint 노드를
        // 처음 만나면 바로 배정하면 두 규칙을 한 번에 만족한다.
        Map<Long, Long> nodeIdMap = new LinkedHashMap<>();
        Map<Integer, Long> edgeLinkId = new LinkedHashMap<>(); // index → linkId
        NetworkIdAssigner idAssigner = new NetworkIdAssigner();
        for (int i = 0; i < edges.size(); i++) {
            GraphEdge e = edges.get(i);
            long linkId = idAssigner.nextLinkId();
            edgeLinkId.put(i, linkId);
            // 양 끝이 둘 다 터미널(고립된 신규 세그먼트 등)이면 뒷자리 파생은 한쪽에만 적용 —
            // 안 그러면 둘 다 같은 링크에서 파생돼 서로 다른 두 노드가 같은 id를 갖게 됨.
            boolean derivedTerminalUsed = false;
            for (Long osmId : new Long[]{e.fromOsmId, e.toOsmId}) {
                if (nodeIdMap.containsKey(osmId)) continue;
                int total = inDeg.getOrDefault(osmId, 0) + outDeg.getOrDefault(osmId, 0);
                if (total > 1) {
                    nodeIdMap.put(osmId, idAssigner.nextNormalNodeId());
                } else if (!derivedTerminalUsed) {
                    nodeIdMap.put(osmId, idAssigner.terminalIdFor(linkId));
                    derivedTerminalUsed = true;
                } else {
                    nodeIdMap.put(osmId, idAssigner.nextIsolatedTerminalId());
                }
            }
        }
        // 어느 엣지에도 연결되지 않은 고립 노드(비정상 데이터) — 페어링할 Link가 없어 fallback
        for (Long osmId : netOsmNodeIds) {
            nodeIdMap.putIfAbsent(osmId, idAssigner.nextIsolatedTerminalId());
        }

        // 7. 노드별 in/out link 목록
        Map<Long, List<Integer>> inEdges  = new LinkedHashMap<>(); // osmId → [edgeIndex]
        Map<Long, List<Integer>> outEdges = new LinkedHashMap<>();
        for (int i = 0; i < edges.size(); i++) {
            GraphEdge e = edges.get(i);
            outEdges.computeIfAbsent(e.fromOsmId, k -> new ArrayList<>()).add(i);
            inEdges.computeIfAbsent(e.toOsmId,   k -> new ArrayList<>()).add(i);
        }

        // 8. 엣지별 shape 좌표 (로컬)
        List<List<double[]>> edgeShapes = new ArrayList<>();
        for (GraphEdge e : edges) {
            List<double[]> pts = new ArrayList<>();
            for (Long nid : e.shapeNodeIds) {
                OsmNode n = nodeMap.get(nid);
                if (n != null) pts.add(toLocal(n.getLat(), n.getLon(), baseLat, baseLon));
            }
            edgeShapes.add(pts);
        }

        // 9. XML 생성
        return buildXml(networkId, netOsmNodeIds, nodeIdMap, inDeg, outDeg,
                        edges, edgeLinkId, inEdges, outEdges, edgeShapes, nodeMap,
                        baseLat, baseLon);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 그래프 구성
    // ─────────────────────────────────────────────────────────────────────────

    private List<GraphEdge> buildGraph(Map<Long, OsmNode> nodeMap, List<OsmWay> ways) {
        // 각 OSM 노드가 몇 개의 way에 등장하는지 카운트
        Map<Long, Integer> nodeWayCount = new HashMap<>();
        for (OsmWay way : ways) {
            for (Long nid : way.getNodeIds()) {
                nodeWayCount.merge(nid, 1, Integer::sum);
            }
        }

        // 네트워크 노드: way의 끝점 or 2개 이상 way에 등장
        Set<Long> netNodes = new HashSet<>();
        for (OsmWay way : ways) {
            List<Long> ids = way.getNodeIds();
            if (ids.isEmpty()) continue;
            netNodes.add(ids.get(0));
            netNodes.add(ids.get(ids.size() - 1));
            for (Long nid : ids) {
                if (nodeWayCount.getOrDefault(nid, 0) >= 2) netNodes.add(nid);
            }
        }

        List<GraphEdge> edges = new ArrayList<>();

        for (OsmWay way : ways) {
            List<Long> wayNodes = way.getNodeIds();
            if (wayNodes.size() < 2) continue;

            // 차량 통행 불가 way 제외
            String access       = way.getTag("access");
            String motorVehicle = way.getTag("motor_vehicle");
            String vehicle      = way.getTag("vehicle");
            if ("no".equals(access) || "private".equals(access)) continue;
            if ("no".equals(motorVehicle) || "no".equals(vehicle)) continue;

            // service 도로 중 주차장 내부·진입로 제외
            String service = way.getTag("service");
            if (service != null && service.matches("parking_aisle|driveway|emergency_access|alley")) continue;

            List<Long> segment = new ArrayList<>();

            for (Long nid : wayNodes) {
                segment.add(nid);
                if (segment.size() > 1 && netNodes.contains(nid)) {
                    long fromId = segment.get(0);
                    long toId   = nid;

                    // 유효한 노드만 처리
                    if (nodeMap.containsKey(fromId) && nodeMap.containsKey(toId) && fromId != toId) {
                        if (!way.isReverseOneway()) {
                            edges.add(new GraphEdge(fromId, toId, new ArrayList<>(segment), way));
                        }
                        if (!way.isOneway()) {
                            List<Long> rev = new ArrayList<>(segment);
                            Collections.reverse(rev);
                            edges.add(new GraphEdge(toId, fromId, rev, way));
                        } else if (way.isReverseOneway()) {
                            List<Long> rev = new ArrayList<>(segment);
                            Collections.reverse(rev);
                            edges.add(new GraphEdge(toId, fromId, rev, way));
                        }
                    }
                    segment.clear();
                    segment.add(nid);
                }
            }
        }

        return edges;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // XML 생성
    // ─────────────────────────────────────────────────────────────────────────

    private String buildXml(
            int networkId,
            Set<Long> netOsmNodeIds,
            Map<Long, Long> nodeIdMap,
            Map<Long, Integer> inDeg,
            Map<Long, Integer> outDeg,
            List<GraphEdge> edges,
            Map<Integer, Long> edgeLinkId,
            Map<Long, List<Integer>> inEdges,
            Map<Long, List<Integer>> outEdges,
            List<List<double[]>> edgeShapes,
            Map<Long, OsmNode> nodeMap,
            double baseLat, double baseLon
    ) {
        StringBuilder sb = new StringBuilder(1 << 20); // 초기 1MB
        sb.append("<?xml version='1.0' encoding='UTF-8'?>\n");
        sb.append("<Network id=\"").append(networkId).append("\">\n");

        // ── NODES ─────────────────────────────────────────────────────────
        sb.append("  <nodes>\n");

        for (Long osmId : netOsmNodeIds) {
            long ourId = nodeIdMap.get(osmId);
            OsmNode osmN = nodeMap.get(osmId);
            double[] lxy = toLocal(osmN.getLat(), osmN.getLon(), baseLat, baseLon);

            List<Integer> ins  = inEdges.getOrDefault(osmId, Collections.emptyList());
            List<Integer> outs = outEdges.getOrDefault(osmId, Collections.emptyList());
            int numPort = ins.size() + outs.size();

            // 노드 유형 결정
            String ntype = classifyNode(ins.size(), outs.size());

            // connection 생성
            List<String[]> connections = buildConnections(osmId, ins, outs, edges,
                    edgeLinkId, edgeShapes);

            sb.append("    <node id=\"").append(ourId).append("\"")
              .append(" type=\"").append(ntype).append("\"")
              .append(" num_port=\"").append(numPort).append("\"")
              .append(" num_connection=\"").append(connections.size()).append("\"")
              .append(" v2x=\"\"")
              .append(" x_coord=\"").append(fmt3(lxy[0])).append("\"")
              .append(" y_coord=\"").append(fmt3(lxy[1])).append("\"")
              .append(" center=\"").append(fmt3(lxy[0])).append(" ").append(fmt3(lxy[1])).append("\"")
              .append(">\n");

            for (Integer ei : ins) {
                sb.append("      <port type=\"in\" link_id=\"")
                  .append(edgeLinkId.get(ei)).append("\" direction=\"\"/>\n");
            }
            for (Integer ei : outs) {
                sb.append("      <port type=\"out\" link_id=\"")
                  .append(edgeLinkId.get(ei)).append("\" direction=\"\"/>\n");
            }
            for (String[] c : connections) {
                // c: [id, from_link, from_lane, to_link, to_lane, turning, length, width, ff_spd, shape]
                sb.append("      <connection")
                  .append(" id=\"").append(c[0]).append("\"")
                  .append(" from_link=\"").append(c[1]).append("\"")
                  .append(" from_lane=\"").append(c[2]).append("\"")
                  .append(" to_link=\"").append(c[3]).append("\"")
                  .append(" to_lane=\"").append(c[4]).append("\"")
                  .append(" turning=\"").append(c[5]).append("\"")
                  .append(" length=\"").append(c[6]).append("\"")
                  .append(" width=\"").append(c[7]).append("\"")
                  .append(" ff_spd=\"").append(c[8]).append("\"")
                  .append(" shape=\"").append(c[9]).append("\"")
                  .append("/>\n");
            }

            sb.append("    </node>\n");
        }

        sb.append("  </nodes>\n");

        // ── LINKS ─────────────────────────────────────────────────────────
        sb.append("  <links>\n");

        for (int i = 0; i < edges.size(); i++) {
            GraphEdge e = edges.get(i);
            long linkId    = edgeLinkId.get(i);
            long fromNId   = nodeIdMap.get(e.fromOsmId);
            long toNId     = nodeIdMap.get(e.toOsmId);
            List<double[]> shape = edgeShapes.get(i);

            String hw      = e.way.getTag("highway");
            double[] defs  = roadDefs(hw);
            int numLanes   = parseLanes(e.way.getTag("lanes"), (int) defs[4]);
            double maxSpd  = parseMaxspeed(e.way.getTag("maxspeed"), defs[0]);
            double ffSpd   = Math.min(maxSpd, defs[1]);
            double waveSpd = defs[2];
            double qmax    = defs[3] * numLanes;
            double laneW   = defs[5];
            double width   = round1(numLanes * laneW);
            double length  = polylineLength(shape);
            double maxVeh  = round2(length / 1000.0 * JAM_DENSITY * numLanes);
            double stopLine = 0.0; // 교차로 진입 stop line (기본값)
            String shapeStr = shapeToStr(shape);

            sb.append("    <link id=\"").append(linkId).append("\"")
              .append(" from_node=\"").append(fromNId).append("\"")
              .append(" to_node=\"").append(toNId).append("\"")
              .append(" num_lane=\"").append(numLanes).append("\"")
              .append(" length=\"").append(fmt2(length)).append("\"")
              .append(" width=\"").append(width).append("\"")
              .append(" min_spd=\"0\"")
              .append(" max_spd=\"").append(fmt1(maxSpd)).append("\"")
              .append(" ff_spd=\"").append(fmt1(ffSpd)).append("\"")
              .append(" wave_spd=\"").append(fmt2(waveSpd)).append("\"")
              .append(" qmax=\"").append(fmt1(qmax)).append("\"")
              .append(" max_veh=\"").append(fmt2(maxVeh)).append("\"")
              .append(" sim_type=\"0\"")
              .append(" type=\"straight\"")
              .append(" layer=\"\"")
              .append(" stop_line=\"").append(fmt1(stopLine)).append("\"")
              .append(" shape=\"").append(shapeStr).append("\"")
              .append(">\n");

            // lanes
            int nCells = Math.max(1, (int) Math.ceil(length / BASE_CELL_LEN));
            double cellLen = length / nCells;

            for (int laneId = 0; laneId < numLanes; laneId++) {
                String leftId  = laneId > 0             ? String.valueOf(laneId - 1) : "None";
                String rightId = laneId < numLanes - 1  ? String.valueOf(laneId + 1) : "None";

                sb.append("      <lane id=\"").append(laneId).append("\"")
                  .append(" num_cell=\"").append(nCells).append("\"")
                  .append(" left_lane_id=\"").append(leftId).append("\"")
                  .append(" right_lane_id=\"").append(rightId).append("\"")
                  .append(">\n");

                double offset = 0.0;
                for (int cid = 0; cid < nCells; cid++) {
                    double clen = (cid == nCells - 1) ? (length - cellLen * (nCells - 1)) : cellLen;
                    sb.append("        <cell id=\"").append(cid).append("\"")
                      .append(" length=\"").append(fmt2(Math.max(0.01, clen))).append("\"")
                      .append(" offset=\"").append(fmt2(offset)).append("\"")
                      .append("/>\n");
                    offset += clen;
                }

                sb.append("      </lane>\n");
            }

            sb.append("    </link>\n");
        }

        sb.append("  </links>\n");
        sb.append("</Network>\n");

        return sb.toString();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Connection 생성 (휴리스틱)
    // ─────────────────────────────────────────────────────────────────────────

    private List<String[]> buildConnections(
            long osmId,
            List<Integer> ins, List<Integer> outs,
            List<GraphEdge> edges,
            Map<Integer, Long> edgeLinkId,
            List<List<double[]>> edgeShapes
    ) {
        List<String[]> result = new ArrayList<>();
        int connId = 0;

        // 노드 로컬 좌표 (in link 마지막 점 평균)
        double[] nodePt = new double[]{0, 0};
        int cnt = 0;
        for (int ei : ins) {
            List<double[]> s = edgeShapes.get(ei);
            if (!s.isEmpty()) { nodePt[0] += s.get(s.size()-1)[0]; nodePt[1] += s.get(s.size()-1)[1]; cnt++; }
        }
        if (cnt > 0) { nodePt[0] /= cnt; nodePt[1] /= cnt; }

        for (int inIdx : ins) {
            GraphEdge inEdge   = edges.get(inIdx);
            long inLinkId      = edgeLinkId.get(inIdx);
            List<double[]> inShape = edgeShapes.get(inIdx);
            int inLanes        = parseLanes(inEdge.way.getTag("lanes"), (int) roadDefs(inEdge.way.getTag("highway"))[4]);
            double inFf        = Math.min(parseMaxspeed(inEdge.way.getTag("maxspeed"), roadDefs(inEdge.way.getTag("highway"))[0]),
                                          roadDefs(inEdge.way.getTag("highway"))[1]);
            double inBrg       = endBearing(inShape);

            for (int outIdx : outs) {
                GraphEdge outEdge  = edges.get(outIdx);
                // U-턴 제외
                if (inEdge.fromOsmId == outEdge.toOsmId && inEdge.toOsmId == outEdge.fromOsmId) continue;

                long outLinkId     = edgeLinkId.get(outIdx);
                List<double[]> outShape = edgeShapes.get(outIdx);
                int outLanes       = parseLanes(outEdge.way.getTag("lanes"), (int) roadDefs(outEdge.way.getTag("highway"))[4]);
                double outFf       = Math.min(parseMaxspeed(outEdge.way.getTag("maxspeed"), roadDefs(outEdge.way.getTag("highway"))[0]),
                                              roadDefs(outEdge.way.getTag("highway"))[1]);
                double outBrg      = startBearing(outShape);

                double diff        = angleDiff(inBrg, outBrg);
                String turning     = classifyTurn(diff);

                double connFf;
                if ("S".equals(turning))      connFf = Math.min(inFf, outFf);
                else if ("L".equals(turning)) connFf = Math.min(30.0, Math.min(inFf, outFf));
                else                          connFf = Math.min(35.0, Math.min(inFf, outFf));

                double connLen = estimateConnLen(inShape, outShape, nodePt, turning);
                double connW   = roadDefs(outEdge.way.getTag("highway"))[5];

                // connection shape: from_link 마지막 점 → to_link 첫 번째 점
                // OSM에서 두 점이 동일 노드(= 같은 좌표)인 경우, to_link 진행방향으로 2m 오프셋
                double[] connFrom = inShape.isEmpty()  ? nodePt : inShape.get(inShape.size() - 1);
                double[] connTo   = outShape.isEmpty() ? nodePt : outShape.get(0);
                double cdx = connTo[0] - connFrom[0], cdy = connTo[1] - connFrom[1];
                if (Math.sqrt(cdx * cdx + cdy * cdy) < 0.5) {
                    // 동일 점 → to_link 방향으로 2m 오프셋
                    if (outShape.size() >= 2) {
                        double ox = outShape.get(1)[0] - outShape.get(0)[0];
                        double oy = outShape.get(1)[1] - outShape.get(0)[1];
                        double ol = Math.sqrt(ox * ox + oy * oy);
                        if (ol > 0) connTo = new double[]{connFrom[0] + ox / ol * 2, connFrom[1] + oy / ol * 2};
                    } else if (inShape.size() >= 2) {
                        double ix = inShape.get(inShape.size()-1)[0] - inShape.get(inShape.size()-2)[0];
                        double iy = inShape.get(inShape.size()-1)[1] - inShape.get(inShape.size()-2)[1];
                        double il = Math.sqrt(ix * ix + iy * iy);
                        if (il > 0) connTo = new double[]{connFrom[0] + ix / il * 2, connFrom[1] + iy / il * 2};
                    }
                }
                String connShape  = fmt5(connFrom[0]) + "," + fmt5(connFrom[1])
                                  + " " + fmt5(connTo[0]) + "," + fmt5(connTo[1]);

                for (int[] pair : lanePairs(inLanes, outLanes, turning)) {
                    result.add(new String[]{
                        String.valueOf(connId++),
                        String.valueOf(inLinkId),
                        String.valueOf(pair[0]),
                        String.valueOf(outLinkId),
                        String.valueOf(pair[1]),
                        turning,
                        fmt2(connLen),
                        fmt1(connW),
                        fmt2(connFf),
                        connShape   // index 9
                    });
                }
            }
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 차선 쌍 할당 휴리스틱
    //   차선 번호: 0=좌측, n-1=우측
    // ─────────────────────────────────────────────────────────────────────────

    private List<int[]> lanePairs(int inLanes, int outLanes, String turning) {
        List<int[]> pairs = new ArrayList<>();

        if ("L".equals(turning)) {
            // 좌측 1~2개 차선이 좌회전
            int n = inLanes <= 3 ? 1 : 2;
            for (int i = 0; i < n; i++) {
                pairs.add(new int[]{i, Math.min(i, outLanes - 1)});
            }
        } else if ("R".equals(turning)) {
            // 우측 1~2개 차선이 우회전
            int n = inLanes <= 3 ? 1 : 2;
            for (int i = 0; i < n; i++) {
                int from = inLanes - 1 - i;
                int to   = Math.max(0, outLanes - 1 - i);
                pairs.add(new int[]{from, to});
            }
        } else { // Straight
            if (inLanes == 1) {
                pairs.add(new int[]{0, 0});
            } else if (inLanes == 2) {
                pairs.add(new int[]{0, Math.min(0, outLanes - 1)});
                pairs.add(new int[]{1, Math.min(1, outLanes - 1)});
            } else {
                // 좌측 1개, 우측 1개 제외한 중간 차선 직진
                for (int i = 1; i < inLanes - 1; i++) {
                    int to = Math.min(i - 1, outLanes - 1);
                    pairs.add(new int[]{i, to});
                }
                if (pairs.isEmpty()) {
                    pairs.add(new int[]{inLanes / 2, Math.min(outLanes / 2, outLanes - 1)});
                }
            }
        }

        // 중복 제거
        List<int[]> deduped = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (int[] p : pairs) {
            String key = p[0] + "," + p[1];
            if (seen.add(key)) deduped.add(p);
        }
        return deduped;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 유틸 메서드
    // ─────────────────────────────────────────────────────────────────────────

    private double[] toLocal(double lat, double lon, double baseLat, double baseLon) {
        return new double[]{(lon - baseLon) * SCALE_X, (lat - baseLat) * SCALE_Y};
    }

    private double polylineLength(List<double[]> pts) {
        double total = 0;
        for (int i = 0; i < pts.size() - 1; i++) {
            double dx = pts.get(i+1)[0] - pts.get(i)[0];
            double dy = pts.get(i+1)[1] - pts.get(i)[1];
            total += Math.sqrt(dx*dx + dy*dy);
        }
        return total;
    }

    private double bearing(double x1, double y1, double x2, double y2) {
        return Math.toDegrees(Math.atan2(x2 - x1, y2 - y1));
    }

    private double startBearing(List<double[]> pts) {
        if (pts.size() < 2) return 0;
        return bearing(pts.get(0)[0], pts.get(0)[1], pts.get(1)[0], pts.get(1)[1]);
    }

    private double endBearing(List<double[]> pts) {
        if (pts.size() < 2) return 0;
        int n = pts.size();
        return bearing(pts.get(n-2)[0], pts.get(n-2)[1], pts.get(n-1)[0], pts.get(n-1)[1]);
    }

    private double angleDiff(double inBrg, double outBrg) {
        return ((outBrg - inBrg) % 360 + 540) % 360 - 180;
    }

    private String classifyTurn(double deg) {
        if (deg < -45) return "L";
        if (deg >  45) return "R";
        return "S";
    }

    private String classifyNode(int inCnt, int outCnt) {
        int total = inCnt + outCnt;
        if (total <= 1)                    return "terminal";
        if (inCnt == 1 && outCnt == 1)     return "normal";
        if (inCnt > outCnt)                return "merging";
        if (outCnt > inCnt)                return "diverging";
        return "intersection";
    }

    private double estimateConnLen(List<double[]> inShape, List<double[]> outShape,
                                   double[] nodePt, String turning) {
        double nx = nodePt[0], ny = nodePt[1];
        double[] inEnd  = inShape.isEmpty()  ? nodePt : inShape.get(inShape.size()-1);
        double[] outStart = outShape.isEmpty() ? nodePt : outShape.get(0);
        double dIn  = Math.sqrt(Math.pow(inEnd[0]-nx, 2)  + Math.pow(inEnd[1]-ny, 2));
        double dOut = Math.sqrt(Math.pow(outStart[0]-nx,2) + Math.pow(outStart[1]-ny,2));
        double base = Math.max(10.0, dIn + dOut);
        if ("L".equals(turning)) return round2(base * 1.2);
        if ("R".equals(turning)) return round2(base * 0.7);
        return round2(base);
    }

    private double[] roadDefs(String highway) {
        if (highway == null) return ROAD_DEF.get("_default");
        return ROAD_DEF.getOrDefault(highway, ROAD_DEF.get("_default"));
    }

    private int parseLanes(String tag, int defaultVal) {
        if (tag == null) return defaultVal;
        try { return Math.max(1, Integer.parseInt(tag.trim())); }
        catch (NumberFormatException e) { return defaultVal; }
    }

    private double parseMaxspeed(String tag, double defaultVal) {
        if (tag == null) return defaultVal;
        // 한국 표준 코드
        if ("KR:urban".equals(tag))    return 50.0;
        if ("KR:rural".equals(tag))    return 80.0;
        if ("KR:motorway".equals(tag)) return 110.0;
        try {
            String v = tag.replace("km/h","").replace("kmh","").replace("mph","").trim();
            return Double.parseDouble(v);
        } catch (NumberFormatException e) { return defaultVal; }
    }

    private String shapeToStr(List<double[]> pts) {
        if (pts.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < pts.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(fmt5(pts.get(i)[0])).append(',').append(fmt5(pts.get(i)[1]));
        }
        return sb.toString();
    }

    // ── 포맷 헬퍼 ──────────────────────────────────────────────────────────
    private String fmt1(double v) { return String.format("%.1f", v); }
    private String fmt2(double v) { return String.format("%.2f", v); }
    private String fmt3(double v) { return String.format("%.3f", v); }
    private String fmt5(double v) { return String.format("%.5f", v); }
    private double round1(double v) { return Math.round(v * 10.0) / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
