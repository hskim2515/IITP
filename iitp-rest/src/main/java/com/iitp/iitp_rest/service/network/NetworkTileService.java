package com.iitp.iitp_rest.service.network;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.util.MvtEncoder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 네트워크 BBox 타일링 서비스 (단계 1 — SQLite + RTree, 읽기 전용).
 *
 * <p>기존 network.xml(전체) 을 versionId 단위로 1회 SQLite(.db, RTree 공간 인덱스)로 적재·캐시하고,
 * 이후 요청에는 viewport bbox 와 교차하는 링크/노드 부분집합만 반환한다.
 * 클라이언트가 받는 데이터를 viewport 규모로 제한해 광역권→전국 메모리 한계를 해소한다.
 *
 * <p><b>완전 additive</b>: 기존 {@code GET /network/{versionId}} 경로는 그대로 두고,
 * 새 {@code GET /network/{versionId}/tiles} 만 이 서비스를 사용한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkTileService {

    private final NetworkService networkService;
    private final NetworkMapper networkMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** versionId → 빌드된 SQLite .db 파일 */
    private final ConcurrentHashMap<String, File> dbCache = new ConcurrentHashMap<>();
    /** versionId → 빌드 직렬화 락 (동시 빌드 방지) */
    private final ConcurrentHashMap<String, ReentrantLock> buildLocks = new ConcurrentHashMap<>();

    /** LOD 등급: 작을수록 간선(원거리에서도 표시). road_class 부재 → 차선수/속도 프록시 */
    public enum Lod { OVERVIEW, MID, NEAR, DETAIL }

    /**
     * bbox 와 교차하는 네트워크 부분집합 반환.
     *
     * @param versionId 시나리오 버전
     * @param west,south,east,north WGS84 경위도 bbox
     * @param lod LOD 단계 (overview/mid 는 간선 위주 + 차선/구간 제거, near/detail 은 전체)
     */
    public NetworkResponse queryByBbox(String versionId,
                                       double west, double south, double east, double north,
                                       Lod lod) throws IOException {
        File db = ensureDb(versionId);

        int maxRank = switch (lod) {
            case OVERVIEW -> 0;   // 간선만
            case MID      -> 1;   // + 집산
            default       -> 2;   // 전체
        };
        // 차선/구간은 클라 LOD상 detail(완전 근접)에서만 표시되므로 near 이하는 제거 → payload·빌드 대폭 축소.
        // (near 타일이 차선 포함 시 detail과 동일 1.6MB/차선1161/셀3096이었으나, 화면엔 안 보였음)
        boolean stripDetail = (lod != Lod.DETAIL);

        NetworkResponse out = new NetworkResponse();
        List<LinkResponse> links = new ArrayList<>();
        List<NodeResponse> nodes = new ArrayList<>();
        Set<Long> nodeIdsToInclude = new HashSet<>();

        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            // ── 링크: RTree 로 bbox 교차 후보 → JSON 역직렬화 + LOD 필터 ──
            String linkSql =
                "SELECT l.json FROM links l JOIN link_rtree r ON l.id = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ? AND l.lod_rank <= ?";
            try (PreparedStatement ps = conn.prepareStatement(linkSql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                ps.setInt(5, maxRank);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        LinkResponse link = objectMapper.readValue(rs.getString(1), LinkResponse.class);
                        if (stripDetail) {
                            link.getLanes().clear();
                            link.getSections().clear();
                        }
                        links.add(link);
                        if (link.getFromNode() != null) nodeIdsToInclude.add(link.getFromNode());
                        if (link.getToNode() != null) nodeIdsToInclude.add(link.getToNode());
                    }
                }
            }

            // ── 노드: bbox 내 노드 + 포함된 링크의 끝점 노드 ──
            Set<Long> seen = new HashSet<>();
            String nodeBboxSql =
                "SELECT n.id, n.json FROM nodes n JOIN node_rtree r ON n.id = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ?";
            try (PreparedStatement ps = conn.prepareStatement(nodeBboxSql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        long id = rs.getLong(1);
                        nodes.add(objectMapper.readValue(rs.getString(2), NodeResponse.class));
                        seen.add(id);
                    }
                }
            }
            // 링크 끝점 노드 중 bbox 밖이라 누락된 것 보강 (링크 연결 무결성)
            nodeIdsToInclude.removeAll(seen);
            if (!nodeIdsToInclude.isEmpty()) {
                String inClause = nodeIdsToInclude.stream().map(String::valueOf)
                        .reduce((a, b) -> a + "," + b).orElse("");
                try (Statement st = conn.createStatement();
                     ResultSet rs = st.executeQuery("SELECT json FROM nodes WHERE id IN (" + inClause + ")")) {
                    while (rs.next()) {
                        nodes.add(objectMapper.readValue(rs.getString(1), NodeResponse.class));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("타일 쿼리 실패: " + versionId, e);
        }

        out.setLinks(links);
        out.setNodes(nodes);
        log.info("[NetworkTileService] {} bbox=({},{},{},{}) lod={} → links={} nodes={}",
                versionId, west, south, east, north, lod, links.size(), nodes.size());
        return out;
    }

    private static final int MVT_EXTENT = 4096;

    /**
     * MVT(PBF) 타일 인코딩 (단계 3, overview/mid 2D 읽기 가속).
     * z/x/y 웹 메르카토르 타일 → RTree 로 교차 링크 조회(lodRank 필터) → 링크 중심선을 MVT LineString 으로 인코딩.
     *
     * @return MVT 바이트. 빈 타일이면 길이 0 바이트(204/빈 응답).
     */
    public byte[] queryMvt(String versionId, int z, int x, int y, Lod lod) throws IOException {
        File db = ensureDb(versionId);
        int maxRank = switch (lod) { case OVERVIEW -> 0; case MID -> 1; default -> 2; };

        // 타일 경위도 bbox (웹 메르카토르 슬리피 타일)
        double n = Math.pow(2, z);
        double west = x / n * 360.0 - 180.0;
        double east = (x + 1) / n * 360.0 - 180.0;
        double north = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))));
        double south = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))));

        // near(확대)에서는 도로 폭 폴리곤으로 인코딩 → 줌인 시 실제 도로 모양. 멀리선 중심선(가벼움).
        boolean usePolygon = (lod == Lod.NEAR);
        double tileCenterLat = (north + south) / 2.0;

        MvtEncoder enc = new MvtEncoder("network", MVT_EXTENT);
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            String sql =
                "SELECT l.id, l.json FROM links l JOIN link_rtree r ON l.id = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ? AND l.lod_rank <= ?";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                ps.setInt(5, maxRank);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        long id = rs.getLong(1);
                        LinkResponse link = objectMapper.readValue(rs.getString(2), LinkResponse.class);
                        int[][] tileCoords = toTileCoords(link.getCoordinates(), z, x, y);
                        if (tileCoords == null) continue;
                        if (usePolygon && link.getWidth() > 0) {
                            double hwTile = metersToTile(link.getWidth() / 2.0, z, tileCenterLat);
                            int[][] poly = buildRoadPolygon(tileCoords, hwTile);
                            if (poly != null) enc.addPolygon(id, poly);
                            else enc.addLineString(id, tileCoords);
                        } else {
                            enc.addLineString(id, tileCoords);
                        }
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("MVT 쿼리 실패: " + versionId, e);
        }
        return enc.isEmpty() ? new byte[0] : enc.finish();
    }

    /** 미터 → 타일-로컬 단위 (MVT_EXTENT 기준). 타일 폭(m) = 적도둘레/2^z × cos(lat) */
    private double metersToTile(double meters, int z, double lat) {
        double tileWidthMeters = 40075016.686 / Math.pow(2, z) * Math.cos(Math.toRadians(lat));
        if (tileWidthMeters <= 0) return 0;
        return meters * MVT_EXTENT / tileWidthMeters;
    }

    /** 중심선(타일-로컬) 을 도로 폭(halfWidth) 만큼 양쪽 offset 한 닫힌 폴리곤 ring 으로 변환. */
    private int[][] buildRoadPolygon(int[][] cl, double hw) {
        int m = cl.length;
        if (m < 2 || hw <= 0) return null;
        int[][] left = new int[m][], right = new int[m][];
        for (int i = 0; i < m; i++) {
            double dx, dy;
            if (i == 0)            { dx = cl[1][0] - cl[0][0];     dy = cl[1][1] - cl[0][1]; }
            else if (i == m - 1)   { dx = cl[i][0] - cl[i-1][0];   dy = cl[i][1] - cl[i-1][1]; }
            else                   { dx = cl[i+1][0] - cl[i-1][0]; dy = cl[i+1][1] - cl[i-1][1]; }
            double len = Math.hypot(dx, dy);
            if (len < 1e-9) { dx = 1; dy = 0; len = 1; }
            double nx = -dy / len, ny = dx / len; // 단위 법선
            left[i]  = new int[]{ (int) Math.round(cl[i][0] + nx * hw), (int) Math.round(cl[i][1] + ny * hw) };
            right[i] = new int[]{ (int) Math.round(cl[i][0] - nx * hw), (int) Math.round(cl[i][1] - ny * hw) };
        }
        // ring = left 순방향 + right 역방향 (닫힌 도로 폴리곤). winding 은 addPolygon 이 보정.
        int[][] ring = new int[2 * m][];
        for (int i = 0; i < m; i++) ring[i] = left[i];
        for (int i = 0; i < m; i++) ring[m + i] = right[m - 1 - i];
        return ring;
    }

    /** 링크 경위도 좌표 → 타일-로컬 정수 좌표 (0..MVT_EXTENT, y top-down) */
    private int[][] toTileCoords(List<Coordinates> coords, int z, int x, int y) {
        if (coords == null || coords.size() < 2) return null;
        double n = Math.pow(2, z);
        List<int[]> pts = new ArrayList<>();
        for (Coordinates c : coords) {
            if (c == null || c.getLng() == null || c.getLat() == null) continue;
            double lng = c.getLng(), lat = c.getLat();
            double worldX = (lng + 180.0) / 360.0 * n;
            double sinLat = Math.sin(Math.toRadians(lat));
            double worldY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
            int tx = (int) Math.round((worldX - x) * MVT_EXTENT);
            int ty = (int) Math.round((worldY - y) * MVT_EXTENT);
            pts.add(new int[]{tx, ty});
        }
        if (pts.size() < 2) return null;
        return pts.toArray(new int[0][]);
    }

    /** versionId 의 SQLite(.db) 를 보장 (없으면 전체 네트워크 1회 적재·빌드 후 캐시). */
    private File ensureDb(String versionId) throws IOException {
        File cached = dbCache.get(versionId);
        if (cached != null && cached.exists()) return cached;

        ReentrantLock lock = buildLocks.computeIfAbsent(versionId, k -> new ReentrantLock());
        lock.lock();
        try {
            cached = dbCache.get(versionId);
            if (cached != null && cached.exists()) return cached;

            // 전체 네트워크 1회 로드 (서버 측 1회성 비용, 빌드 후 캐시되어 재사용)
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            NetworkResponse resp = networkMapper.toResponse(xml);
            return ingest(versionId, resp);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 NetworkResponse 로 versionId 의 SQLite(.db) 를 직접 빌드·캐시한다 (SFTP 비의존).
     * 테스트, 그리고 단계 4(import-time 빌드)에서 재사용하는 공개 진입점.
     */
    public File ingest(String versionId, NetworkResponse resp) throws IOException {
        File db = Files.createTempFile("network_tile_" + sanitize(versionId) + "_", ".db").toFile();
        db.deleteOnExit();
        buildDb(db, resp);
        dbCache.put(versionId, db);
        log.info("[NetworkTileService] SQLite 빌드 완료 {} ({} links, {} nodes) → {}",
                versionId, resp.getLinks().size(), resp.getNodes().size(), db.getAbsolutePath());
        return db;
    }

    /** NetworkResponse → SQLite(.db): links/nodes 테이블(JSON blob) + RTree 공간 인덱스 */
    private void buildDb(File db, NetworkResponse resp) throws IOException {
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement st = conn.createStatement()) {
                st.executeUpdate("CREATE TABLE links (id INTEGER PRIMARY KEY, lod_rank INTEGER, json TEXT)");
                st.executeUpdate("CREATE TABLE nodes (id INTEGER PRIMARY KEY, json TEXT)");
                st.executeUpdate("CREATE VIRTUAL TABLE link_rtree USING rtree(id, minX, maxX, minY, maxY)");
                st.executeUpdate("CREATE VIRTUAL TABLE node_rtree USING rtree(id, minX, maxX, minY, maxY)");
            }

            try (PreparedStatement linkPs = conn.prepareStatement("INSERT INTO links(id,lod_rank,json) VALUES (?,?,?)");
                 PreparedStatement linkR  = conn.prepareStatement("INSERT INTO link_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                for (LinkResponse link : resp.getLinks()) {
                    if (link.getId() == null) continue;
                    double[] bb = bboxOfLink(link);
                    if (bb == null) continue;
                    linkPs.setLong(1, link.getId());
                    linkPs.setInt(2, lodRankOf(link));
                    linkPs.setString(3, objectMapper.writeValueAsString(link));
                    linkPs.addBatch();
                    linkR.setLong(1, link.getId());
                    linkR.setDouble(2, bb[0]); linkR.setDouble(3, bb[1]);
                    linkR.setDouble(4, bb[2]); linkR.setDouble(5, bb[3]);
                    linkR.addBatch();
                }
                linkPs.executeBatch();
                linkR.executeBatch();
            }

            try (PreparedStatement nodePs = conn.prepareStatement("INSERT INTO nodes(id,json) VALUES (?,?)");
                 PreparedStatement nodeR  = conn.prepareStatement("INSERT INTO node_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                for (NodeResponse node : resp.getNodes()) {
                    if (node.getId() == null || node.getCoordinates() == null) continue;
                    Double lng = node.getCoordinates().getLng();
                    Double lat = node.getCoordinates().getLat();
                    if (lng == null || lat == null) continue;
                    nodePs.setLong(1, node.getId());
                    nodePs.setString(2, objectMapper.writeValueAsString(node));
                    nodePs.addBatch();
                    nodeR.setLong(1, node.getId());
                    nodeR.setDouble(2, lng); nodeR.setDouble(3, lng);
                    nodeR.setDouble(4, lat); nodeR.setDouble(5, lat);
                    nodeR.addBatch();
                }
                nodePs.executeBatch();
                nodeR.executeBatch();
            }

            conn.commit();
        } catch (SQLException e) {
            throw new IOException("SQLite 빌드 실패", e);
        }
    }

    /** 링크 좌표 전체의 bbox [minLng,maxLng,minLat,maxLat] */
    private double[] bboxOfLink(LinkResponse link) {
        List<Coordinates> coords = link.getCoordinates();
        if (coords == null || coords.isEmpty()) return null;
        double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE;
        double minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
        boolean any = false;
        for (Coordinates c : coords) {
            if (c == null || c.getLng() == null || c.getLat() == null) continue;
            double x = c.getLng(), y = c.getLat();
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            any = true;
        }
        return any ? new double[]{minX, maxX, minY, maxY} : null;
    }

    /**
     * LOD 등급 프록시 (0=간선, 1=집산, 2=국지). road_class 컬럼 부재로 차선수·속도로 근사.
     * 향후 network.xml 에 road_class 가 생기면 이 로직만 교체한다.
     */
    private int lodRankOf(LinkResponse link) {
        int lanes = link.getNumLane();
        double spd = link.getMaxSpd();
        if (lanes >= 4 || spd >= 80) return 0;   // 간선/고속
        if (lanes >= 2 || spd >= 50) return 1;   // 집산
        return 2;                                // 국지
    }

    private String sanitize(String s) {
        return s == null ? "null" : s.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /** 편집 저장 등으로 네트워크가 바뀌면 캐시 무효화 (재빌드 유도). */
    public void invalidate(String versionId) {
        File db = dbCache.remove(versionId);
        if (db != null) {
            try { Files.deleteIfExists(db.toPath()); } catch (IOException ignored) {}
        }
    }

    /**
     * 도메인 id 기반 diff 적용 (단계 4-1).
     * 전체 네트워크를 로드한 뒤 upsert(추가/수정) · delete 를 id 기준으로 적용해
     * 갱신된 NetworkResponse 를 반환한다. (영속화는 호출측이 기존 save 경로로 수행)
     */
    public NetworkResponse applyDiff(String versionId,
                                     List<LinkResponse> upsertLinks, List<NodeResponse> upsertNodes,
                                     List<Long> deleteLinkIds, List<Long> deleteNodeIds) throws IOException {
        NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
        NetworkResponse net = networkMapper.toResponse(xml);

        Set<Long> delLinks = new HashSet<>(deleteLinkIds != null ? deleteLinkIds : List.of());
        Set<Long> delNodes = new HashSet<>(deleteNodeIds != null ? deleteNodeIds : List.of());

        // ── 링크: 삭제 후 upsert (id 일치분 교체, 없으면 추가) ──
        java.util.LinkedHashMap<Long, LinkResponse> linkMap = new java.util.LinkedHashMap<>();
        for (LinkResponse l : net.getLinks()) {
            if (l.getId() != null && !delLinks.contains(l.getId())) linkMap.put(l.getId(), l);
        }
        if (upsertLinks != null) {
            for (LinkResponse l : upsertLinks) {
                if (l.getId() != null && !delLinks.contains(l.getId())) linkMap.put(l.getId(), l);
            }
        }
        net.setLinks(new ArrayList<>(linkMap.values()));

        // ── 노드 ──
        java.util.LinkedHashMap<Long, NodeResponse> nodeMap = new java.util.LinkedHashMap<>();
        for (NodeResponse n : net.getNodes()) {
            if (n.getId() != null && !delNodes.contains(n.getId())) nodeMap.put(n.getId(), n);
        }
        if (upsertNodes != null) {
            for (NodeResponse n : upsertNodes) {
                if (n.getId() != null && !delNodes.contains(n.getId())) nodeMap.put(n.getId(), n);
            }
        }
        net.setNodes(new ArrayList<>(nodeMap.values()));

        log.info("[NetworkTileService] diff 적용 {} → links={} nodes={} (upsertL={} delL={} upsertN={} delN={})",
                versionId, net.getLinks().size(), net.getNodes().size(),
                upsertLinks != null ? upsertLinks.size() : 0, delLinks.size(),
                upsertNodes != null ? upsertNodes.size() : 0, delNodes.size());
        return net;
    }
}
