package com.iitp.iitp_rest.service.network;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.connection.Turning;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.link.LinkType;
import com.iitp.iitp_rest.model.network.link.SimType;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeType;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamWriter;
import java.io.*;
import java.util.*;

/**
 * 대용량 BBox(전국 포함)용 KTDB 스트리밍 변환기.
 *
 * - JDBC 커서 스트리밍 (JPA 대량 로딩 없음)
 * - 0.1° 타일 분할 → 타일당 ~5,000링크, 메모리 O(tile)
 * - 전체 XML을 임시 파일에 기록 후 SFTP 스트리밍 업로드
 * - 응답: 간소화 (노드 id+좌표, 링크 id+from+to)
 *
 * 내부 링크(≤25m)는 항상 단일 타일 안에 있으므로
 * 타일별 Union-Find가 전국 규모에서도 정확하다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KtdbStreamingConverter {

    public static final double LARGE_BBOX_THRESHOLD = 0.3 * 0.3; // ~33km² 초과 시 스트리밍 모드

    private static final double TILE_SIZE      = 0.1;   // ~11km
    private static final double INTERNAL_MAX_M = 25.0;
    // 양끝 노드의 교차로명(node_name)이 같으면 같은 평면교차로의 분리 노드로 보고
    // 넓은 교차로(왕복8차선 교차 시 횡단 40~60m)의 내부링크가 25m를 넘어도 병합 "후보"로.
    // 실제 병합은 클러스터 span 게이트(6b) 통과 시에만 — 이름·길이만으로는 별개 교차로
    // 두 개를 잇는 본선 링크(동부네거리 54m 실측)까지 흡수해 유령 교차로가 생긴다.
    private static final double SAME_NAME_INTERNAL_MAX_M = 60.0;
    /** 같은 교차로명 병합 결과 클러스터의 최대 공간 폭(m). 단일 대형 교차로 폭 상한. */
    private static final double SAME_NAME_CLUSTER_SPAN_M = 50.0;
    /** 타일 경계 버퍼(~330m). 경계에 걸친 내부링크(같은 교차로명 병합 시 최대 ~100m, 체인 시 그 이상)의
     *  degree/union-find가 어느 타일에서든 완전하게 보이도록 조회 bbox를 확장 —
     *  교차로 클러스터가 타일 경계에서 갈라지는 것 방지.
     *  (중복 조회분은 seenLinkIds/putIfAbsent로 멱등, 대표는 사전식 최솟값이라 타일 간 결정적) */
    private static final double TILE_BUF_DEG   = 0.003;
    private static final double SCALE_X        = 88000.0;
    private static final double SCALE_Y        = 111000.0;
    private static final double BASE_CELL_LEN  = 69.44;
    private static final double JAM_DENSITY    = 150.0;
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

    // ── 경량 내부 레코드 ──────────────────────────────────────────────────────

    private record TNode(String id, double lat, double lon, String name, String nodeType) {}
    private record TLink(String id, String fNode, String tNode, int lanes, int roadRank,
                         int maxSpd, double[] latLons,
                         String roadName, String roadType, String connect) {} // latLons: [lat0,lon0,...]

    private record ClusterInfo(long id, double wgsLat, double wgsLon,
                                double localX, double localY, int memberCount,
                                String name, boolean ktdbItx) {}

    // 외부 링크 (전역 누적용): localCoords = [x0,y0,x1,y1,...] 로컬 좌표
    // fNode/tNode: KTDB 부착 노드 id — 클러스터 내부 도달성(회전 동선 허용) 판정용
    // id: Network ID naming 스펙에 맞춘 최종 링크 id(2xxxxxxx) — assignFinalIds()가 부여.
    // origId: 원본 KTDB stableId — TURNINFO(ktdb_turninfo)가 원본 id로 키잉되어 있어
    //         id가 재채번된 뒤에도 TURNINFO 매칭에는 이 값을 써야 한다.
    private record ExtLink(long id, long origId, long fromCluster, long toCluster,
                           int numLane, double length, double maxSpd,
                           double[] localCoords, String shape, int roadRank,
                           String name, String layer, String fNode, String tNode) {}

    private record ConnTuple(long fromLink, int fromLane, long toLink, int toLane,
                              Turning turning, double connLen, String connShape) {}

    /** 클러스터 내부링크 에지: 도달성 판정 + 커넥션 shape 경유 지오메트리 (coords: 로컬 flat [x,y,...]) */
    private record InternalEdge(String toNode, double[] coords) {}

    // ── 외부 결과 레코드 ──────────────────────────────────────────────────────

    public record StreamResult(int nodeCount, int linkCount,
                                List<NodeResponse> nodes, List<LinkResponse> links,
                                List<String> warnings,
                                List<Long> sourceTerminalIds, List<Long> sinkTerminalIds) {}

    // ── DI ───────────────────────────────────────────────────────────────────

    private final JdbcTemplate       jdbc;
    private final ObjectMapper        objectMapper;
    private final FileStorageService  fileStorage;
    // KtdbNetworkConverter와 동일 — TURNINFO가 못 잡는 회전 금지를 OSM으로 보조 검증
    private final OsmTurnRestrictionRepository osmTurnRestrictionRepo;

    // ── 메인 엔트리포인트 ─────────────────────────────────────────────────────

    public StreamResult streamConvert(
            double south, double west, double north, double east,
            double baseLat, double baseLon, int networkId,
            String versionId) throws Exception {

        // 전역 상태
        Map<String, Long>    nodeToClusterId   = new HashMap<>();
        Map<Long, ClusterInfo> clusters        = new LinkedHashMap<>();
        Map<Long, Integer>   clusterMemberCnt  = new HashMap<>();
        Set<String>          seenLinkIds       = new HashSet<>();
        List<ExtLink>        allLinks          = new ArrayList<>();
        Map<Long, List<ExtLink>> clusterIn     = new HashMap<>();
        Map<Long, List<ExtLink>> clusterOut    = new HashMap<>();
        // 클러스터별 내부링크 방향 그래프: clusterId → (fNode → 진출 에지들).
        // 회전 동선 허용 판정(도달성) + 커넥션 shape의 경유 지오메트리 복원에 사용
        // (일반 변환기 BFS와 동일 의미 — 전조합 과생성 방지 + 교통섬 순환 곡선 유지)
        Map<Long, Map<String, List<InternalEdge>>> clusterInternalAdj = new HashMap<>();
        Set<String> seenInternalLinkIds = new HashSet<>();

        int tilesDone  = 0;
        int tilesTotal = (int)(Math.ceil((north - south) / TILE_SIZE)
                             * Math.ceil((east  - west)  / TILE_SIZE));

        for (double latMin = south; latMin < north; latMin += TILE_SIZE) {
            for (double lonMin = west; lonMin < east; lonMin += TILE_SIZE) {
                double latMax = Math.min(latMin + TILE_SIZE, north);
                double lonMax = Math.min(lonMin + TILE_SIZE, east);
                processTile(latMin, lonMin, latMax, lonMax, baseLat, baseLon,
                        nodeToClusterId, clusters, clusterMemberCnt,
                        seenLinkIds, allLinks, clusterIn, clusterOut,
                        clusterInternalAdj, seenInternalLinkIds);
                tilesDone++;
                if (tilesDone % 100 == 0 || tilesDone == tilesTotal)
                    log.info("타일 {}/{} — 클러스터 {}개, 링크 {}개",
                            tilesDone, tilesTotal, clusters.size(), allLinks.size());
            }
        }

        if (clusters.isEmpty())
            throw new IllegalArgumentException("해당 bbox에 KTDB 데이터가 없습니다.");

        // Link/Node 최종 id 재부여 (Network ID naming 스펙) — Link=2, Node(교차로)=1,
        // Terminal(출입구)=11 로 시작하는 8자리 숫자. Link와 일반 Node는 생성 순서(=allLinks
        // 누적 순서로 스캔)에 따라 하나의 인덱스를 공유하고, Terminal은 연결된 단 하나의
        // Link와 뒷자리 3자리가 동일해야 한다. 원본 KTDB id(stableId)를 그대로 쓰면 Link에
        // 접두사가 없을뿐더러, 터미널/일반 노드가 같은 id 공간에 뒤섞여 route-generator 내부
        // 배열 인덱싱이 범위를 벗어나 std::out_of_range(_Map_base::at) 로 크래시함(gdb 역공학
        // 확인 — KAIST 배포판 bucheon/toy grid 예시가 전부 terminal=11xxxxxx, 그 외=10xxxxxx로
        // 분리돼 있어 우연히 이 버그를 피해간 것). Terminal/Node 대역 분리는 그대로 유지.
        assignFinalIds(clusters, clusterMemberCnt, clusterIn, clusterOut,
                clusterInternalAdj, allLinks);

        // TURNINFO 로드 (전국 4.4만 건 — 전량 메모리 적재 가능).
        // key: "stLinkId:edLinkId" (stableId 기준). 금지(turn_oper=1)는 커넥션 제외,
        // 그 외(011 U턴 등)는 기하학적 U턴 게이트의 명시 허용 목록으로 사용.
        Set<String> prohibitedPairs = new HashSet<>();
        Set<String> allowedPairs    = new HashSet<>();
        try {
            jdbc.query("SELECT st_link, ed_link, turn_oper FROM ktdb_turninfo",
                    (RowCallbackHandler) rs -> {
                        String key = stableId(rs.getString("st_link")) + ":" + stableId(rs.getString("ed_link"));
                        if ("1".equals(rs.getString("turn_oper"))) prohibitedPairs.add(key);
                        else allowedPairs.add(key);
                    });
            log.info("TURNINFO 로드: 허용 {}건, 금지 {}건", allowedPairs.size(), prohibitedPairs.size());
        } catch (Exception e) {
            log.warn("TURNINFO 로드 실패 (기하 추정만 사용): {}", e.getMessage());
        }

        // Setback 일괄 적용 (모든 타일 처리 후 — 교차로별 갈래/최대 도로폭이 확정된 시점).
        // computeConnections 전에 해야 커넥션 shape가 트리밍된 링크 끝점에서 시작함.
        applyJunctionSetbacks(clusterMemberCnt, clusterIn, clusterOut, allLinks);

        // 연결 계산 (모든 타일 처리 후)
        Map<Long, List<ConnTuple>> clusterConns =
                computeConnections(clusters, clusterMemberCnt, clusterIn, clusterOut,
                        prohibitedPairs, allowedPairs, clusterInternalAdj);

        // XML → 임시 파일 → SFTP
        File tmp = File.createTempFile("network_stream_", ".xml");
        log.info("임시 XML: {} (예상 {}MB)", tmp, allLinks.size() / 5000);
        try {
            writeXml(tmp, networkId, baseLat, baseLon,
                    clusters, clusterMemberCnt, clusterIn, clusterOut, clusterConns, allLinks);
            if (versionId != null && !versionId.isBlank()) {
                try (InputStream is = new BufferedInputStream(new FileInputStream(tmp), 65536)) {
                    fileStorage.uploadFile(is, versionId, "network.xml");
                    log.info("SFTP 업로드 완료: {}/network.xml ({} MB)",
                            versionId, tmp.length() / 1_000_000);
                }
            }
        } finally {
            tmp.delete();
        }

        // 간소화 응답 빌드 (+ 터미널 id 수집 — NextSim 입력 스캐폴딩의 OD source/sink 후보)
        //   터미널은 포트가 0~1개뿐 — out 포트만 있으면 source 후보(나갈 링크만 있음),
        //   in 포트만 있으면 sink 후보(들어올 링크만 있음). 실측(부천 odmatrix.xml)으로
        //   확인: 실제 데이터는 source=out포트 터미널, sink=in포트 터미널로 전혀 섞이지 않음
        //   — 반대로 섞으면 나갈/들어올 링크가 없는 노드에서 경로를 요구하는 셈이라 무효.
        List<NodeResponse> simpleNodes = new ArrayList<>(clusters.size());
        List<Long> sourceTerminalIds = new ArrayList<>();
        List<Long> sinkTerminalIds = new ArrayList<>();
        for (ClusterInfo ci : clusters.values()) {
            NodeResponse nr = new NodeResponse();
            nr.setId(ci.id());
            List<ExtLink> ins = clusterIn.getOrDefault(ci.id(), List.of());
            List<ExtLink> outs = clusterOut.getOrDefault(ci.id(), List.of());
            NodeType nType = nodeTypeOf(ci, ins, outs);
            nr.setType(nType);
            if (nType == NodeType.Terminal) {
                if (!outs.isEmpty()) sourceTerminalIds.add(ci.id());
                else if (!ins.isEmpty()) sinkTerminalIds.add(ci.id());
            }
            if (ci.name() != null) nr.setName(ci.name());
            Coordinates c = new Coordinates();
            c.setLat(ci.wgsLat());
            c.setLng(ci.wgsLon());
            nr.setCoordinates(c);
            simpleNodes.add(nr);
        }

        List<LinkResponse> simpleLinks = new ArrayList<>(allLinks.size());
        for (ExtLink lk : allLinks) {
            LinkResponse lr = new LinkResponse();
            lr.setId(lk.id());
            lr.setFromNode(lk.fromCluster());
            lr.setToNode(lk.toCluster());
            lr.setNumLane(lk.numLane());
            lr.setLength(lk.length());
            lr.setMaxSpd(lk.maxSpd());
            lr.setSimType(SimType.Meso);
            lr.setType(LinkType.straight);
            if (lk.name() != null) lr.setName(lk.name());
            if (lk.layer() != null && !lk.layer().isEmpty()) lr.setLayer(lk.layer());
            // 로컬 좌표 → WGS84 역변환: bboxOfLink()가 null을 반환하지 않도록 필수
            double[] local = lk.localCoords();
            if (local != null && local.length >= 4) {
                List<Coordinates> coordList = new ArrayList<>(local.length / 2);
                for (int i = 0; i < local.length / 2; i++) {
                    Coordinates c = new Coordinates();
                    c.setLng(local[i * 2]     / SCALE_X + baseLon);
                    c.setLat(local[i * 2 + 1] / SCALE_Y + baseLat);
                    coordList.add(c);
                }
                lr.setCoordinates(coordList);
            }
            simpleLinks.add(lr);
        }

        log.info("스트리밍 변환 완료: 노드 {}개, 링크 {}개", clusters.size(), allLinks.size());
        return new StreamResult(clusters.size(), allLinks.size(), simpleNodes, simpleLinks, List.of(),
                sourceTerminalIds, sinkTerminalIds);
    }

    // ── 타일 처리 ─────────────────────────────────────────────────────────────

    private void processTile(
            double latMin, double lonMin, double latMax, double lonMax,
            double baseLat, double baseLon,
            Map<String, Long>    nodeToClusterId,
            Map<Long, ClusterInfo> clusters,
            Map<Long, Integer>   clusterMemberCnt,
            Set<String>          seenLinkIds,
            List<ExtLink>        allLinks,
            Map<Long, List<ExtLink>> clusterIn,
            Map<Long, List<ExtLink>> clusterOut,
            Map<Long, Map<String, List<InternalEdge>>> clusterInternalAdj,
            Set<String> seenInternalLinkIds) {

        // 1+2. 링크 + 양 끝점 노드 좌표를 단일 쿼리로 조회 (UNION JOIN + PK 조인)
        // road_use='1'(공사중/폐쇄) 링크는 시뮬레이션 대상이 아니므로 쿼리에서 제외
        final String SQL = """
            SELECT l.link_id, l.f_node, l.t_node, l.lanes, l.road_rank, l.max_spd, l.coords::text,
                   l.road_name, l.road_type, l.connect,
                   fn.lat AS f_lat, fn.lon AS f_lon, tn.lat AS t_lat, tn.lon AS t_lon,
                   fn.node_name AS f_name, fn.node_type AS f_type,
                   tn.node_name AS t_name, tn.node_type AS t_type
            FROM (
                SELECT l2.link_id, l2.f_node, l2.t_node, l2.lanes, l2.road_rank, l2.max_spd, l2.coords,
                       l2.road_name, l2.road_type, l2.connect
                FROM ktdb_link l2 JOIN ktdb_node n2 ON l2.f_node = n2.node_id
                WHERE n2.lon BETWEEN ? AND ? AND n2.lat BETWEEN ? AND ? AND COALESCE(l2.road_use,'0') <> '1'
                UNION
                SELECT l3.link_id, l3.f_node, l3.t_node, l3.lanes, l3.road_rank, l3.max_spd, l3.coords,
                       l3.road_name, l3.road_type, l3.connect
                FROM ktdb_link l3 JOIN ktdb_node n3 ON l3.t_node = n3.node_id
                WHERE n3.lon BETWEEN ? AND ? AND n3.lat BETWEEN ? AND ? AND COALESCE(l3.road_use,'0') <> '1'
            ) l
            JOIN ktdb_node fn ON fn.node_id = l.f_node
            JOIN ktdb_node tn ON tn.node_id = l.t_node
            """;
        Map<String, TNode> nodeMap = new HashMap<>();
        List<TLink> tileLinks = new ArrayList<>();
        jdbc.query(SQL, (RowCallbackHandler) rs -> {
            String fNode = rs.getString("f_node");
            String tNode = rs.getString("t_node");
            nodeMap.putIfAbsent(fNode, new TNode(fNode, rs.getDouble("f_lat"), rs.getDouble("f_lon"),
                    rs.getString("f_name"), rs.getString("f_type")));
            nodeMap.putIfAbsent(tNode, new TNode(tNode, rs.getDouble("t_lat"), rs.getDouble("t_lon"),
                    rs.getString("t_name"), rs.getString("t_type")));
            tileLinks.add(new TLink(
                    rs.getString("link_id"), fNode, tNode,
                    rs.getInt("lanes"), rs.getInt("road_rank"), rs.getInt("max_spd"),
                    parseCoordsFlat(rs.getString("coords")),
                    rs.getString("road_name"), rs.getString("road_type"), rs.getString("connect")));
        }, lonMin - TILE_BUF_DEG, lonMax + TILE_BUF_DEG, latMin - TILE_BUF_DEG, latMax + TILE_BUF_DEG,
           lonMin - TILE_BUF_DEG, lonMax + TILE_BUF_DEG, latMin - TILE_BUF_DEG, latMax + TILE_BUF_DEG);
        if (tileLinks.isEmpty()) return;

        // 3. 로컬 좌표 변환 (JOIN 보장으로 nodeMap 완전함)
        Map<String, double[]> localCoordMap = new HashMap<>();
        for (TLink lk : tileLinks) {
            double[] flat = lk.latLons();
            int n = flat.length / 2;
            if (n < 2) continue;
            double[] local = new double[n * 2];
            for (int i = 0; i < n; i++) {
                local[i * 2]     = (flat[i * 2 + 1] - baseLon) * SCALE_X;
                local[i * 2 + 1] = (flat[i * 2]     - baseLat) * SCALE_Y;
            }
            localCoordMap.put(lk.id(), local);
        }

        // 4. 노드 차수
        Map<String, Integer> degree = new HashMap<>();
        for (TLink lk : tileLinks) {
            if (!localCoordMap.containsKey(lk.id())) continue;
            degree.merge(lk.fNode(), 1, Integer::sum);
            degree.merge(lk.tNode(), 1, Integer::sum);
        }

        // 5. 내부 링크 식별 — 확정(<25m)과 같은 교차로명 후보(25~60m) 분리.
        // 후보는 6b의 클러스터 span 게이트 통과 시에만 병합 (별개 교차로 두 개를 잇는
        // 본선 링크 흡수 → 유령 교차로 방지. 동부네거리 54m 실측)
        Set<String> internalIds = new HashSet<>();
        List<TLink> sameNameCands = new ArrayList<>();
        for (TLink lk : tileLinks) {
            double[] c = localCoordMap.get(lk.id());
            if (c == null) continue;
            double len = calcLength(c);
            boolean hideg = degree.getOrDefault(lk.fNode(), 0) >= 3
                    && degree.getOrDefault(lk.tNode(), 0) >= 3;
            if (hideg && len < INTERNAL_MAX_M) {
                internalIds.add(lk.id());
                continue;
            }
            TNode fn = nodeMap.get(lk.fNode()), tn = nodeMap.get(lk.tNode());
            if (hideg && len < SAME_NAME_INTERNAL_MAX_M
                    && fn != null && tn != null
                    && "101".equals(fn.nodeType()) && "101".equals(tn.nodeType())
                    && fn.name() != null && !fn.name().isBlank()
                    && fn.name().equals(tn.name())) {
                sameNameCands.add(lk);
            }
        }

        // 6. Union-Find (사전식 최솟값이 대표 → 타일 간 결정적)
        Map<String, String> parent = new HashMap<>();
        for (String nid : nodeMap.keySet()) parent.put(nid, nid);
        for (TLink lk : tileLinks)
            if (internalIds.contains(lk.id())) ufUnion(parent, lk.fNode(), lk.tNode());

        // 6b. 같은 교차로명 후보 병합 — 클러스터 span 상한 게이트.
        // (길이,링크id) 정렬로 처리 순서를 고정 → 경계 클러스터가 여러 타일에서 보여도
        // 같은 병합 결과(결정적). 버퍼(TILE_BUF_DEG)가 이웃 노드의 완전 가시성 보장.
        if (!sameNameCands.isEmpty()) {
            Map<String, double[]> rootMin = new HashMap<>(), rootMax = new HashMap<>();
            for (Map.Entry<String, TNode> en : nodeMap.entrySet()) {
                TNode n = en.getValue();
                double x = (n.lon() - baseLon) * SCALE_X, y = (n.lat() - baseLat) * SCALE_Y;
                String r = ufFind(parent, en.getKey());
                rootMin.merge(r, new double[]{x, y}, (a, b) -> new double[]{Math.min(a[0], b[0]), Math.min(a[1], b[1])});
                rootMax.merge(r, new double[]{x, y}, (a, b) -> new double[]{Math.max(a[0], b[0]), Math.max(a[1], b[1])});
            }
            sameNameCands.sort(Comparator
                    .comparingDouble((TLink lk) -> calcLength(localCoordMap.get(lk.id())))
                    .thenComparing(TLink::id));
            for (TLink lk : sameNameCands) {
                String ra = ufFind(parent, lk.fNode()), rb = ufFind(parent, lk.tNode());
                if (ra.equals(rb)) { internalIds.add(lk.id()); continue; }
                double[] mn1 = rootMin.get(ra), mx1 = rootMax.get(ra);
                double[] mn2 = rootMin.get(rb), mx2 = rootMax.get(rb);
                if (mn1 == null || mn2 == null) continue;
                double spanX = Math.max(mx1[0], mx2[0]) - Math.min(mn1[0], mn2[0]);
                double spanY = Math.max(mx1[1], mx2[1]) - Math.min(mn1[1], mn2[1]);
                if (Math.max(spanX, spanY) > SAME_NAME_CLUSTER_SPAN_M) continue;
                ufUnion(parent, lk.fNode(), lk.tNode());
                String nr = ufFind(parent, lk.fNode());
                rootMin.put(nr, new double[]{Math.min(mn1[0], mn2[0]), Math.min(mn1[1], mn2[1])});
                rootMax.put(nr, new double[]{Math.max(mx1[0], mx2[0]), Math.max(mx1[1], mx2[1])});
                internalIds.add(lk.id());
            }
        }

        Map<String, String> nodeToRep = new HashMap<>();
        for (String nid : nodeMap.keySet()) nodeToRep.put(nid, ufFind(parent, nid));

        // 7. 신규 클러스터 등록 (O(N) reverse map — 이중 루프 제거)
        Map<String, List<String>> repToMembers = new HashMap<>();
        for (String nid : nodeMap.keySet()) {
            if (nodeToClusterId.containsKey(nid)) continue;
            repToMembers.computeIfAbsent(nodeToRep.get(nid), k -> new ArrayList<>()).add(nid);
        }

        for (Map.Entry<String, List<String>> e : repToMembers.entrySet()) {
            String rep = e.getKey();
            List<String> members = e.getValue();
            long clusterId = stableId(rep);

            if (!clusters.containsKey(clusterId)) {
                double sumLat = 0, sumLon = 0;
                String cName = null;
                boolean ktdbItx = false;
                for (String nid : members) {
                    TNode nd = nodeMap.get(nid);
                    sumLat += nd.lat(); sumLon += nd.lon();
                    if (cName == null && nd.name() != null && !nd.name().isBlank()) cName = nd.name();
                    if ("101".equals(nd.nodeType())) ktdbItx = true; // 원본 평면교차로
                }
                double cLat = sumLat / members.size();
                double cLon = sumLon / members.size();
                clusters.put(clusterId, new ClusterInfo(clusterId, cLat, cLon,
                        (cLon - baseLon) * SCALE_X, (cLat - baseLat) * SCALE_Y, members.size(),
                        cName, ktdbItx));
                clusterMemberCnt.put(clusterId, members.size());
            }
            for (String nid : members) nodeToClusterId.putIfAbsent(nid, clusterId);
        }

        // 7b. 클러스터 내부링크 에지 축적 — 도달성 판정 + 커넥션 경유 지오메트리.
        //     경계에 걸친 클러스터는 여러 타일에서 보이므로 링크 id로 멱등 축적.
        //     (BFS는 전 타일 처리 후 computeConnections에서 진입 노드별로 1회 수행)
        for (TLink lk : tileLinks) {
            if (!internalIds.contains(lk.id())) continue;
            if (!seenInternalLinkIds.add(lk.id())) continue;
            Long cid = nodeToClusterId.get(lk.fNode());
            if (cid == null) continue;
            double[] c = localCoordMap.get(lk.id());
            if (c == null || c.length < 4) continue;
            clusterInternalAdj.computeIfAbsent(cid, k -> new HashMap<>())
                    .computeIfAbsent(lk.fNode(), k -> new ArrayList<>())
                    .add(new InternalEdge(lk.tNode(), c));
        }

        // 8. 외부 링크 전역 누적
        for (TLink lk : tileLinks) {
            if (internalIds.contains(lk.id())) continue;
            if (seenLinkIds.contains(lk.id())) continue; // 경계 링크 중복 방지
            if (!nodeMap.containsKey(lk.fNode()) || !nodeMap.containsKey(lk.tNode())) continue;

            double[] coords = localCoordMap.get(lk.id());
            if (coords == null || coords.length < 4) continue;

            Long fCid = nodeToClusterId.get(lk.fNode());
            Long tCid = nodeToClusterId.get(lk.tNode());
            if (fCid == null || tCid == null || fCid.equals(tCid)) continue;

            // Setback은 여기서 적용하지 않음 — 타일 누적 중엔 교차로에 모이는 링크가
            // 아직 다 안 보여 폭/갈래 판정 불가. 전체 타일 처리 후 applyJunctionSetbacks()에서 일괄.
            double length = calcLength(coords);
            if (length < 0.5) continue;
            String shape = buildShape(coords);
            if (shape.isBlank()) continue;

            long origId = stableId(lk.id());
            int numLane = Math.max(1, lk.lanes());

            // id는 assignFinalIds()가 최종 재채번하기 전까지의 placeholder(origId 재사용) —
            // 이 시점엔 아직 전체 타일이 다 처리되지 않아 Link/Node 공유 인덱스를 부여할 수 없다.
            ExtLink ext = new ExtLink(origId, origId, fCid, tCid, numLane, round2(length),
                    lk.maxSpd(), coords, shape, lk.roadRank(),
                    (lk.roadName() != null && !lk.roadName().isBlank()) ? lk.roadName() : null,
                    structureLayer(lk.roadType(), lk.connect()),
                    lk.fNode(), lk.tNode());

            seenLinkIds.add(lk.id());
            allLinks.add(ext);
            clusterIn.computeIfAbsent(tCid,  k -> new ArrayList<>()).add(ext);
            clusterOut.computeIfAbsent(fCid, k -> new ArrayList<>()).add(ext);
        }
    }

    // ── 연결 계산 ─────────────────────────────────────────────────────────────

    private Map<Long, List<ConnTuple>> computeConnections(
            Map<Long, ClusterInfo> clusters,
            Map<Long, Integer> memberCnt,
            Map<Long, List<ExtLink>> clusterIn,
            Map<Long, List<ExtLink>> clusterOut,
            Set<String> prohibitedPairs,
            Set<String> allowedPairs,
            Map<Long, Map<String, List<InternalEdge>>> clusterInternalAdj) {

        Map<Long, List<ConnTuple>> result = new HashMap<>();
        // KtdbNetworkConverter와 동일 — TURNINFO가 못 잡는 회전 금지를 OSM으로 보조 검증
        OsmTurnRestrictionMatcher osmTurnMatcher = osmTurnRestrictionRepo.hasData()
                ? new OsmTurnRestrictionMatcher(osmTurnRestrictionRepo.loadAll())
                : null;

        for (long clusterId : clusters.keySet()) {
            List<ExtLink> ins  = clusterIn.getOrDefault(clusterId, List.of());
            List<ExtLink> outs = clusterOut.getOrDefault(clusterId, List.of());
            if (ins.isEmpty() || outs.isEmpty()) continue;
            ClusterInfo clusterInfo = clusters.get(clusterId);

            // 병합 교차로의 내부링크 그래프 (단일 노드 클러스터는 null → 전조합 = 통과 연결)
            Map<String, List<InternalEdge>> adj = clusterInternalAdj.get(clusterId);

            List<ConnTuple> conns = new ArrayList<>();
            for (ExtLink inLk : ins) {
                // 진입 부착 노드에서 내부링크 BFS — 도달성 + 경로(viaEdge/parent) 추적.
                // 경로 지오메트리가 커넥션 shape의 경유 좌표가 됨 (교통섬 순환·회전 곡선 유지)
                Map<String, InternalEdge> viaEdge = new HashMap<>();
                Map<String, String> parent = new HashMap<>();
                Set<String> reachable = null;
                if (adj != null) {
                    reachable = new HashSet<>();
                    Deque<String> q = new ArrayDeque<>();
                    reachable.add(inLk.tNode()); q.add(inLk.tNode());
                    while (!q.isEmpty()) {
                        String cur = q.poll();
                        for (InternalEdge e : adj.getOrDefault(cur, List.of())) {
                            if (reachable.add(e.toNode())) {
                                viaEdge.put(e.toNode(), e);
                                parent.put(e.toNode(), cur);
                                q.add(e.toNode());
                            }
                        }
                    }
                }
                for (ExtLink outLk : outs) {
                    // KTDB 내부링크가 허용한 동선만: 진입 부착 노드에서 진출 부착 노드 도달 가능해야 함
                    // (일반 변환기의 BFS 동선 탐색과 동일 의미 — 전조합 과생성 방지)
                    if (reachable != null && !reachable.contains(outLk.fNode())) continue;

                    // TURNINFO는 원본 KTDB stableId로 키잉되어 있음 — 재채번된 id()가 아니라 origId() 사용
                    String pairKey = inLk.origId() + ":" + outLk.origId();
                    // TURNINFO 금지(turn_oper=1) 동선 제외
                    if (prohibitedPairs.contains(pairKey)) continue;

                    double inB  = approachBearing(inLk.localCoords());
                    double outB = departureBearing(outLk.localCoords());

                    // OSM 회전제약 금지 체크 — TURNINFO에 없는 실제 금지를 보조로 걸러냄
                    // (실측: 강남 일대에서 이렇게만 잡히는 사례 13건 확인). 클러스터 대표
                    // WGS84 좌표(clusterInfo)를 via 지점으로 쓴다 — 클러스터=실제 교차로 1개 대응.
                    if (osmTurnMatcher != null) {
                        String osmProhibition = osmTurnMatcher.findProhibition(
                                clusterInfo.wgsLat(), clusterInfo.wgsLon(), inB, outB);
                        if (osmProhibition != null) continue;
                    }

                    double diff = ((outB - inB) + 360) % 360;
                    // 기하학적 U턴(역방향): TURNINFO에 명시된 지점(011 U턴 등)만 허용.
                    // 클러스터 왕복(from==to)은 명시 허용이 있어도 자기 링크 되돌아가기라 항상 제외.
                    boolean isUTurn = diff > 150 && diff < 210;
                    if (inLk.fromCluster() == outLk.toCluster()) {
                        if (!isUTurn || !allowedPairs.contains(pairKey)) continue;
                    } else if (isUTurn && !allowedPairs.contains(pairKey)) {
                        continue;
                    }

                    // U턴은 좌측 회전 — determineTurning은 방위차 ≤180°를 우회전으로 오분류
                    Turning turning = isUTurn ? Turning.Left_Turn : determineTurning(inB, outB);
                    double inW  = RANK_DEFS.getOrDefault(inLk.roadRank(),  DEFAULT_DEFS)[2];
                    double outW = RANK_DEFS.getOrDefault(outLk.roadRank(), DEFAULT_DEFS)[2];

                    // 진입 노드→진출 노드 경유 내부링크 지오메트리 (같은 노드면 빈 배열 = 직결)
                    double[] via = (reachable == null) ? new double[0]
                            : reconstructViaFlat(inLk.tNode(), outLk.fNode(), viaEdge, parent);

                    for (int[] pair : lanePairs(turning, inLk.numLane(), outLk.numLane())) {
                        // 커넥션은 차선↔차선 연결 — [진입 차선 끝] + 경유 지오메트리 + [진출 차선 시작]
                        double[] from = laneEndpoint(inLk.localCoords(),  true,  pair[0], inLk.numLane(),  inW);
                        double[] to   = laneEndpoint(outLk.localCoords(), false, pair[1], outLk.numLane(), outW);

                        StringBuilder sb = new StringBuilder();
                        sb.append(fmt5(from[0])).append(',').append(fmt5(from[1]));
                        double cLen = 0, px = from[0], py = from[1];
                        for (int i = 0; i + 1 < via.length; i += 2) {
                            double x = via[i], y = via[i + 1];
                            if (Math.abs(x - px) < 1e-6 && Math.abs(y - py) < 1e-6) continue;
                            cLen += Math.hypot(x - px, y - py);
                            sb.append(' ').append(fmt5(x)).append(',').append(fmt5(y));
                            px = x; py = y;
                        }
                        if (Math.abs(to[0] - px) >= 1e-6 || Math.abs(to[1] - py) >= 1e-6) {
                            cLen += Math.hypot(to[0] - px, to[1] - py);
                            sb.append(' ').append(fmt5(to[0])).append(',').append(fmt5(to[1]));
                        }
                        double connLenFinal = Math.max(1.0, cLen);
                        if (cLen < 1e-6) {
                            // from/via/to 가 전부 사실상 같은 지점 — shape 가 점 1개로 뭉개지면
                            // length=1.0 과 불일치하는 축퇴 지오메트리가 된다(일반 변환기의
                            // buildConnectionsFromInternalLinks 와 동일 문제). out-link 진행 방향으로
                            // connLenFinal 만큼 밀어낸 두 번째 점을 추가해 실제 길이를 갖는 shape 로 만든다.
                            double[] dir = departureUnit(outLk.localCoords());
                            sb.append(' ').append(fmt5(from[0] + dir[0] * connLenFinal))
                              .append(',').append(fmt5(from[1] + dir[1] * connLenFinal));
                        }
                        conns.add(new ConnTuple(inLk.id(), pair[0], outLk.id(), pair[1],
                                turning, round2(connLenFinal), sb.toString()));
                    }
                }
            }
            if (!conns.isEmpty()) result.put(clusterId, conns);
        }
        return result;
    }

    /**
     * BFS parent 체인을 따라 entry→exit 경유 내부링크들의 좌표(flat)를 진행 순서로 이어붙임.
     * 인접 중복점(링크 이음새)은 제거. 체인 단절/비정상 시 빈 배열(직결)로 폴백.
     */
    private double[] reconstructViaFlat(String entry, String exit,
            Map<String, InternalEdge> viaEdge, Map<String, String> parent) {
        if (entry.equals(exit)) return new double[0];
        List<double[]> chain = new ArrayList<>();
        String n = exit;
        while (!n.equals(entry)) {
            InternalEdge e = viaEdge.get(n);
            String p = parent.get(n);
            if (e == null || p == null || chain.size() > 64) return new double[0];
            chain.add(e.coords());
            n = p;
        }
        Collections.reverse(chain);
        int total = 0;
        for (double[] c : chain) total += c.length;
        double[] out = new double[total];
        int m = 0;
        for (double[] c : chain) {
            for (int i = 0; i + 1 < c.length; i += 2) {
                double x = c[i], y = c[i + 1];
                if (m >= 2 && Math.abs(out[m - 2] - x) < 1e-6 && Math.abs(out[m - 1] - y) < 1e-6) continue;
                out[m++] = x; out[m++] = y;
            }
        }
        return Arrays.copyOf(out, m);
    }

    // ── StAX XML 기록 ─────────────────────────────────────────────────────────

    private void writeXml(
            File file, int networkId, double baseLat, double baseLon,
            Map<Long, ClusterInfo> clusters, Map<Long, Integer> memberCnt,
            Map<Long, List<ExtLink>> clusterIn, Map<Long, List<ExtLink>> clusterOut,
            Map<Long, List<ConnTuple>> clusterConns,
            List<ExtLink> allLinks) throws Exception {

        XMLOutputFactory xof = XMLOutputFactory.newInstance();
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(file), 65536)) {
            XMLStreamWriter w = xof.createXMLStreamWriter(os, "UTF-8");
            w.writeStartDocument("UTF-8", "1.0");

            w.writeStartElement("Network");
            w.writeAttribute("id",       String.valueOf(networkId));
            w.writeAttribute("base_lat", String.valueOf(baseLat));
            w.writeAttribute("base_lon", String.valueOf(baseLon));

            // ── nodes ─────────────────────────────────────────────────────────
            w.writeStartElement("nodes");
            for (ClusterInfo ci : clusters.values()) {
                List<ExtLink> ins  = clusterIn.getOrDefault(ci.id(), List.of());
                List<ExtLink> outs = clusterOut.getOrDefault(ci.id(), List.of());
                List<ConnTuple> conns = clusterConns.getOrDefault(ci.id(), List.of());

                Set<Long> inPortIds  = new LinkedHashSet<>();
                Set<Long> outPortIds = new LinkedHashSet<>();
                for (ExtLink lk : ins)  inPortIds.add(lk.id());
                for (ExtLink lk : outs) outPortIds.add(lk.id());

                NodeType nType = nodeTypeOf(ci, ins, outs);
                w.writeStartElement("node");
                w.writeAttribute("id",             String.valueOf(ci.id()));
                w.writeAttribute("type",           nType.getValue());
                w.writeAttribute("num_port",       String.valueOf(inPortIds.size() + outPortIds.size()));
                w.writeAttribute("num_connection", String.valueOf(conns.size()));
                w.writeAttribute("center",         fmt3(ci.localX()) + " " + fmt3(ci.localY()));
                if (ci.name() != null) w.writeAttribute("name", ci.name());

                // NodeXml JAXB 매핑은 <node> 직접 자식 <port>/<connection> (래퍼 요소 없음, link_id 속성명)
                for (long pid : inPortIds)  { w.writeEmptyElement("port"); w.writeAttribute("type","in");  w.writeAttribute("link_id", String.valueOf(pid)); }
                for (long pid : outPortIds) { w.writeEmptyElement("port"); w.writeAttribute("type","out"); w.writeAttribute("link_id", String.valueOf(pid)); }

                long cSeq = 0;
                for (ConnTuple ct : conns) {
                    if (!inPortIds.contains(ct.fromLink()) || !outPortIds.contains(ct.toLink())) continue;
                    double ffSpd = ct.turning() == Turning.Left_Turn  ? 20.0
                                 : ct.turning() == Turning.Right_Turn ? 25.0 : 30.0;
                    w.writeEmptyElement("connection");
                    w.writeAttribute("id",        String.valueOf(cSeq++));
                    w.writeAttribute("from_link", String.valueOf(ct.fromLink()));
                    w.writeAttribute("from_lane", String.valueOf(ct.fromLane()));
                    w.writeAttribute("to_link",   String.valueOf(ct.toLink()));
                    w.writeAttribute("to_lane",   String.valueOf(ct.toLane()));
                    w.writeAttribute("turning",   ct.turning().getValue());
                    w.writeAttribute("length",    String.valueOf(ct.connLen()));
                    w.writeAttribute("width",     "3.0");
                    w.writeAttribute("ff_spd",    String.valueOf(ffSpd));
                    w.writeAttribute("shape",     ct.connShape());
                }
                w.writeEndElement(); // node
            }
            w.writeEndElement(); // nodes

            // ── links ─────────────────────────────────────────────────────────
            w.writeStartElement("links");
            for (ExtLink lk : allLinks) {
                double[] defs  = RANK_DEFS.getOrDefault(lk.roadRank(), DEFAULT_DEFS);
                int    nl      = lk.numLane();
                double len     = lk.length();
                double maxSpd  = lk.maxSpd();
                int nCells     = Math.max(1, (int) Math.ceil(len / BASE_CELL_LEN));
                double cellLen = len / nCells;

                w.writeStartElement("link");
                w.writeAttribute("id",        String.valueOf(lk.id()));
                w.writeAttribute("from_node", String.valueOf(lk.fromCluster()));
                w.writeAttribute("to_node",   String.valueOf(lk.toCluster()));
                w.writeAttribute("num_lane",  String.valueOf(nl));
                w.writeAttribute("length",    String.valueOf(len));
                w.writeAttribute("width",     String.valueOf(round1(nl * defs[2])));
                w.writeAttribute("max_spd",   String.valueOf(maxSpd));
                w.writeAttribute("min_spd",   "0.0");
                w.writeAttribute("ff_spd",    String.valueOf(round1(maxSpd)));
                w.writeAttribute("wave_spd",  String.valueOf(round2(defs[0])));
                w.writeAttribute("qmax",      String.valueOf(round1(defs[1] * nl)));
                w.writeAttribute("max_veh",   String.valueOf(round2((len / 1000.0) * JAM_DENSITY * nl)));
                w.writeAttribute("sim_type",  String.valueOf(SimType.Meso.getValue())); // adapter가 정수값("0") 기대
                w.writeAttribute("type",      "straight");
                if (lk.name() != null) w.writeAttribute("name", lk.name());
                w.writeAttribute("layer",     lk.layer() == null ? "" : lk.layer());
                w.writeAttribute("stop_line", "0.0");
                w.writeAttribute("shape",     lk.shape());

                for (int i = 0; i < nl; i++) {
                    w.writeStartElement("lane");
                    w.writeAttribute("id",            String.valueOf(i));
                    w.writeAttribute("left_lane_id",  i > 0      ? String.valueOf(i - 1) : "None");
                    w.writeAttribute("right_lane_id", i < nl - 1 ? String.valueOf(i + 1) : "None");
                    w.writeAttribute("right_lc",      "true");
                    w.writeAttribute("left_lc",       "true");
                    w.writeAttribute("num_cell",      String.valueOf(nCells));
                    w.writeAttribute("shape",         lk.shape());

                    double offset = 0;
                    for (int c = 0; c < nCells; c++) {
                        double cl = (c == nCells - 1) ? (len - cellLen * (nCells - 1)) : cellLen;
                        w.writeEmptyElement("cell");
                        w.writeAttribute("id",     String.valueOf(c));
                        w.writeAttribute("length", String.valueOf(round2(Math.max(0.01, cl))));
                        w.writeAttribute("offset", String.valueOf(round2(offset)));
                        offset += cl;
                    }
                    w.writeEndElement(); // lane
                }
                w.writeEndElement(); // link
            }
            w.writeEndElement(); // links
            w.writeEndElement(); // Network
            w.writeEndDocument();
            w.flush();
        }
    }

    // ── Union-Find (사전식 최솟값이 대표) ─────────────────────────────────────

    private String ufFind(Map<String, String> parent, String id) {
        String p = parent.getOrDefault(id, id);
        if (!p.equals(id)) { p = ufFind(parent, p); parent.put(id, p); }
        return p;
    }

    private void ufUnion(Map<String, String> parent, String a, String b) {
        String ra = ufFind(parent, a), rb = ufFind(parent, b);
        if (ra.equals(rb)) return;
        if (ra.compareTo(rb) < 0) parent.put(rb, ra);
        else                       parent.put(ra, rb);
    }

    // ── Setback ───────────────────────────────────────────────────────────────

    /**
     * 교차로 진입/진출 링크 끝점을 후퇴시켜 링크가 교차로를 침범하지 않게 함.
     * 교차로 판정: merged cluster 또는 이웃 클러스터 3개 이상 (경유 노드는 이웃 2개 → 제외).
     * setback 거리: 교차로에 모이는 최대 도로폭 + 여유, [MIN, MAX] 클램프, 링크 길이 30% 상한.
     * allLinks/clusterIn/clusterOut 세 컬렉션의 ExtLink 참조를 일관되게 교체한다.
     */
    private void applyJunctionSetbacks(
            Map<Long, Integer> memberCnt,
            Map<Long, List<ExtLink>> clusterIn,
            Map<Long, List<ExtLink>> clusterOut,
            List<ExtLink> allLinks) {

        Map<Long, Set<Long>> neighbors = new HashMap<>();
        Map<Long, Double> maxRoadWidth = new HashMap<>();
        for (ExtLink lk : allLinks) {
            double w = lk.numLane() * RANK_DEFS.getOrDefault(lk.roadRank(), DEFAULT_DEFS)[2];
            neighbors.computeIfAbsent(lk.fromCluster(), k -> new HashSet<>()).add(lk.toCluster());
            neighbors.computeIfAbsent(lk.toCluster(),   k -> new HashSet<>()).add(lk.fromCluster());
            maxRoadWidth.merge(lk.fromCluster(), w, Math::max);
            maxRoadWidth.merge(lk.toCluster(),   w, Math::max);
        }

        Map<Long, ExtLink> replaced = new HashMap<>();
        for (int i = 0; i < allLinks.size(); i++) {
            ExtLink lk = allLinks.get(i);
            boolean fJct = isJunction(lk.fromCluster(), memberCnt, neighbors);
            boolean tJct = isJunction(lk.toCluster(),   memberCnt, neighbors);
            if (!fJct && !tJct) continue;

            int n = lk.localCoords().length / 2;
            List<double[]> pts = new ArrayList<>(n);
            for (int p = 0; p < n; p++)
                pts.add(new double[]{lk.localCoords()[p * 2], lk.localCoords()[p * 2 + 1]});

            double linkLen = lk.length();
            if (tJct) pts = trimEnd(pts,
                    Math.min(setbackFor(lk.toCluster(), maxRoadWidth), linkLen * SETBACK_MAX_FRAC));
            if (fJct) pts = trimStart(pts,
                    Math.min(setbackFor(lk.fromCluster(), maxRoadWidth), linkLen * SETBACK_MAX_FRAC));
            if (pts.size() < 2) continue;

            double[] flat = new double[pts.size() * 2];
            for (int p = 0; p < pts.size(); p++) { flat[p*2] = pts.get(p)[0]; flat[p*2+1] = pts.get(p)[1]; }
            double newLen = calcLength(flat);
            if (newLen < 0.5) continue;
            String newShape = buildShape(flat);
            if (newShape.isBlank()) continue;

            ExtLink trimmedLk = new ExtLink(lk.id(), lk.origId(), lk.fromCluster(), lk.toCluster(),
                    lk.numLane(), round2(newLen), lk.maxSpd(), flat, newShape, lk.roadRank(),
                    lk.name(), lk.layer(), lk.fNode(), lk.tNode());
            replaced.put(lk.id(), trimmedLk);
            allLinks.set(i, trimmedLk);
        }
        if (replaced.isEmpty()) return;
        for (List<ExtLink> list : clusterIn.values())
            list.replaceAll(l -> replaced.getOrDefault(l.id(), l));
        for (List<ExtLink> list : clusterOut.values())
            list.replaceAll(l -> replaced.getOrDefault(l.id(), l));
        log.info("교차로 setback 적용: 링크 {}개 트리밍", replaced.size());
    }

    private boolean isJunction(long clusterId, Map<Long, Integer> memberCnt,
                               Map<Long, Set<Long>> neighbors) {
        if (memberCnt.getOrDefault(clusterId, 1) > 1) return true;
        return neighbors.getOrDefault(clusterId, Set.of()).size() >= 3;
    }

    private double setbackFor(long clusterId, Map<Long, Double> maxRoadWidth) {
        double w = maxRoadWidth.getOrDefault(clusterId, 0.0);
        return Math.min(SETBACK_MAX_M, Math.max(SETBACK_MIN_M, w + SETBACK_MARGIN_M));
    }

    private List<double[]> trimEnd(List<double[]> pts, double dist) {
        List<double[]> r = new ArrayList<>(pts);
        double rem = dist;
        while (r.size() >= 2 && rem > 0) {
            double[] last = r.get(r.size() - 1), prev = r.get(r.size() - 2);
            double seg = dist(prev, last);
            if (seg < 1e-6) { r.remove(r.size() - 1); continue; }
            if (seg <= rem) { rem -= seg; r.remove(r.size() - 1); }
            else {
                double frac = (seg - rem) / seg;
                r.set(r.size() - 1, new double[]{prev[0] + frac*(last[0]-prev[0]),
                                                  prev[1] + frac*(last[1]-prev[1])});
                break;
            }
        }
        return r.size() >= 2 ? r : pts;
    }

    private List<double[]> trimStart(List<double[]> pts, double dist) {
        List<double[]> r = new ArrayList<>(pts);
        double rem = dist;
        while (r.size() >= 2 && rem > 0) {
            double[] first = r.get(0), next = r.get(1);
            double seg = dist(first, next);
            if (seg < 1e-6) { r.remove(0); continue; }
            if (seg <= rem) { rem -= seg; r.remove(0); }
            else {
                double frac = rem / seg;
                r.set(0, new double[]{first[0] + frac*(next[0]-first[0]),
                                      first[1] + frac*(next[1]-first[1])});
                break;
            }
        }
        return r.size() >= 2 ? r : pts;
    }

    // ── 좌표 파싱 (JSONB → 평탄 배열) ────────────────────────────────────────

    private double[] parseCoordsFlat(String json) {
        if (json == null || json.isBlank()) return new double[0];
        try {
            List<Map<String, Double>> list = objectMapper.readValue(json, new TypeReference<>() {});
            double[] flat = new double[list.size() * 2];
            for (int i = 0; i < list.size(); i++) {
                flat[i * 2]     = list.get(i).getOrDefault("lat", 0.0);
                flat[i * 2 + 1] = list.get(i).getOrDefault("lng", 0.0);
            }
            return flat;
        } catch (Exception e) {
            return new double[0];
        }
    }

    // ── 기하 유틸 ─────────────────────────────────────────────────────────────

    private double calcLength(double[] c) {
        if (c == null || c.length < 4) return 1.0;
        double t = 0;
        for (int i = 0; i < c.length / 2 - 1; i++) {
            double dx = c[(i+1)*2] - c[i*2], dy = c[(i+1)*2+1] - c[i*2+1];
            t += Math.sqrt(dx*dx + dy*dy);
        }
        return Math.max(1.0, t);
    }

    private String buildShape(double[] c) {
        if (c == null || c.length < 4) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < c.length / 2; i++) {
            double x = c[i*2], y = c[i*2+1];
            if (!Double.isFinite(x) || !Double.isFinite(y)) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(fmt5(x)).append(',').append(fmt5(y));
        }
        return sb.toString();
    }

    private double approachBearing(double[] c) {
        int n = c.length / 2;
        if (n < 2) return 0;
        return bearing(c[(n-2)*2], c[(n-2)*2+1], c[(n-1)*2], c[(n-1)*2+1]);
    }

    private double departureBearing(double[] c) {
        if (c.length < 4) return 0;
        return bearing(c[0], c[1], c[2], c[3]);
    }

    private double bearing(double x1, double y1, double x2, double y2) {
        return Math.toDegrees(Math.atan2(x2 - x1, y2 - y1));
    }

    /** out-link 첫 구간의 진행 방향 단위벡터 — 축퇴(0길이) 커넥션 shape 보정용 */
    private double[] departureUnit(double[] c) {
        if (c.length < 4) return new double[]{1.0, 0.0};
        double dx = c[2] - c[0], dy = c[3] - c[1];
        double len = Math.hypot(dx, dy);
        return len < 1e-9 ? new double[]{1.0, 0.0} : new double[]{dx / len, dy / len};
    }

    /**
     * 링크 중심선(평탄 배열 [x0,y0,x1,y1,...])에서 특정 차선의 끝점 계산.
     * 프론트 렌더 규약과 동일: 차선 i 오프셋 = ((laneCount-1)/2 - i) × laneWidth,
     * 진행방향 왼쪽 법선(+) 기준 (차선 0 = 최좌측).
     */
    private double[] laneEndpoint(double[] c, boolean atEnd,
                                  int laneIdx, int laneCount, double laneWidth) {
        int n = c.length / 2;
        if (n < 2) return atEnd ? lastPt(c) : firstPt(c);
        double px, py, dx, dy;
        if (atEnd) {
            px = c[(n-1)*2]; py = c[(n-1)*2+1];
            dx = px - c[(n-2)*2]; dy = py - c[(n-2)*2+1];
        } else {
            px = c[0]; py = c[1];
            dx = c[2] - px; dy = c[3] - py;
        }
        double len = Math.hypot(dx, dy);
        if (len < 1e-9) return new double[]{px, py};
        double off = ((laneCount - 1) / 2.0 - laneIdx) * laneWidth;
        return new double[]{px + (-dy / len) * off, py + (dx / len) * off};
    }

    private double[] lastPt(double[] c) {
        int n = c.length / 2;
        return n > 0 ? new double[]{c[(n-1)*2], c[(n-1)*2+1]} : new double[]{0, 0};
    }

    private double[] firstPt(double[] c) {
        return c.length >= 2 ? new double[]{c[0], c[1]} : new double[]{0, 0};
    }

    private double dist(double[] a, double[] b) {
        double dx = b[0]-a[0], dy = b[1]-a[1]; return Math.sqrt(dx*dx+dy*dy);
    }

    private Turning determineTurning(double in, double out) {
        double diff = ((out - in) + 360) % 360;
        if (diff < 45 || diff > 315) return Turning.Straight;
        return diff <= 180 ? Turning.Right_Turn : Turning.Left_Turn;
    }

    /** 구조물유형(ROAD_TYPE)·연결로(CONNECT) → layer 문자열 (KtdbNetworkConverter와 동일 규칙) */
    private String structureLayer(String roadType, String connect) {
        String structure = switch (roadType == null ? "" : roadType) {
            case "001" -> "elevated";   // 고가차도
            case "002" -> "underpass";  // 지하차도
            case "003" -> "bridge";     // 교량
            case "004" -> "tunnel";     // 터널
            default    -> "";
        };
        boolean ramp = connect != null && !connect.isBlank() && !"0".equals(connect);
        if (ramp) return structure.isEmpty() ? "ramp" : structure + ",ramp";
        return structure;
    }

    /** 노드 타입 판정 — network.xml 기록과 간소화 응답이 반드시 동일 로직을 써야 한다
     *  (터미널 집합이 어긋나면 스캐폴딩 OD 가 비터미널을 참조 → route-generator 실패) */
    private NodeType nodeTypeOf(ClusterInfo ci, List<ExtLink> ins, List<ExtLink> outs) {
        // 원본 NODE_TYPE=101(평면교차로)이면 degree 추정을 Intersection으로 오버라이드
        NodeType nType = classifyNodeType(ins.size(), outs.size());
        if (ci.ktdbItx() && !ins.isEmpty() && !outs.isEmpty() && ins.size() + outs.size() >= 3) {
            nType = NodeType.Intersection;
        }
        return nType;
    }

    private NodeType classifyNodeType(int ins, int outs) {
        int t = ins + outs;
        if (t <= 1)            return NodeType.Terminal;
        if (ins == 1 && outs == 1) return NodeType.Normal;
        if (ins > outs)        return NodeType.Merging;
        if (outs > ins)        return NodeType.Diverging;
        return NodeType.Intersection;
    }

    private List<int[]> lanePairs(Turning turning, int inL, int outL) {
        List<int[]> pairs = new ArrayList<>();
        if (turning == Turning.Left_Turn)  { pairs.add(new int[]{0, 0}); }
        else if (turning == Turning.Right_Turn) { pairs.add(new int[]{inL-1, outL-1}); }
        else {
            int cnt = Math.min(inL, outL);
            for (int k = 0; k < cnt;  k++) pairs.add(new int[]{k, k});
            for (int k = cnt; k < inL;  k++) pairs.add(new int[]{k, outL-1});
            for (int k = cnt; k < outL; k++) pairs.add(new int[]{inL-1, k});
        }
        return pairs;
    }

    /**
     * Link/클러스터(=교차로 노드) 최종 id 부여 (Network ID naming 스펙, {@link NetworkIdAssigner}
     * 참고). Link와 일반 Node(비터미널 클러스터)는 allLinks 누적 순서(=생성 순서)에 따라 하나의
     * 인덱스를 공유하고, Terminal(in+out 외부 링크 합 ≤ 1인 클러스터)은 연결된 단 하나의 Link와
     * 뒷자리 3자리가 동일하도록 그 자리에서 파생시킨다. clusters/clusterMemberCnt/clusterIn/
     * clusterOut/clusterInternalAdj/allLinks 를 모두 새 id 로 일관되게 재구성한다(같은 ExtLink
     * 인스턴스를 세 컬렉션이 공유하므로 allLinks 기준으로 재구성 후 clusterIn/clusterOut 은 다시
     * 파생 — applyJunctionSetbacks 의 교체 패턴과 동일 원칙). ExtLink.origId()(원본 KTDB stableId)는
     * 건드리지 않는다 — TURNINFO 매칭이 그 값으로 키잉되어 있다.
     */
    private void assignFinalIds(
            Map<Long, ClusterInfo> clusters,
            Map<Long, Integer> clusterMemberCnt,
            Map<Long, List<ExtLink>> clusterIn,
            Map<Long, List<ExtLink>> clusterOut,
            Map<Long, Map<String, List<InternalEdge>>> clusterInternalAdj,
            List<ExtLink> allLinks) {

        // degree는 재채번 전 (old) 클러스터 id 기준으로 미리 확정 — 링크를 스캔하며 그 자리에서
        // endpoint 클러스터를 처음 만나면 바로 배정하려면 degree가 이미 알려져 있어야 한다.
        Map<Long, Integer> degree = new HashMap<>(clusters.size() * 2);
        for (long oldId : clusters.keySet()) {
            degree.put(oldId, clusterIn.getOrDefault(oldId, List.of()).size()
                    + clusterOut.getOrDefault(oldId, List.of()).size());
        }

        Map<Long, Long> clusterIdRemap = new HashMap<>(clusters.size() * 2);
        NetworkIdAssigner idAssigner = new NetworkIdAssigner();
        for (int i = 0; i < allLinks.size(); i++) {
            ExtLink lk = allLinks.get(i);
            long newLinkId = idAssigner.nextLinkId();
            allLinks.set(i, new ExtLink(newLinkId, lk.origId(), lk.fromCluster(), lk.toCluster(),
                    lk.numLane(), lk.length(), lk.maxSpd(), lk.localCoords(), lk.shape(),
                    lk.roadRank(), lk.name(), lk.layer(), lk.fNode(), lk.tNode()));
            // 양 끝이 둘 다 터미널(고립된 신규 세그먼트 등)이면 뒷자리 파생은 한쪽에만 적용 —
            // 안 그러면 둘 다 같은 링크에서 파생돼 서로 다른 두 클러스터가 같은 id를 갖게 됨.
            boolean derivedTerminalUsed = false;
            for (long oldCid : new long[]{lk.fromCluster(), lk.toCluster()}) {
                if (clusterIdRemap.containsKey(oldCid)) continue;
                if (degree.getOrDefault(oldCid, 0) > 1) {
                    clusterIdRemap.put(oldCid, idAssigner.nextNormalNodeId());
                } else if (!derivedTerminalUsed) {
                    clusterIdRemap.put(oldCid, idAssigner.terminalIdFor(newLinkId));
                    derivedTerminalUsed = true;
                } else {
                    clusterIdRemap.put(oldCid, idAssigner.nextIsolatedTerminalId());
                }
            }
        }
        // 어느 외부 링크에도 연결되지 않은 고립 클러스터(비정상 데이터) — 페어링할 Link가 없어 fallback
        for (long oldCid : clusters.keySet()) {
            clusterIdRemap.putIfAbsent(oldCid, idAssigner.nextIsolatedTerminalId());
        }

        for (int i = 0; i < allLinks.size(); i++) {
            ExtLink lk = allLinks.get(i);
            allLinks.set(i, new ExtLink(lk.id(), lk.origId(),
                    clusterIdRemap.getOrDefault(lk.fromCluster(), lk.fromCluster()),
                    clusterIdRemap.getOrDefault(lk.toCluster(), lk.toCluster()),
                    lk.numLane(), lk.length(), lk.maxSpd(), lk.localCoords(), lk.shape(),
                    lk.roadRank(), lk.name(), lk.layer(), lk.fNode(), lk.tNode()));
        }
        clusterIn.clear();
        clusterOut.clear();
        for (ExtLink lk : allLinks) {
            clusterIn.computeIfAbsent(lk.toCluster(),   k -> new ArrayList<>()).add(lk);
            clusterOut.computeIfAbsent(lk.fromCluster(), k -> new ArrayList<>()).add(lk);
        }

        Map<Long, ClusterInfo> newClusters = new LinkedHashMap<>(clusters.size() * 2);
        for (Map.Entry<Long, ClusterInfo> e : clusters.entrySet()) {
            long newId = clusterIdRemap.get(e.getKey());
            ClusterInfo ci = e.getValue();
            newClusters.put(newId, new ClusterInfo(newId, ci.wgsLat(), ci.wgsLon(),
                    ci.localX(), ci.localY(), ci.memberCount(), ci.name(), ci.ktdbItx()));
        }
        clusters.clear();
        clusters.putAll(newClusters);

        Map<Long, Integer> newMemberCnt = new HashMap<>(clusterMemberCnt.size() * 2);
        for (Map.Entry<Long, Integer> e : clusterMemberCnt.entrySet())
            newMemberCnt.put(clusterIdRemap.get(e.getKey()), e.getValue());
        clusterMemberCnt.clear();
        clusterMemberCnt.putAll(newMemberCnt);

        Map<Long, Map<String, List<InternalEdge>>> newAdj = new HashMap<>(clusterInternalAdj.size() * 2);
        for (Map.Entry<Long, Map<String, List<InternalEdge>>> e : clusterInternalAdj.entrySet())
            newAdj.put(clusterIdRemap.get(e.getKey()), e.getValue());
        clusterInternalAdj.clear();
        clusterInternalAdj.putAll(newAdj);
    }

    // KTDB ID(숫자 문자열) → 안정적인 Long ID
    private long stableId(String ktdbId) {
        try { return Long.parseLong(ktdbId); }
        catch (NumberFormatException e) { return ((long) ktdbId.hashCode()) & 0x7FFF_FFFF_FFFFL; }
    }

    private String fmt3(double v) { return String.format(Locale.US, "%.3f", v); }
    private String fmt5(double v) { return String.format(Locale.US, "%.5f", v); }
    private double round1(double v) { return Math.round(v * 10.0)  / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
