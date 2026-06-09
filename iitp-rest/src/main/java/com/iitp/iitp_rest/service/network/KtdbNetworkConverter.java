package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.ktdb.KtdbLink;
import com.iitp.iitp_rest.model.ktdb.KtdbNode;
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
import com.iitp.iitp_rest.model.ktdb.KtdbTurninfo;
import com.iitp.iitp_rest.repository.KtdbLinkRepository;
import com.iitp.iitp_rest.repository.KtdbNodeRepository;
import com.iitp.iitp_rest.repository.KtdbTurninfoRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * KTDB 표준노드링크(PostgreSQL) → NetworkXml 직접 변환.
 *
 * KTDB는 교차로 내부 회전 동선을 짧은 링크(internal link)로 표현한다.
 * 이 내부 링크로 연결된 노드들을 클러스터로 묶어 단일 교차로 노드로 병합하고,
 * 외부 링크들은 병합 노드에 연결한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KtdbNetworkConverter {

    private static final double SCALE_X       = 88000.0;
    private static final double SCALE_Y       = 111000.0;
    private static final double BASE_CELL_LEN = 69.44;
    private static final double JAM_DENSITY   = 150.0;
    private static final double INTERNAL_MAX_M = 25.0; // 이 길이 미만 + 양끝 고차수 노드 → 내부 링크

    private static final Map<Integer, double[]> RANK_DEFS = new HashMap<>();
    static {
        RANK_DEFS.put(101, new double[]{5.50, 2400, 3.5});
        RANK_DEFS.put(102, new double[]{5.00, 2400, 3.5});
        RANK_DEFS.put(103, new double[]{5.00, 2200, 3.5});
        RANK_DEFS.put(104, new double[]{4.95, 1800, 3.5});
        RANK_DEFS.put(105, new double[]{3.62, 1800, 3.5});
        RANK_DEFS.put(106, new double[]{3.00, 1800, 3.0});
        RANK_DEFS.put(107, new double[]{2.36,  900, 3.0});
        RANK_DEFS.put(108, new double[]{2.36,  900, 3.0});
    }
    private static final double[] DEFAULT_DEFS = {2.36, 900, 3.0};

    private final KtdbLinkRepository     linkRepo;
    private final KtdbNodeRepository     nodeRepo;
    private final KtdbTurninfoRepository turninfoRepo;

    public record ConvertResult(NetworkXml networkXml) {}

    public ConvertResult convert(
            double south, double west, double north, double east,
            double baseLat, double baseLon, int networkId) {

        // ── 1. DB 조회 ────────────────────────────────────────────────────────
        List<KtdbLink> links = linkRepo.findByBbox(west, east, south, north);
        if (links.isEmpty()) throw new IllegalArgumentException("해당 bbox에 KTDB 데이터가 없습니다.");

        Set<String> nodeIds = new HashSet<>();
        for (KtdbLink lk : links) { nodeIds.add(lk.getFNode()); nodeIds.add(lk.getTNode()); }
        Map<String, KtdbNode> nodeMap = nodeRepo.findByNodeIdIn(nodeIds)
                .stream().collect(Collectors.toMap(KtdbNode::getNodeId, n -> n));

        log.info("KTDB 직접 변환: 링크 {}개, 노드 {}개", links.size(), nodeMap.size());

        // ── 2. 로컬 좌표 변환 ─────────────────────────────────────────────────
        Map<String, List<double[]>> coordsMap = new LinkedHashMap<>();
        for (KtdbLink lk : links) {
            if (!nodeMap.containsKey(lk.getFNode()) || !nodeMap.containsKey(lk.getTNode())) continue;
            List<double[]> pts = new ArrayList<>();
            for (Map<String, Double> pt : lk.getCoords())
                pts.add(wgsToLocal(pt.get("lat"), pt.get("lng"), baseLat, baseLon));
            coordsMap.put(lk.getLinkId(), pts);
        }

        // ── 3. 노드 degree 계산 ───────────────────────────────────────────────
        Map<String, Integer> degree = new HashMap<>();
        for (KtdbLink lk : links) {
            if (!coordsMap.containsKey(lk.getLinkId())) continue;
            degree.merge(lk.getFNode(), 1, Integer::sum);
            degree.merge(lk.getTNode(), 1, Integer::sum);
        }

        // ── 4. 내부 링크 판별 ─────────────────────────────────────────────────
        Set<String> internalIds = new HashSet<>();
        for (KtdbLink lk : links) {
            if (!coordsMap.containsKey(lk.getLinkId())) continue;
            if (degree.getOrDefault(lk.getFNode(), 0) >= 3
                    && degree.getOrDefault(lk.getTNode(), 0) >= 3
                    && calcLength(coordsMap.get(lk.getLinkId())) < INTERNAL_MAX_M) {
                internalIds.add(lk.getLinkId());
            }
        }
        log.info("교차로 내부 링크: {}개", internalIds.size());

        // ── 5. 내부 링크로 연결된 노드 클러스터 병합 (Union-Find) ─────────────
        Map<String, String> parent = new HashMap<>();
        for (String nid : nodeIds) parent.put(nid, nid);
        for (KtdbLink lk : links) {
            if (internalIds.contains(lk.getLinkId())) {
                union(parent, lk.getFNode(), lk.getTNode());
            }
        }
        // ktdbNodeId → clusterRepresentative
        Map<String, String> nodeToCluster = new HashMap<>();
        for (String nid : nodeIds) nodeToCluster.put(nid, find(parent, nid));

        // 클러스터 대표 좌표: 클러스터 내 모든 노드의 bounding box 중심
        Map<String, double[]> clusterLocalCoord = new HashMap<>();
        Map<String, Integer>  clusterNodeCount  = new HashMap<>();
        Map<String, double[]> clusterMin        = new HashMap<>();
        Map<String, double[]> clusterMax        = new HashMap<>();
        for (String nid : nodeIds) {
            KtdbNode n = nodeMap.get(nid);
            if (n == null) continue;
            String rep = nodeToCluster.get(nid);
            double[] lxy = wgsToLocal(n.getLat(), n.getLon(), baseLat, baseLon);
            clusterNodeCount.merge(rep, 1, Integer::sum);
            clusterMin.merge(rep, lxy, (a, b) -> new double[]{Math.min(a[0], b[0]), Math.min(a[1], b[1])});
            clusterMax.merge(rep, lxy, (a, b) -> new double[]{Math.max(a[0], b[0]), Math.max(a[1], b[1])});
        }
        for (String rep : clusterMin.keySet()) {
            double[] mn = clusterMin.get(rep), mx = clusterMax.get(rep);
            clusterLocalCoord.put(rep, new double[]{(mn[0] + mx[0]) / 2.0, (mn[1] + mx[1]) / 2.0});
        }

        Set<String> clusterReps = new HashSet<>(clusterLocalCoord.keySet());

        // ── 6. 클러스터(=교차로 노드) ID 부여 ───────────────────────────────
        Map<String, Long> clusterIdMap = new LinkedHashMap<>();
        long nodeCnt = 10000001L;
        for (String rep : clusterReps) clusterIdMap.put(rep, nodeCnt++);

        // ── 7. 외부 링크 선별 + ID 부여 (self-loop 사전 제거) ───────────────
        // f_node와 t_node가 같은 클러스터에 속하면 self-loop → linkIdMap에서 완전 제외
        // 이 시점에 제외해야 포트/connection에도 등록되지 않음
        Map<String, Long> linkIdMap = new LinkedHashMap<>();
        long linkCnt = 20000001L;
        for (KtdbLink lk : links) {
            if (internalIds.contains(lk.getLinkId())) continue;
            if (!coordsMap.containsKey(lk.getLinkId())) continue;
            String fRep = nodeToCluster.get(lk.getFNode());
            String tRep = nodeToCluster.get(lk.getTNode());
            if (fRep != null && fRep.equals(tRep)) continue; // self-loop 제외
            linkIdMap.put(lk.getLinkId(), linkCnt++);
        }

        // ── 8. 클러스터별 in/out 외부 링크 수집 ──────────────────────────────
        Map<String, List<KtdbLink>> clusterIn  = new LinkedHashMap<>();
        Map<String, List<KtdbLink>> clusterOut = new LinkedHashMap<>();
        for (KtdbLink lk : links) {
            if (!linkIdMap.containsKey(lk.getLinkId())) continue;
            String tRep = nodeToCluster.get(lk.getTNode());
            String fRep = nodeToCluster.get(lk.getFNode());
            if (tRep != null) clusterIn.computeIfAbsent(tRep,  k -> new ArrayList<>()).add(lk);
            if (fRep != null) clusterOut.computeIfAbsent(fRep, k -> new ArrayList<>()).add(lk);
        }

        // ── 9. 외부 링크 from/to 노드를 클러스터 대표로 리매핑 ───────────────
        Map<String, String[]> linkClusterEndpoints = new HashMap<>();
        for (KtdbLink lk : links) {
            if (!linkIdMap.containsKey(lk.getLinkId())) continue;
            String fRep = nodeToCluster.get(lk.getFNode());
            String tRep = nodeToCluster.get(lk.getTNode());
            linkClusterEndpoints.put(lk.getLinkId(), new String[]{fRep, tRep});
        }

        // ── 9b. 링크 shape에 setback 적용 ──────────────────────────────────
        // 교차로(merged cluster) 진입/진출 링크의 끝점을 노드 방향으로 setback.
        // → 링크는 교차로 직전에서 끊기고, 교차로 내부는 connection만 표현.
        final double SETBACK_M = 5.0; // 교차로 진입 전 setback 거리(m)

        for (String lkId : linkIdMap.keySet()) {
            List<double[]> coords = coordsMap.get(lkId);
            if (coords == null || coords.size() < 2) continue;
            String[] eps = linkClusterEndpoints.get(lkId);
            if (eps == null) continue;

            String fRep = eps[0], tRep = eps[1];

            // 진입 끝점 setback: t_node가 merged cluster → 마지막 점을 노드 방향으로 후퇴
            if (clusterNodeCount.getOrDefault(tRep, 1) > 1) {
                double[] nodePos = clusterLocalCoord.get(tRep);
                if (nodePos != null) {
                    List<double[]> trimmed = trimEnd(coords, nodePos, SETBACK_M);
                    coords.clear(); coords.addAll(trimmed);
                }
            }
            // 진출 시작점 setback: f_node가 merged cluster → 첫 점을 노드 방향으로 후퇴
            if (clusterNodeCount.getOrDefault(fRep, 1) > 1) {
                double[] nodePos = clusterLocalCoord.get(fRep);
                if (nodePos != null) {
                    List<double[]> trimmed = trimStart(coords, nodePos, SETBACK_M);
                    coords.clear(); coords.addAll(trimmed);
                }
            }
        }

        // ── 10. 클러스터 내부 링크 그래프 구성 → 진입/진출 쌍 도출 ──────────
        //
        // KTDB 교차로는 내부 링크가 체인 구조:
        //   N진입 → node_A → internal(A→C) → node_C → internal(C→B) → node_B → E출발
        //
        // 개별 internal link만 보면 node_C에 외부 링크가 없어 좌/우회전을 찾지 못함.
        // 해결책: 클러스터 내부에서 BFS로 "외부 진입 가능 노드 → 외부 진출 가능 노드" 경로 탐색.
        // 이 경로가 실제 KTDB가 허용한 회전 동선.

        // 노드별 외부 in/out 링크 역인덱스
        Map<String, List<KtdbLink>> nodeExtIn  = new HashMap<>();
        Map<String, List<KtdbLink>> nodeExtOut = new HashMap<>();
        for (KtdbLink lk : links) {
            if (!linkIdMap.containsKey(lk.getLinkId())) continue;
            nodeExtIn.computeIfAbsent(lk.getTNode(),  k -> new ArrayList<>()).add(lk);
            nodeExtOut.computeIfAbsent(lk.getFNode(), k -> new ArrayList<>()).add(lk);
        }

        // 내부 링크 방향 그래프: fNode → list of tNode (클러스터 내부 이동 가능 경로)
        Map<String, List<String>> internalAdj = new HashMap<>();
        for (KtdbLink intLk : links) {
            if (!internalIds.contains(intLk.getLinkId())) continue;
            internalAdj.computeIfAbsent(intLk.getFNode(), k -> new ArrayList<>())
                    .add(intLk.getTNode());
        }

        // TURNINFO 로드: bbox 내 클러스터 노드에 해당하는 회전 규칙
        // key: nodeId → Map<stLink, Set<edLink>> (prohibited only)
        // TURNINFO 레코드가 없는 교차로는 기하학적 U턴 필터만 적용
        Set<String> allClusterNodeIds = nodeIds.stream()
                .filter(nid -> clusterNodeCount.getOrDefault(nodeToCluster.get(nid), 1) > 1)
                .collect(Collectors.toSet());
        Map<String, Map<String, Set<String>>> prohibitedTurns = new HashMap<>(); // nodeId→stLink→Set<edLink>
        Map<String, Map<String, Set<String>>> allowedTurns    = new HashMap<>(); // TURNINFO에 명시된 허용
        if (!allClusterNodeIds.isEmpty()) {
            List<KtdbTurninfo> turninfos = turninfoRepo.findByNodeIds(allClusterNodeIds);
            for (KtdbTurninfo ti : turninfos) {
                if (ti.isProhibited()) {
                    prohibitedTurns.computeIfAbsent(ti.getNodeId(), k -> new HashMap<>())
                            .computeIfAbsent(ti.getStLink(), k -> new HashSet<>())
                            .add(ti.getEdLink());
                } else {
                    allowedTurns.computeIfAbsent(ti.getNodeId(), k -> new HashMap<>())
                            .computeIfAbsent(ti.getStLink(), k -> new HashSet<>())
                            .add(ti.getEdLink());
                }
            }
            log.info("TURNINFO 로드: {}개 노드, 금지 {}건, 허용 명시 {}건",
                    allClusterNodeIds.size(), prohibitedTurns.size(), allowedTurns.size());
        }

        // clusterRep → List<(fromLinkId, toLinkId, turningCode)>
        Map<String, List<long[]>> clusterConnData = new HashMap<>();

        // 각 클러스터에 대해: 클러스터 내 모든 노드를 순회
        // 외부 in-link가 있는 노드에서 BFS로 외부 out-link가 있는 노드까지 탐색
        for (String rep : clusterReps) {
            // 이 클러스터에 속한 모든 KTDB 노드
            List<String> clusterNodes = nodeIds.stream()
                    .filter(nid -> rep.equals(nodeToCluster.get(nid)))
                    .collect(Collectors.toList());

            for (String entryNode : clusterNodes) {
                List<KtdbLink> extIns = nodeExtIn.getOrDefault(entryNode, List.of());
                if (extIns.isEmpty()) continue; // 외부 진입 링크 없으면 패스

                // BFS: entryNode에서 출발해 내부 링크를 통해 도달 가능한 모든 노드 탐색
                Set<String> visited = new HashSet<>();
                Queue<String> queue = new LinkedList<>();
                visited.add(entryNode);
                queue.add(entryNode);

                while (!queue.isEmpty()) {
                    String cur = queue.poll();
                    // cur 노드에서 출발하는 외부 out-link 확인
                    for (KtdbLink extOut : nodeExtOut.getOrDefault(cur, List.of())) {
                        Long toLinkId = linkIdMap.get(extOut.getLinkId());
                        if (toLinkId == null) continue;
                        List<double[]> outCoords = coordsMap.get(extOut.getLinkId());
                        if (outCoords == null || outCoords.size() < 2) continue;

                        // 각 외부 진입 링크와 이 진출 링크를 연결
                        for (KtdbLink extIn : extIns) {
                            Long fromLinkId = linkIdMap.get(extIn.getLinkId());
                            if (fromLinkId == null) continue;
                            List<double[]> inCoords = coordsMap.get(extIn.getLinkId());
                            if (inCoords == null || inCoords.size() < 2) continue;

                            // TURNINFO 금지 체크: 진입 노드 기준
                            String entryNodeForTurn = entryNode; // BFS 출발점(외부in의 tNode)
                            Map<String, Set<String>> prohibited = prohibitedTurns.get(entryNodeForTurn);
                            if (prohibited != null) {
                                Set<String> pEdLinks = prohibited.get(extIn.getLinkId());
                                if (pEdLinks != null && pEdLinks.contains(extOut.getLinkId())) continue;
                            }

                            double inBearing  = approachBearing(inCoords);
                            double outBearing = departureBearing(outCoords);

                            // 기하학적 U턴 제외: 진입 방향과 진출 방향이 반대(각도차 150°~210°)
                            // TURNINFO에 명시적으로 허용된 경우만 예외
                            double diff = ((outBearing - inBearing) + 360) % 360;
                            boolean isUTurn = diff > 150 && diff < 210;
                            if (isUTurn) {
                                Map<String, Set<String>> allowed = allowedTurns.get(entryNodeForTurn);
                                boolean explicitlyAllowed = allowed != null
                                        && allowed.containsKey(extIn.getLinkId())
                                        && allowed.get(extIn.getLinkId()).contains(extOut.getLinkId());
                                if (!explicitlyAllowed) continue;
                            }

                            Turning turning = determineTurning(inBearing, outBearing);
                            clusterConnData.computeIfAbsent(rep, k -> new ArrayList<>())
                                    .add(new long[]{fromLinkId, toLinkId,
                                            turning == Turning.Left_Turn  ? 0 :
                                            turning == Turning.Right_Turn ? 2 : 1});
                        }
                    }
                    // 내부 링크를 통해 이동 가능한 다음 노드 추가
                    for (String next : internalAdj.getOrDefault(cur, List.of())) {
                        if (visited.add(next)) queue.add(next);
                    }
                }
            }
        }

        // ── 11. 노드 생성 ────────────────────────────────────────────────────
        List<NodeXml> nodeList = new ArrayList<>();
        for (String rep : clusterReps) {
            Long ourNodeId = clusterIdMap.get(rep);
            double[] lxy   = clusterLocalCoord.get(rep);

            List<KtdbLink> ins  = clusterIn.getOrDefault(rep,  List.of());
            List<KtdbLink> outs = clusterOut.getOrDefault(rep, List.of());

            // 포트 등록 (유효한 링크만)
            List<PortXml> ports = new ArrayList<>();
            Set<Long> inPortIds  = new HashSet<>();
            Set<Long> outPortIds = new HashSet<>();
            for (KtdbLink lk : ins) {
                Long lid = linkIdMap.get(lk.getLinkId());
                if (lid == null) continue;
                List<double[]> c = coordsMap.get(lk.getLinkId());
                if (c == null || c.size() < 2 || calcLength(c) < 0.5 || buildShape(c).isBlank()) continue;
                if (inPortIds.add(lid)) ports.add(makePort(PortType.in, lid));
            }
            for (KtdbLink lk : outs) {
                Long lid = linkIdMap.get(lk.getLinkId());
                if (lid == null) continue;
                List<double[]> c = coordsMap.get(lk.getLinkId());
                if (c == null || c.size() < 2 || calcLength(c) < 0.5 || buildShape(c).isBlank()) continue;
                if (outPortIds.add(lid)) ports.add(makePort(PortType.out, lid));
            }

            // connection 생성
            List<ConnectionXml> conns;
            boolean isMergedCluster = clusterNodeCount.getOrDefault(rep, 1) > 1;
            if (isMergedCluster) {
                // 교차로: 내부 링크로부터 파생된 실제 회전 동선 사용
                conns = buildConnectionsFromInternalLinks(
                        clusterConnData.getOrDefault(rep, List.of()),
                        inPortIds, outPortIds, coordsMap, linkIdMap);
            } else {
                // 단순 노드(merge 없음): in-link 하나 → out-link 하나의 통과 연결
                conns = buildPassthroughConnections(ins, outs, inPortIds, outPortIds, linkIdMap, coordsMap);
            }

            NodeXml nx = new NodeXml();
            nx.setId(ourNodeId);
            nx.setType(classifyNodeType(ins.size(), outs.size()));
            nx.setCenter(fmt3(lxy[0]) + " " + fmt3(lxy[1]));
            nx.setPorts(ports);
            nx.setNumPort(ports.size());
            nx.setConnections(conns);
            nx.setNumConnection(conns.size());
            nodeList.add(nx);
        }

        // ── 11. 링크 생성 ─────────────────────────────────────────────────────
        List<LinkXml> linkList = new ArrayList<>();
        for (KtdbLink lk : links) {
            Long ourId = linkIdMap.get(lk.getLinkId());
            if (ourId == null) continue;
            String[] eps   = linkClusterEndpoints.get(lk.getLinkId());
            Long fromNodeId = clusterIdMap.get(eps[0]);
            Long toNodeId   = clusterIdMap.get(eps[1]);
            if (fromNodeId == null || toNodeId == null) continue;
            // self-loop는 linkIdMap 빌드 시점에 이미 제외됨

            List<double[]> coords = coordsMap.get(lk.getLinkId());
            if (coords == null || coords.size() < 2) continue; // 유효하지 않은 좌표 스킵
            String shape = buildShape(coords);
            if (shape.isBlank()) continue; // NaN 좌표로 shape가 빈 경우 스킵

            double length = calcLength(coords);
            if (length < 0.5) continue; // 너무 짧은 링크 스킵 (setback 후 길이 0)
            double[] defs = RANK_DEFS.getOrDefault(lk.getRoadRank(), DEFAULT_DEFS);
            int lanes     = Math.max(1, lk.getLanes());
            double maxSpd = lk.getMaxSpd();

            LinkXml lx = new LinkXml();
            lx.setId(ourId);
            lx.setFromNode(fromNodeId);
            lx.setToNode(toNodeId);
            lx.setNumLane(lanes);
            lx.setLength(round2(length));
            lx.setWidth(round1(lanes * defs[2]));
            lx.setMaxSpd(maxSpd);
            lx.setMinSpd(0.0);
            lx.setFfSpd(round1(maxSpd));
            lx.setWaveSpd(round2(defs[0]));
            lx.setQmax(round1(defs[1] * lanes));
            lx.setMaxVeh(round2((length / 1000.0) * JAM_DENSITY * lanes));
            lx.setSimType(SimType.Meso);
            lx.setType(LinkType.straight);
            lx.setLayer("");
            lx.setStopLine(0.0);
            lx.setShape(shape);
            lx.setLanes(buildLanes(lanes, length, shape));
            linkList.add(lx);
        }

        log.info("KTDB 변환 완료: 노드 {}개 (클러스터 {}개), 링크 {}개",
                nodeList.size(), clusterReps.size(), linkList.size());

        NetworkXml network = new NetworkXml();
        network.setId((long) networkId);
        network.setNodes(nodeList);
        network.setLinks(linkList);
        return new ConvertResult(network);
    }

    // ── 연결 생성 ─────────────────────────────────────────────────────────────

    /**
     * 교차로 노드용: 내부 링크로부터 파생된 실제 회전 동선.
     * long[] = {fromLinkId, toLinkId, turningCode}
     */
    private List<ConnectionXml> buildConnectionsFromInternalLinks(
            List<long[]> connData,
            Set<Long> inPortIds, Set<Long> outPortIds,
            Map<String, List<double[]>> coordsMap,
            Map<String, Long> linkIdMap) {

        Map<Long, String> reverseMap = new HashMap<>();
        for (Map.Entry<String, Long> e : linkIdMap.entrySet()) reverseMap.put(e.getValue(), e.getKey());

        List<ConnectionXml> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        long connId = 0;

        for (long[] cd : connData) {
            long fromLinkId = cd[0], toLinkId = cd[1];
            if (!inPortIds.contains(fromLinkId) || !outPortIds.contains(toLinkId)) continue;

            String key = fromLinkId + ":" + toLinkId;
            if (!seen.add(key)) continue; // 중복 제거

            String fromKtdbId = reverseMap.get(fromLinkId);
            String toKtdbId   = reverseMap.get(toLinkId);
            if (fromKtdbId == null || toKtdbId == null) continue;

            List<double[]> fromCoords = coordsMap.get(fromKtdbId);
            List<double[]> toCoords   = coordsMap.get(toKtdbId);
            if (fromCoords == null || toCoords == null) continue;

            Turning turning = cd[2] == 0 ? Turning.Left_Turn :
                              cd[2] == 2 ? Turning.Right_Turn : Turning.Straight;

            double[] from = lastPoint(fromCoords);
            double[] to   = firstPoint(toCoords);
            double dx = to[0] - from[0], dy = to[1] - from[1];
            double connLen = Math.max(1.0, Math.sqrt(dx * dx + dy * dy));

            // 차선 연결: 직진은 차선 수 맞춰서, 좌/우회전은 끝 차선끼리
            String fromKtdbIdStr = fromKtdbId;
            int inLanes  = linkIdMap.containsKey(fromKtdbIdStr) ? 1 : 1; // lanes는 KtdbLink에서 가져와야 하나 여기선 1로 단순화
            int outLanes = 1;

            ConnectionXml conn = new ConnectionXml();
            conn.setId(connId++);
            conn.setFromLink(fromLinkId);
            conn.setFromLane(0L);
            conn.setToLink(toLinkId);
            conn.setToLane(0L);
            conn.setTurning(turning);
            conn.setLength(round2(connLen));
            conn.setWidth(3.0);
            conn.setFfSpd(round2(turning == Turning.Left_Turn ? 20.0 :
                                  turning == Turning.Right_Turn ? 25.0 : 30.0));
            conn.setShape(fmt5(from[0]) + "," + fmt5(from[1]) + " " +
                          fmt5(to[0])   + "," + fmt5(to[1]));
            result.add(conn);
        }
        return result;
    }

    /**
     * 단순 노드용(merge 없음): in-link → out-link 단순 통과 연결.
     * U-turn(진입 링크의 출발 노드 = 진출 링크의 도착 노드)만 제외.
     */
    private List<ConnectionXml> buildPassthroughConnections(
            List<KtdbLink> ins, List<KtdbLink> outs,
            Set<Long> inPortIds, Set<Long> outPortIds,
            Map<String, Long> linkIdMap,
            Map<String, List<double[]>> coordsMap) {

        List<ConnectionXml> result = new ArrayList<>();
        if (ins.isEmpty() || outs.isEmpty()) return result;

        long connId = 0;
        for (KtdbLink inLk : ins) {
            Long fromLinkId = linkIdMap.get(inLk.getLinkId());
            if (fromLinkId == null || !inPortIds.contains(fromLinkId)) continue;
            List<double[]> inCoords = coordsMap.get(inLk.getLinkId());
            if (inCoords == null || inCoords.size() < 2) continue;

            for (KtdbLink outLk : outs) {
                // U-turn 제외: 진입 링크의 출발 노드 == 진출 링크의 도착 노드
                if (outLk.getTNode().equals(inLk.getFNode())) continue;

                Long toLinkId = linkIdMap.get(outLk.getLinkId());
                if (toLinkId == null || !outPortIds.contains(toLinkId)) continue;
                List<double[]> outCoords = coordsMap.get(outLk.getLinkId());
                if (outCoords == null || outCoords.size() < 2) continue;

                double inBearing  = approachBearing(inCoords);
                double outBearing = departureBearing(outCoords);

                // U턴 제외 (기하학적): 진입·진출 방향이 반대
                double diff = ((outBearing - inBearing) + 360) % 360;
                if (diff > 150 && diff < 210) continue;

                Turning turning = determineTurning(inBearing, outBearing);

                double[] from = lastPoint(inCoords);
                double[] to   = firstPoint(outCoords);
                double dx = to[0] - from[0], dy = to[1] - from[1];
                double connLen = Math.max(1.0, Math.sqrt(dx * dx + dy * dy));
                double[] defs  = RANK_DEFS.getOrDefault(outLk.getRoadRank(), DEFAULT_DEFS);
                double connFf  = switch (turning) {
                    case Left_Turn  -> Math.min(30.0, outLk.getMaxSpd());
                    case Right_Turn -> Math.min(35.0, outLk.getMaxSpd());
                    default          -> outLk.getMaxSpd();
                };

                int inLanes  = Math.max(1, inLk.getLanes());
                int outLanes = Math.max(1, outLk.getLanes());
                for (int[] pair : lanePairs(turning, inLanes, outLanes)) {
                    ConnectionXml conn = new ConnectionXml();
                    conn.setId(connId++);
                    conn.setFromLink(fromLinkId);
                    conn.setFromLane((long) pair[0]);
                    conn.setToLink(toLinkId);
                    conn.setToLane((long) pair[1]);
                    conn.setTurning(turning);
                    conn.setLength(round2(connLen));
                    conn.setWidth(defs[2]);
                    conn.setFfSpd(round2(connFf));
                    conn.setShape(fmt5(from[0]) + "," + fmt5(from[1]) + " " +
                                  fmt5(to[0])   + "," + fmt5(to[1]));
                    result.add(conn);
                }
            }
        }
        return result;
    }

    // 두 방향의 각도 차이 (0~180)
    private double angleDiff(double b1, double b2) {
        double d = Math.abs(b1 - b2) % 360;
        return d > 180 ? 360 - d : d;
    }


    private List<int[]> lanePairs(Turning turning, int inLanes, int outLanes) {
        List<int[]> pairs = new ArrayList<>();
        if (turning == Turning.Left_Turn) {
            pairs.add(new int[]{0, 0});
        } else if (turning == Turning.Right_Turn) {
            pairs.add(new int[]{inLanes - 1, outLanes - 1});
        } else {
            int count = Math.min(inLanes, outLanes);
            for (int k = 0; k < count; k++) pairs.add(new int[]{k, k});
            for (int k = count; k < inLanes;  k++) pairs.add(new int[]{k, outLanes - 1});
            for (int k = count; k < outLanes; k++) pairs.add(new int[]{inLanes - 1, k});
        }
        return pairs;
    }

    // ── Setback 트리밍 ────────────────────────────────────────────────────────

    /**
     * 링크 끝점 쪽을 nodePos 방향으로 setbackM 만큼 후퇴시킴.
     * 끝점이 이미 setbackM보다 가까우면 끝에서 1/4 지점까지만 자름.
     */
    private List<double[]> trimEnd(List<double[]> coords, double[] nodePos, double setbackM) {
        if (coords.size() < 2) return coords;
        List<double[]> result = new ArrayList<>(coords);
        double remaining = setbackM;
        while (result.size() >= 2 && remaining > 0) {
            double[] last = result.get(result.size() - 1);
            double[] prev = result.get(result.size() - 2);
            double segLen = dist(prev, last);
            if (segLen < 1e-6) { result.remove(result.size() - 1); continue; } // 중복점 제거
            if (segLen <= remaining) {
                remaining -= segLen;
                result.remove(result.size() - 1);
            } else {
                double frac = (segLen - remaining) / segLen;
                result.set(result.size() - 1, new double[]{
                    prev[0] + frac * (last[0] - prev[0]),
                    prev[1] + frac * (last[1] - prev[1])
                });
                break;
            }
        }
        return result.size() >= 2 ? result : coords;
    }

    private List<double[]> trimStart(List<double[]> coords, double[] nodePos, double setbackM) {
        if (coords.size() < 2) return coords;
        List<double[]> result = new ArrayList<>(coords);
        double remaining = setbackM;
        while (result.size() >= 2 && remaining > 0) {
            double[] first = result.get(0);
            double[] next  = result.get(1);
            double segLen  = dist(first, next);
            if (segLen < 1e-6) { result.remove(0); continue; } // 중복점 제거
            if (segLen <= remaining) {
                remaining -= segLen;
                result.remove(0);
            } else {
                double frac = remaining / segLen;
                result.set(0, new double[]{
                    first[0] + frac * (next[0] - first[0]),
                    first[1] + frac * (next[1] - first[1])
                });
                break;
            }
        }
        return result.size() >= 2 ? result : coords;
    }

    private double dist(double[] a, double[] b) {
        double dx = b[0] - a[0], dy = b[1] - a[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ── Union-Find ────────────────────────────────────────────────────────────

    private String find(Map<String, String> parent, String id) {
        if (!parent.containsKey(id)) return id;
        if (!parent.get(id).equals(id)) parent.put(id, find(parent, parent.get(id)));
        return parent.get(id);
    }

    private void union(Map<String, String> parent, String a, String b) {
        String ra = find(parent, a), rb = find(parent, b);
        if (!ra.equals(rb)) parent.put(ra, rb);
    }

    // ── 좌표 유틸 ─────────────────────────────────────────────────────────────

    private double[] wgsToLocal(double lat, double lon, double baseLat, double baseLon) {
        return new double[]{(lon - baseLon) * SCALE_X, (lat - baseLat) * SCALE_Y};
    }

    private double calcLength(List<double[]> coords) {
        if (coords == null || coords.size() < 2) return 1.0;
        double total = 0;
        for (int i = 0; i < coords.size() - 1; i++) {
            double dx = coords.get(i + 1)[0] - coords.get(i)[0];
            double dy = coords.get(i + 1)[1] - coords.get(i)[1];
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return Math.max(1.0, total);
    }

    private String buildShape(List<double[]> coords) {
        if (coords == null || coords.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (double[] pt : coords) {
            if (pt == null) continue;
            double x = pt[0], y = pt[1];
            if (!Double.isFinite(x) || !Double.isFinite(y)) continue; // NaN/Inf 방어
            if (sb.length() > 0) sb.append(' ');
            sb.append(fmt5(x)).append(',').append(fmt5(y));
        }
        return sb.toString();
    }

    private double approachBearing(List<double[]> coords) {
        if (coords == null || coords.size() < 2) return 0;
        return bearing(coords.get(coords.size() - 2), coords.get(coords.size() - 1));
    }

    private double departureBearing(List<double[]> coords) {
        if (coords == null || coords.size() < 2) return 0;
        return bearing(coords.get(0), coords.get(1));
    }

    private double bearing(double[] from, double[] to) {
        return Math.toDegrees(Math.atan2(to[0] - from[0], to[1] - from[1]));
    }

    private Turning determineTurning(double inBearing, double outBearing) {
        double diff = ((outBearing - inBearing) + 360) % 360;
        if (diff < 45 || diff > 315) return Turning.Straight;
        if (diff <= 180) return Turning.Right_Turn;
        return Turning.Left_Turn;
    }

    private double[] lastPoint(List<double[]> coords) {
        if (coords == null || coords.isEmpty()) return new double[]{0, 0};
        return coords.get(coords.size() - 1);
    }

    private double[] firstPoint(List<double[]> coords) {
        if (coords == null || coords.isEmpty()) return new double[]{0, 0};
        return coords.get(0);
    }

    // ── 네트워크 구조 빌더 ────────────────────────────────────────────────────

    private NodeType classifyNodeType(int ins, int outs) {
        int total = ins + outs;
        if (total <= 1)            return NodeType.Terminal;
        if (ins == 1 && outs == 1) return NodeType.Normal;
        if (ins > outs)            return NodeType.Merging;
        if (outs > ins)            return NodeType.Diverging;
        return NodeType.Intersection;
    }

    private PortXml makePort(PortType type, Long linkId) {
        PortXml p = new PortXml();
        p.setType(type);
        p.setLinkId(String.valueOf(linkId));
        return p;
    }

    private List<LaneXml> buildLanes(int numLanes, double length, String shape) {
        List<LaneXml> result = new ArrayList<>();
        int nCells    = Math.max(1, (int) Math.ceil(length / BASE_CELL_LEN));
        double cellLen = length / nCells;

        for (int i = 0; i < numLanes; i++) {
            LaneXml lane = new LaneXml();
            lane.setId((long) i);
            lane.setLeftLaneId(i > 0             ? String.valueOf(i - 1) : "None");
            lane.setRightLaneId(i < numLanes - 1 ? String.valueOf(i + 1) : "None");
            lane.setRightLC(true);
            lane.setLeftLC(true);
            lane.setNumCell(nCells);
            lane.setShape(shape);

            List<CellXml> cells = new ArrayList<>();
            double offset = 0;
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

    // ── 포맷 유틸 ─────────────────────────────────────────────────────────────

    private String fmt3(double v) { return String.format("%.3f", v); }
    private String fmt5(double v) { return String.format("%.5f", v); }
    private double round1(double v) { return Math.round(v * 10.0)  / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
