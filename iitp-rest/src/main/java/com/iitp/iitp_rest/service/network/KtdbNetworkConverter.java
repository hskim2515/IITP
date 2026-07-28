package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.ktdb.KtdbLink;
import com.iitp.iitp_rest.model.ktdb.KtdbNode;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.cell.CellXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.section.SectionXml;
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
import com.iitp.iitp_rest.util.PolygonBoundaryUtils;
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
    // 양끝 노드의 교차로명(node_name)이 같으면 같은 평면교차로의 분리 노드로 보고
    // 넓은 교차로(왕복8차선 교차 시 횡단 40~60m)의 내부링크가 25m를 넘어도 병합 "후보"로.
    // 실제 병합은 클러스터 span 게이트(5b) 통과 시에만 — 이름·길이만으로는 별개 교차로
    // 두 개를 잇는 본선 링크(동부네거리 54m 실측)까지 흡수해 유령 교차로가 생긴다.
    private static final double SAME_NAME_INTERNAL_MAX_M = 60.0;
    /** 같은 교차로명 병합 결과 클러스터의 최대 공간 폭(m). 단일 대형 교차로 폭 상한. */
    private static final double SAME_NAME_CLUSTER_SPAN_M = 50.0;

    // 교차로 setback: 교차로에 모이는 최대 도로폭 + 여유(횡단보도 ~5m + 정지선 이격 ~3m).
    // KTDB는 방향별 링크라 도로폭(차선수×차선폭)이 편도 폭 — 교차로 중심에서 정지선까지는
    // 교차 도로 편도폭 + 횡단보도 + 정지선 이격이 필요 (위성사진 대비 침범 방지). 링크 길이 35% 상한.
    private static final double SETBACK_MIN_M    = 8.0;
    private static final double SETBACK_MAX_M    = 35.0;
    private static final double SETBACK_MARGIN_M = 8.0;
    private static final double SETBACK_MAX_FRAC = 0.35;

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
    // KTDB의 TURNINFO가 못 잡는 회전 금지를 OSM type=restriction으로 보조 검증(실측: 강남 일대
    // bbox에서 13건 발견 — turn_oper='1' 데이터가 없어 각도상 가능하면 그대로 허용되던 사례).
    // turninfoRepo와 동일하게 변환 1회당 한 번만 전체 로드해 메모리에서 조회한다.
    private final OsmTurnRestrictionRepository osmTurnRestrictionRepo;
    private final TerrainSlopeService    terrainSlopeService;

    public record ConvertResult(NetworkXml networkXml) {}

    /** 교차로 회전 동선: 외부 진입/진출 링크쌍 + 내부링크 경유 경로 지오메트리(로컬 좌표) */
    private record ConnData(long fromLinkId, long toLinkId, int turnCode, List<double[]> viaCoords) {}

    public ConvertResult convert(
            double south, double west, double north, double east,
            double baseLat, double baseLon, int networkId) {
        return convert(south, west, north, east, baseLat, baseLon, networkId, null);
    }

    /**
     * @param polygonRings 프론트가 그리거나 SHP/GeoJSON에서 업로드한 경계(WGS84 [lon,lat] 링
     *                     목록, 여러 개면 합집합) — null이면 기존처럼 순수 bbox 사각형 그대로.
     *                     bbox(findByBbox)는 항상 그대로 1차 조회에 쓰이고, 폴리곤은 그 결과를
     *                     한 번 더 걸러내는 애플리케이션 레벨 point-in-polygon 필터로만 작동한다
     *                     (PostGIS는 이 프로젝트에서 검증된 적이 없어 도입하지 않음).
     */
    public ConvertResult convert(
            double south, double west, double north, double east,
            double baseLat, double baseLon, int networkId,
            List<List<double[]>> polygonRings) {

        // ── 1. DB 조회 ────────────────────────────────────────────────────────
        List<KtdbLink> links = linkRepo.findByBbox(west, east, south, north);
        if (links.isEmpty()) throw new IllegalArgumentException("해당 bbox에 KTDB 데이터가 없습니다.");

        // ROAD_USE=1(미사용: 공사중/폐쇄) 링크 제외 — 시뮬레이션 대상 아님
        int beforeUse = links.size();
        links = links.stream()
                .filter(lk -> !"1".equals(lk.getRoadUse()))
                .collect(Collectors.toList());
        if (links.size() < beforeUse) {
            log.info("ROAD_USE=미사용 링크 제외: {}개", beforeUse - links.size());
        }
        if (links.isEmpty()) throw new IllegalArgumentException("해당 bbox에 사용 중인 KTDB 링크가 없습니다.");

        // 폴리곤/파일 경계 필터 — 정점 중 하나라도 경계 내부면 포함(경계를 살짝 걸치는 도로도
        // 자연스럽게 남김, bbox 필터가 원래 갖던 관대함과 동일한 성격). 이 한 곳에서만 걸러내면
        // 이후 노드/차수/클러스터링 로직은 전부 이미 필터링된 links만 순회하므로 추가 수정 불필요.
        if (polygonRings != null && !polygonRings.isEmpty()) {
            int beforePoly = links.size();
            links = links.stream()
                    .filter(lk -> lk.getCoords().stream().anyMatch(pt ->
                            PolygonBoundaryUtils.isInsideAnyRing(pt.get("lng"), pt.get("lat"), polygonRings)))
                    .collect(Collectors.toList());
            log.info("폴리곤 경계 필터: {}개 → {}개", beforePoly, links.size());
            if (links.isEmpty()) throw new IllegalArgumentException("해당 폴리곤 경계 내에 KTDB 링크가 없습니다.");
        }

        // findByNodeIdIn 대신 bbox JOIN 쿼리 사용 — 대용량 bbox에서 IN 파라미터 65535 한도 초과 방지
        Map<String, KtdbNode> nodeMap = nodeRepo.findNodesForBboxLinks(west, east, south, north)
                .stream().collect(Collectors.toMap(KtdbNode::getNodeId, n -> n));

        Set<String> nodeIds = nodeMap.keySet();

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
        // 확정 내부링크(양끝 degree≥3 + <25m)와 같은 교차로명 "후보"(25~60m)를 분리 —
        // 후보는 5b에서 클러스터 span 게이트를 통과해야 병합된다.
        Set<String> internalIds = new HashSet<>();
        List<KtdbLink> sameNameCands = new ArrayList<>();
        for (KtdbLink lk : links) {
            if (!coordsMap.containsKey(lk.getLinkId())) continue;
            double len = calcLength(coordsMap.get(lk.getLinkId()));
            boolean hideg = degree.getOrDefault(lk.getFNode(), 0) >= 3
                    && degree.getOrDefault(lk.getTNode(), 0) >= 3;
            if (hideg && len < INTERNAL_MAX_M) {
                internalIds.add(lk.getLinkId());
                continue;
            }
            KtdbNode fn = nodeMap.get(lk.getFNode()), tn = nodeMap.get(lk.getTNode());
            if (hideg && len < SAME_NAME_INTERNAL_MAX_M
                    && fn != null && tn != null
                    && "101".equals(fn.getNodeType()) && "101".equals(tn.getNodeType())
                    && sameNonBlankName(fn.getNodeName(), tn.getNodeName())) {
                sameNameCands.add(lk);
            }
        }

        // ── 5. 내부 링크로 연결된 노드 클러스터 병합 (Union-Find) ─────────────
        Map<String, String> parent = new HashMap<>();
        for (String nid : nodeIds) parent.put(nid, nid);
        for (KtdbLink lk : links) {
            if (internalIds.contains(lk.getLinkId())) {
                union(parent, lk.getFNode(), lk.getTNode());
            }
        }

        // ── 5b. 같은 교차로명 후보 병합 — 클러스터 span 상한 게이트 ──────────
        // 이름·길이만 믿고 병합하면 별개 교차로 두 개를 잇는 본선 링크(실측: 동부네거리 54m,
        // 양쪽에 12~14m 링 교차로가 각각 존재)까지 흡수되어, 병합 중심(교차로가 아닌 지점)에
        // 유령 노드가 생긴다. 병합 결과 클러스터의 공간 폭이 상한을 넘으면 거부 →
        // 넓은 단일 교차로(≤50m)만 병합되고 인접 교차로 쌍은 분리 유지.
        if (!sameNameCands.isEmpty()) {
            Map<String, double[]> rootMin = new HashMap<>(), rootMax = new HashMap<>();
            for (String nid : nodeIds) {
                KtdbNode n = nodeMap.get(nid);
                if (n == null) continue;
                double[] xy = wgsToLocal(n.getLat(), n.getLon(), baseLat, baseLon);
                String r = find(parent, nid);
                rootMin.merge(r, xy.clone(), (a, b) -> new double[]{Math.min(a[0], b[0]), Math.min(a[1], b[1])});
                rootMax.merge(r, xy.clone(), (a, b) -> new double[]{Math.max(a[0], b[0]), Math.max(a[1], b[1])});
            }
            sameNameCands.sort(Comparator
                    .comparingDouble((KtdbLink lk) -> calcLength(coordsMap.get(lk.getLinkId())))
                    .thenComparing(KtdbLink::getLinkId));
            int merged = 0;
            for (KtdbLink lk : sameNameCands) {
                String ra = find(parent, lk.getFNode()), rb = find(parent, lk.getTNode());
                if (ra.equals(rb)) { internalIds.add(lk.getLinkId()); continue; } // 이미 같은 클러스터 내부
                double[] mn1 = rootMin.get(ra), mx1 = rootMax.get(ra);
                double[] mn2 = rootMin.get(rb), mx2 = rootMax.get(rb);
                if (mn1 == null || mn2 == null) continue;
                double spanX = Math.max(mx1[0], mx2[0]) - Math.min(mn1[0], mn2[0]);
                double spanY = Math.max(mx1[1], mx2[1]) - Math.min(mn1[1], mn2[1]);
                if (Math.max(spanX, spanY) > SAME_NAME_CLUSTER_SPAN_M) continue; // 별개 교차로 쌍 — 병합 거부
                union(parent, lk.getFNode(), lk.getTNode());
                String nr = find(parent, lk.getFNode());
                rootMin.put(nr, new double[]{Math.min(mn1[0], mn2[0]), Math.min(mn1[1], mn2[1])});
                rootMax.put(nr, new double[]{Math.max(mx1[0], mx2[0]), Math.max(mx1[1], mx2[1])});
                internalIds.add(lk.getLinkId());
                merged++;
            }
            log.info("같은 교차로명 병합: 후보 {}개 중 {}개 병합 (span {}m 게이트)",
                    sameNameCands.size(), merged, SAME_NAME_CLUSTER_SPAN_M);
        }
        log.info("교차로 내부 링크: {}개", internalIds.size());

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

        // ── 7. 외부 링크 선별 (self-loop 사전 제거) ─────────────────────────
        // f_node와 t_node가 같은 클러스터에 속하면 self-loop → 대상에서 완전 제외
        // 이 시점에 제외해야 포트/connection에도 등록되지 않음
        List<KtdbLink> externalLinks = new ArrayList<>();
        for (KtdbLink lk : links) {
            if (internalIds.contains(lk.getLinkId())) continue;
            if (!coordsMap.containsKey(lk.getLinkId())) continue;
            String fRep = nodeToCluster.get(lk.getFNode());
            String tRep = nodeToCluster.get(lk.getTNode());
            if (fRep != null && fRep.equals(tRep)) continue; // self-loop 제외
            externalLinks.add(lk);
        }

        // ── 8. 클러스터별 in/out 외부 링크 수집 (ID 배정 전에 degree 확정) ──
        Map<String, List<KtdbLink>> clusterIn  = new LinkedHashMap<>();
        Map<String, List<KtdbLink>> clusterOut = new LinkedHashMap<>();
        for (KtdbLink lk : externalLinks) {
            String tRep = nodeToCluster.get(lk.getTNode());
            String fRep = nodeToCluster.get(lk.getFNode());
            if (tRep != null) clusterIn.computeIfAbsent(tRep,  k -> new ArrayList<>()).add(lk);
            if (fRep != null) clusterOut.computeIfAbsent(fRep, k -> new ArrayList<>()).add(lk);
        }

        // ── 6+7. Link/클러스터(=교차로 노드) ID 부여 (Network ID naming 스펙) ──
        // Link=2, Node(교차로)=1, Terminal(차량 출입점)=11 로 시작하는 8자리 숫자.
        // Link와 일반 Node는 생성 순서(=외부 링크 원본 순서로 스캔)에 따라 하나의 인덱스를
        // 공유하고, Terminal은 연결된 단 하나의 Link와 뒷자리 3자리가 동일해야 한다(스펙
        // 예시: Link 20000326 ↔ Terminal 11000326) — 링크를 스캔하며 그 자리에서 endpoint
        // 클러스터를 처음 만나면 바로 배정하면 두 규칙을 한 번에 만족한다.
        // Terminal/Node 대역 분리(11xxxxxx/10xxxxxx) 자체는 NextSim route-generator 실측
        // 크래시(std::out_of_range) 회피를 위해 원래도 필요했던 것(KAIST 배포판 bucheon/toy
        // grid 예시가 이렇게 분리돼 있어 우연히 이 버그를 피해간 것으로 gdb 역공학 확인) — 그대로 유지.
        Map<String, Long> linkIdMap    = new LinkedHashMap<>();
        Map<String, Long> clusterIdMap = new LinkedHashMap<>();
        NetworkIdAssigner idAssigner = new NetworkIdAssigner();
        for (KtdbLink lk : externalLinks) {
            long linkId = idAssigner.nextLinkId();
            linkIdMap.put(lk.getLinkId(), linkId);
            // 양 끝이 둘 다 터미널(완전히 고립된 신규 세그먼트 등)이면 뒷자리 파생은 한쪽에만
            // 적용 — 안 그러면 둘 다 같은 링크에서 파생돼 서로 다른 두 노드가 같은 id를 갖게 됨.
            boolean derivedTerminalUsed = false;
            for (String rep : new String[]{nodeToCluster.get(lk.getFNode()), nodeToCluster.get(lk.getTNode())}) {
                if (rep == null || clusterIdMap.containsKey(rep)) continue;
                int clusterDegree = clusterIn.getOrDefault(rep, List.of()).size()
                        + clusterOut.getOrDefault(rep, List.of()).size();
                if (clusterDegree > 1) {
                    clusterIdMap.put(rep, idAssigner.nextNormalNodeId());
                } else if (!derivedTerminalUsed) {
                    clusterIdMap.put(rep, idAssigner.terminalIdFor(linkId));
                    derivedTerminalUsed = true;
                } else {
                    clusterIdMap.put(rep, idAssigner.nextIsolatedTerminalId());
                }
            }
        }
        // 어느 외부 링크에도 연결되지 않은 고립 클러스터(비정상 데이터) — 페어링할 Link가 없어 fallback
        for (String rep : clusterReps) {
            clusterIdMap.putIfAbsent(rep, idAssigner.nextIsolatedTerminalId());
        }

        // 우리 linkId → 차선 수/차선 폭 역인덱스 (connection 차선 번호·차선별 shape 계산용)
        Map<Long, Integer> ourIdToLanes = new HashMap<>();
        Map<Long, Double>  ourIdToLaneWidth = new HashMap<>();
        for (KtdbLink lk : links) {
            Long ourId = linkIdMap.get(lk.getLinkId());
            if (ourId != null) {
                ourIdToLanes.put(ourId, Math.max(1, lk.getLanes()));
                ourIdToLaneWidth.put(ourId, RANK_DEFS.getOrDefault(lk.getRoadRank(), DEFAULT_DEFS)[2]);
            }
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
        // 교차로 진입/진출 링크의 끝점을 후퇴시켜 링크가 교차로를 침범하지 않게 함.
        // → 링크는 교차로 직전에서 끊기고, 교차로 내부는 connection만 표현.
        // 교차로 판정: merged cluster 또는 이웃 클러스터 3개 이상(단일 노드 교차로 포함).
        // setback 거리: 교차로에 모이는 최대 도로폭 기반 동적 산출 (고정 5m는 다차선 도로 침범).
        Map<String, Set<String>> clusterNeighbors = new HashMap<>();
        Map<String, Double> clusterMaxRoadWidth = new HashMap<>();
        for (KtdbLink lk : links) {
            if (!linkIdMap.containsKey(lk.getLinkId())) continue;
            String[] eps = linkClusterEndpoints.get(lk.getLinkId());
            if (eps == null || eps[0] == null || eps[1] == null) continue;
            double roadWidth = Math.max(1, lk.getLanes())
                    * RANK_DEFS.getOrDefault(lk.getRoadRank(), DEFAULT_DEFS)[2];
            clusterNeighbors.computeIfAbsent(eps[0], k -> new HashSet<>()).add(eps[1]);
            clusterNeighbors.computeIfAbsent(eps[1], k -> new HashSet<>()).add(eps[0]);
            clusterMaxRoadWidth.merge(eps[0], roadWidth, Math::max);
            clusterMaxRoadWidth.merge(eps[1], roadWidth, Math::max);
        }

        for (String lkId : linkIdMap.keySet()) {
            List<double[]> coords = coordsMap.get(lkId);
            if (coords == null || coords.size() < 2) continue;
            String[] eps = linkClusterEndpoints.get(lkId);
            if (eps == null) continue;

            String fRep = eps[0], tRep = eps[1];
            double linkLen = calcLength(coords);

            // 진입 끝점 setback: t_node가 교차로 → 마지막 점을 노드 방향으로 후퇴
            if (isJunctionCluster(tRep, clusterNodeCount, clusterNeighbors)) {
                double[] nodePos = clusterLocalCoord.get(tRep);
                if (nodePos != null) {
                    double setback = Math.min(setbackFor(tRep, clusterMaxRoadWidth),
                            linkLen * SETBACK_MAX_FRAC);
                    List<double[]> trimmed = trimEnd(coords, nodePos, setback);
                    coords.clear(); coords.addAll(trimmed);
                }
            }
            // 진출 시작점 setback: f_node가 교차로 → 첫 점을 노드 방향으로 후퇴
            if (isJunctionCluster(fRep, clusterNodeCount, clusterNeighbors)) {
                double[] nodePos = clusterLocalCoord.get(fRep);
                if (nodePos != null) {
                    double setback = Math.min(setbackFor(fRep, clusterMaxRoadWidth),
                            linkLen * SETBACK_MAX_FRAC);
                    List<double[]> trimmed = trimStart(coords, nodePos, setback);
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

        // 내부 링크 방향 그래프: fNode → 내부링크 목록 (이동 가능 경로 + 커넥션 경유 지오메트리)
        Map<String, List<KtdbLink>> internalAdj = new HashMap<>();
        for (KtdbLink intLk : links) {
            if (!internalIds.contains(intLk.getLinkId())) continue;
            internalAdj.computeIfAbsent(intLk.getFNode(), k -> new ArrayList<>())
                    .add(intLk);
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

        // OSM 회전제약 매처 — TURNINFO가 못 잡는 금지를 보조로 걸러낸다(아래 커넥션 후보 루프에서 사용).
        OsmTurnRestrictionMatcher osmTurnMatcher = osmTurnRestrictionRepo.hasData()
                ? new OsmTurnRestrictionMatcher(osmTurnRestrictionRepo.loadAll())
                : null;

        // clusterRep → 회전 동선 목록 (경유 내부링크 지오메트리 포함)
        Map<String, List<ConnData>> clusterConnData = new HashMap<>();

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

                // BFS: entryNode에서 출발해 내부 링크를 통해 도달 가능한 모든 노드 탐색.
                // viaEdge(노드→진입 내부링크)로 최단 경로를 복원해 커넥션 shape의 경유 지오메트리로 사용.
                Set<String> visited = new HashSet<>();
                Queue<String> queue = new LinkedList<>();
                Map<String, KtdbLink> viaEdge = new HashMap<>();
                visited.add(entryNode);
                queue.add(entryNode);

                while (!queue.isEmpty()) {
                    String cur = queue.poll();
                    // entryNode→cur 경유 내부링크 지오메트리 (같은 노드면 빈 목록 = 직결)
                    List<double[]> viaCoords = reconstructInternalPath(entryNode, cur, viaEdge, coordsMap);
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

                            // OSM 회전제약 금지 체크 — TURNINFO에 없는 실제 금지를 보조로 걸러냄
                            // (실측: 강남 일대에서 이렇게만 잡히는 사례 13건 확인). KtdbNode의 lat/lon
                            // 은 local x/y와 별개로 원본 WGS84 좌표라 그대로 쓸 수 있다.
                            if (osmTurnMatcher != null) {
                                KtdbNode entryKtdbNode = nodeMap.get(entryNodeForTurn);
                                if (entryKtdbNode != null) {
                                    String osmProhibition = osmTurnMatcher.findProhibition(
                                            entryKtdbNode.getLat(), entryKtdbNode.getLon(), inBearing, outBearing);
                                    if (osmProhibition != null) continue;
                                }
                            }

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

                            // U턴(TURNINFO 011, 명시 허용으로 게이트 통과)은 좌측 회전 —
                            // determineTurning은 방위차 ≤180°를 우회전으로 오분류하므로 Left_Turn 강제
                            // (Turning enum에 U턴 없음. TURNINFO 코드 실측: 011=유턴 99%, 101=좌회전 기하)
                            Turning turning = isUTurn ? Turning.Left_Turn
                                                      : determineTurning(inBearing, outBearing);
                            clusterConnData.computeIfAbsent(rep, k -> new ArrayList<>())
                                    .add(new ConnData(fromLinkId, toLinkId,
                                            turning == Turning.Left_Turn  ? 0 :
                                            turning == Turning.Right_Turn ? 2 : 1,
                                            viaCoords));
                        }
                    }
                    // 내부 링크를 통해 이동 가능한 다음 노드 추가 (진입에 쓴 링크를 viaEdge에 기록)
                    for (KtdbLink intLk : internalAdj.getOrDefault(cur, List.of())) {
                        if (visited.add(intLk.getTNode())) {
                            viaEdge.put(intLk.getTNode(), intLk);
                            queue.add(intLk.getTNode());
                        }
                    }
                }
            }
        }

        // ── 11. 노드 생성 ────────────────────────────────────────────────────
        // 클러스터 대표 원본 속성: NODE_NAME(교차로명) / NODE_TYPE=101(평면교차로) 존재 여부
        Map<String, String>  clusterName  = new HashMap<>();
        Map<String, Boolean> clusterIsItx = new HashMap<>();
        for (String nid : nodeIds) {
            KtdbNode n = nodeMap.get(nid);
            if (n == null) continue;
            String rep = nodeToCluster.get(nid);
            if (n.getNodeName() != null && !n.getNodeName().isBlank()) {
                clusterName.merge(rep, n.getNodeName(), (a, b) -> a); // 첫 비공백 이름 유지
            }
            if ("101".equals(n.getNodeType())) clusterIsItx.put(rep, true);
        }

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
                        inPortIds, outPortIds, coordsMap, linkIdMap, ourIdToLanes, ourIdToLaneWidth);
            } else {
                // 단순 노드(merge 없음): in-link 하나 → out-link 하나의 통과 연결
                conns = buildPassthroughConnections(ins, outs, inPortIds, outPortIds, linkIdMap, coordsMap);
            }

            NodeXml nx = new NodeXml();
            nx.setId(ourNodeId);
            // 원본 NODE_TYPE=101(평면교차로)이면 degree 기반 추정을 Intersection으로 오버라이드
            // (좌회전 connection이 있어도 in/out 수가 같지 않으면 Merging/Diverging으로 잘못 분류되던 것 보정)
            NodeType degreeType = classifyNodeType(ins.size(), outs.size());
            boolean ktdbSaysItx = Boolean.TRUE.equals(clusterIsItx.get(rep))
                    && ins.size() >= 1 && outs.size() >= 1 && ins.size() + outs.size() >= 3;
            nx.setType(ktdbSaysItx ? NodeType.Intersection : degreeType);
            String nodeName = clusterName.get(rep);
            if (nodeName != null) nx.setName(nodeName);
            nx.setCenter(fmt3(lxy[0]) + " " + fmt3(lxy[1]));
            nx.setPorts(ports);
            nx.setNumPort(ports.size());
            nx.setConnections(conns);
            nx.setNumConnection(conns.size());
            nodeList.add(nx);
        }

        // ── 11. 링크 생성 ─────────────────────────────────────────────────────
        List<LinkXml> linkList = new ArrayList<>();
        // 종단경사(section) 계산용 — WGS84 원본 좌표(로컬 좌표 coordsMap과 별개, DEM 조회는 경위도로 해야 함)
        Map<Long, List<Map<String, Double>>> wgsCoordsById = new HashMap<>();
        Map<Long, Double> lengthById = new HashMap<>();
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
            // 도로명: ROAD_NAME 우선, 없으면 노선번호 표기 (중용구간 노선명은 ktdb_multilink 참조)
            String name = lk.getRoadName();
            if ((name == null || name.isBlank()) && lk.getRoadNo() != null && !lk.getRoadNo().isBlank()) {
                name = "노선 " + lk.getRoadNo();
            }
            if (name != null && !name.isBlank()) lx.setName(name);
            lx.setLayer(structureLayer(lk));
            lx.setStopLine(0.0);
            lx.setShape(shape);
            lx.setLanes(buildLanes(lanes, length, shape));
            linkList.add(lx);

            wgsCoordsById.put(ourId, lk.getCoords());
            lengthById.put(ourId, length);
        }

        // 종단경사(section) — DEM 미설정 시(로컬 개발 등) 빈 맵을 받아 기존과 동일하게 무동작
        Map<Long, List<SectionXml>> sectionsById = terrainSlopeService.computeSections(wgsCoordsById, lengthById);
        if (!sectionsById.isEmpty()) {
            for (LinkXml lx : linkList) {
                List<SectionXml> sections = sectionsById.get(lx.getId());
                if (sections != null) lx.setSections(sections);
            }
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
     * BFS viaEdge 체인을 따라 entryNode→cur 경유 내부링크들의 좌표를 진행 순서로 이어붙임.
     * 인접 중복점(링크 이음새)은 제거. 커넥션 shape가 교차로 내부의 실제 동선(교통섬 순환,
     * 회전 곡선)을 따라가도록 하는 경유 지오메트리.
     */
    private List<double[]> reconstructInternalPath(String entryNode, String cur,
            Map<String, KtdbLink> viaEdge, Map<String, List<double[]>> coordsMap) {
        if (entryNode.equals(cur)) return List.of();
        List<KtdbLink> chain = new ArrayList<>();
        String n = cur;
        while (!n.equals(entryNode)) {
            KtdbLink e = viaEdge.get(n);
            if (e == null) return List.of(); // 방어: 체인 단절 시 직결로 폴백
            chain.add(e);
            n = e.getFNode();
            if (chain.size() > 64) return List.of(); // 방어: 비정상 순환
        }
        Collections.reverse(chain);
        List<double[]> pts = new ArrayList<>();
        for (KtdbLink e : chain) {
            List<double[]> c = coordsMap.get(e.getLinkId());
            if (c == null) continue;
            for (double[] p : c) {
                if (!pts.isEmpty() && dist(pts.get(pts.size() - 1), p) < 1e-6) continue;
                pts.add(p);
            }
        }
        return pts;
    }

    /**
     * 교차로 노드용: 내부 링크로부터 파생된 실제 회전 동선.
     * shape는 [진입 차선 끝점] + 내부링크 경유 지오메트리 + [진출 차선 시작점] 폴리라인 —
     * 직선 2점이면 교통섬 순환/회전 곡선이 교차로를 가로지르는 직선으로 뭉개진다.
     */
    private List<ConnectionXml> buildConnectionsFromInternalLinks(
            List<ConnData> connData,
            Set<Long> inPortIds, Set<Long> outPortIds,
            Map<String, List<double[]>> coordsMap,
            Map<String, Long> linkIdMap,
            Map<Long, Integer> ourIdToLanes,
            Map<Long, Double>  ourIdToLaneWidth) {

        Map<Long, String> reverseMap = new HashMap<>();
        for (Map.Entry<String, Long> e : linkIdMap.entrySet()) reverseMap.put(e.getValue(), e.getKey());

        List<ConnectionXml> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        long connId = 0;

        for (ConnData cd : connData) {
            long fromLinkId = cd.fromLinkId(), toLinkId = cd.toLinkId();
            if (!inPortIds.contains(fromLinkId) || !outPortIds.contains(toLinkId)) continue;

            String key = fromLinkId + ":" + toLinkId;
            if (!seen.add(key)) continue; // BFS 방문 순서상 첫 등록이 최단 경로

            String fromKtdbId = reverseMap.get(fromLinkId);
            String toKtdbId   = reverseMap.get(toLinkId);
            if (fromKtdbId == null || toKtdbId == null) continue;

            List<double[]> fromCoords = coordsMap.get(fromKtdbId);
            List<double[]> toCoords   = coordsMap.get(toKtdbId);
            if (fromCoords == null || toCoords == null) continue;

            Turning turning = cd.turnCode() == 0 ? Turning.Left_Turn :
                              cd.turnCode() == 2 ? Turning.Right_Turn : Turning.Straight;
            double connFf  = turning == Turning.Left_Turn  ? 20.0 :
                             turning == Turning.Right_Turn ? 25.0 : 30.0;

            int inLanes  = ourIdToLanes.getOrDefault(fromLinkId, 1);
            int outLanes = ourIdToLanes.getOrDefault(toLinkId,   1);
            double inW   = ourIdToLaneWidth.getOrDefault(fromLinkId, 3.0);
            double outW  = ourIdToLaneWidth.getOrDefault(toLinkId,   3.0);

            for (int[] pair : lanePairs(turning, inLanes, outLanes)) {
                // 커넥션은 차선↔차선 연결 — 링크 중심선이 아니라 해당 차선의 끝점에서 시작/종료
                double[] from = laneEndpoint(fromCoords, true,  pair[0], inLanes,  inW);
                double[] to   = laneEndpoint(toCoords,   false, pair[1], outLanes, outW);

                List<double[]> pts = new ArrayList<>(cd.viaCoords().size() + 2);
                pts.add(from);
                for (double[] p : cd.viaCoords()) {
                    if (dist(pts.get(pts.size() - 1), p) < 1e-6) continue;
                    pts.add(p);
                }
                if (dist(pts.get(pts.size() - 1), to) >= 1e-6) pts.add(to);

                double connLen = Math.max(1.0, calcLength(pts));
                if (pts.size() < 2) {
                    // from/via/to 가 전부 사실상 같은 지점 — shape 가 점 1개로 뭉개지면 length=1.0
                    // 과 불일치하는 축퇴 지오메트리가 된다(위 buildPassthroughConnections 와 동일 문제).
                    // out-link 진행 방향으로 connLen 만큼 밀어낸 두 번째 점을 추가해 실제 길이를 갖는 shape 로 만든다.
                    double[] base = pts.get(0);
                    double[] dir = departureUnit(toCoords);
                    pts.add(new double[]{base[0] + dir[0] * connLen, base[1] + dir[1] * connLen});
                }
                StringBuilder shape = new StringBuilder();
                for (double[] p : pts) {
                    if (shape.length() > 0) shape.append(' ');
                    shape.append(fmt5(p[0])).append(',').append(fmt5(p[1]));
                }

                ConnectionXml conn = new ConnectionXml();
                conn.setId(connId++);
                conn.setFromLink(fromLinkId);
                conn.setFromLane((long) pair[0]);
                conn.setToLink(toLinkId);
                conn.setToLane((long) pair[1]);
                conn.setTurning(turning);
                conn.setLength(round2(connLen));
                conn.setWidth(3.0);
                conn.setFfSpd(round2(connFf));
                conn.setShape(shape.toString());
                result.add(conn);
            }
        }
        return result;
    }

    /**
     * 링크 중심선 좌표에서 특정 차선의 끝점(atEnd=true: 마지막 점, false: 첫 점)을 계산.
     * 프론트 렌더 규약과 동일: 차선 i 오프셋 = ((laneCount-1)/2 - i) × laneWidth,
     * 진행방향 왼쪽 법선(+) 기준 (차선 0 = 최좌측).
     */
    private double[] laneEndpoint(List<double[]> coords, boolean atEnd,
                                  int laneIdx, int laneCount, double laneWidth) {
        double[] pt, p1, p2;
        if (atEnd) { pt = coords.get(coords.size() - 1); p1 = coords.get(coords.size() - 2); p2 = pt; }
        else       { pt = coords.get(0);                 p1 = pt; p2 = coords.get(1); }
        double dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        double len = Math.hypot(dx, dy);
        if (len < 1e-9) return pt;
        double off = ((laneCount - 1) / 2.0 - laneIdx) * laneWidth;
        return new double[]{pt[0] + (-dy / len) * off, pt[1] + (dx / len) * off};
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

                double[] defs   = RANK_DEFS.getOrDefault(outLk.getRoadRank(), DEFAULT_DEFS);
                double[] inDefs = RANK_DEFS.getOrDefault(inLk.getRoadRank(),  DEFAULT_DEFS);
                double connFf  = switch (turning) {
                    case Left_Turn  -> Math.min(30.0, outLk.getMaxSpd());
                    case Right_Turn -> Math.min(35.0, outLk.getMaxSpd());
                    default          -> outLk.getMaxSpd();
                };

                int inLanes  = Math.max(1, inLk.getLanes());
                int outLanes = Math.max(1, outLk.getLanes());
                for (int[] pair : lanePairs(turning, inLanes, outLanes)) {
                    // 커넥션은 차선↔차선 연결 — 해당 차선의 끝점 기준
                    double[] from = laneEndpoint(inCoords,  true,  pair[0], inLanes,  inDefs[2]);
                    double[] to   = laneEndpoint(outCoords, false, pair[1], outLanes, defs[2]);
                    double dx = to[0] - from[0], dy = to[1] - from[1];
                    double rawLen = Math.sqrt(dx * dx + dy * dy);
                    double connLen = Math.max(1.0, rawLen);
                    // 오프셋 없는 단일 차선끼리는 두 끝점이 사실상 같은 지점이 되어 shape가
                    // 길이 0(시작=끝점)으로 뭉개진다 — length 는 위에서 최소 1.0 로 보정하지만
                    // shape 좌표는 그대로 두면 "length=1.0인데 shape는 0m"인 불일치 데이터가 됨.
                    // NextSim 이 이런 축퇴 지오메트리 근처에서 불안정하게 동작하는 경향이 관측되어
                    // (out-link 진행 방향으로 connLen 만큼 밀어낸) 실제 길이를 가진 shape 로 대체.
                    double[] shapeTo = to;
                    if (rawLen < 1e-6) {
                        double[] dir = departureUnit(outCoords);
                        shapeTo = new double[]{from[0] + dir[0] * connLen, from[1] + dir[1] * connLen};
                    }

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
                    conn.setShape(fmt5(from[0])    + "," + fmt5(from[1]) + " " +
                                  fmt5(shapeTo[0]) + "," + fmt5(shapeTo[1]));
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

    /** 두 교차로명이 모두 비어있지 않고 동일한지 (KTDB 표준: 같은 평면교차로의 분리 노드는 교차로명 공유) */
    private boolean sameNonBlankName(String a, String b) {
        return a != null && !a.isBlank() && a.equals(b);
    }

    // ── Setback 트리밍 ────────────────────────────────────────────────────────

    /** 교차로 판정: merged cluster 또는 이웃 클러스터 3개 이상 (경유 노드는 이웃 2개 → 제외) */
    private boolean isJunctionCluster(String rep,
            Map<String, Integer> clusterNodeCount,
            Map<String, Set<String>> clusterNeighbors) {
        if (rep == null) return false;
        if (clusterNodeCount.getOrDefault(rep, 1) > 1) return true;
        return clusterNeighbors.getOrDefault(rep, Set.of()).size() >= 3;
    }

    /** 교차로별 setback 거리: 모이는 최대 도로폭 + 여유, [MIN, MAX] 클램프 */
    private double setbackFor(String rep, Map<String, Double> clusterMaxRoadWidth) {
        double w = clusterMaxRoadWidth.getOrDefault(rep, 0.0);
        return Math.min(SETBACK_MAX_M, Math.max(SETBACK_MIN_M, w + SETBACK_MARGIN_M));
    }

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

    /** out-link 첫 구간의 진행 방향 단위벡터 — 축퇴(0길이) 커넥션 shape 보정용 */
    private double[] departureUnit(List<double[]> coords) {
        if (coords == null || coords.size() < 2) return new double[]{1.0, 0.0};
        double[] p1 = coords.get(0), p2 = coords.get(1);
        double dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        double len = Math.hypot(dx, dy);
        return len < 1e-9 ? new double[]{1.0, 0.0} : new double[]{dx / len, dy / len};
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

    /**
     * 링크 layer 문자열: 원본 구조물유형(ROAD_TYPE)·연결로(CONNECT) 보존.
     * 000/일반이면 빈 문자열(기존 동작 유지). 렌더링·포켓 합성 제외 규칙 등에 활용.
     */
    private String structureLayer(KtdbLink lk) {
        String rt = lk.getRoadType();
        String structure = switch (rt == null ? "" : rt) {
            case "001" -> "elevated";   // 고가차도
            case "002" -> "underpass";  // 지하차도
            case "003" -> "bridge";     // 교량
            case "004" -> "tunnel";     // 터널
            default    -> "";
        };
        boolean ramp = lk.getConnect() != null && !lk.getConnect().isBlank() && !"0".equals(lk.getConnect());
        if (ramp) return structure.isEmpty() ? "ramp" : structure + ",ramp";
        return structure;
    }

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
