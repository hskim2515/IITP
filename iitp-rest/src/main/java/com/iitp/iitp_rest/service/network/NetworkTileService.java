package com.iitp.iitp_rest.service.network;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.MvtEncoder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
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

    /** LOD 등급: 작을수록 간선(원거리에서도 표시). road_class 부재 → 차선수/속도 프록시.
     *  MACRO = 광역 조망용 고속도로 골격만 (rank 0 중 고속·다차선 후필터) */
    public enum Lod { MACRO, OVERVIEW, MID, NEAR, DETAIL }

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
            case MACRO, OVERVIEW -> 0;   // 간선만 (MACRO 는 추가 후필터)
            case MID             -> 1;   // + 집산
            default              -> 2;   // 전체
        };
        // MACRO: rank 0 중에서도 고속도로급(고속·다차선)만 → 전국/광역 조망 골격
        boolean macroOnly = (lod == Lod.MACRO);
        // 차선/구간은 클라 LOD상 detail(완전 근접)에서만 표시되므로 near 이하는 제거 → payload·빌드 대폭 축소.
        // (near 타일이 차선 포함 시 detail과 동일 1.6MB/차선1161/셀3096이었으나, 화면엔 안 보였음)
        boolean stripDetail = (lod != Lod.DETAIL);
        // overview/mid: 클라이언트는 폴리라인만 사용하고 노드를 버린다 (fetchOverviewArterials).
        // 전국 규모 bbox에서 수만 개 노드 직렬화 → 응답이 수십MB → 스킵.
        boolean includeNodes = (lod == Lod.NEAR || lod == Lod.DETAIL);

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
                        if (macroOnly && link.getMaxSpd() < 90 && link.getNumLane() < 6) continue;
                        if (stripDetail) {
                            link.getLanes().clear();
                            link.getSections().clear();
                        } else {
                            // DETAIL: 렌더링은 lanes 의 개수·속성만 사용 — cells(20m당 1개×차선수)·
                            // segments·shape 문자열이 payload 대부분을 차지하므로 제거 (수 배 축소).
                            // coordinates 는 이미 파싱돼 있어 shape 원문은 클라이언트에서 미사용.
                            for (var lane : link.getLanes()) {
                                lane.getCells().clear();
                                lane.getSegments().clear();
                                lane.setShape(null);
                            }
                        }
                        link.setShape(null);
                        links.add(link);
                        if (includeNodes && link.getFromNode() != null) nodeIdsToInclude.add(link.getFromNode());
                        if (includeNodes && link.getToNode() != null) nodeIdsToInclude.add(link.getToNode());
                    }
                }
            }

            // ── 노드: bbox 내 노드 + 포함된 링크의 끝점 노드 (near/detail 전용) ──
            if (includeNodes) {
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
            } // end includeNodes
        } catch (SQLException e) {
            throw new IOException("타일 쿼리 실패: " + versionId, e);
        }

        out.setLinks(links);
        out.setNodes(nodes);
        log.info("[NetworkTileService] {} bbox=({},{},{},{}) lod={} → links={} nodes={}",
                versionId, west, south, east, north, lod, links.size(), nodes.size());
        return out;
    }

    /**
     * 네트워크 전체 bbox [west, south, east, north] (링크 RTree 집계).
     * 타일 모드에서 클라이언트가 전체 데이터를 안 갖고도 카메라를 네트워크 위치로 이동시키는 용도.
     * 네트워크 없으면 null.
     */
    public double[] getExtent(String versionId) throws IOException {
        File db = ensureDb(versionId);
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url);
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT MIN(minX), MIN(minY), MAX(maxX), MAX(maxY) FROM link_rtree")) {
            if (rs.next()) {
                double w = rs.getDouble(1);
                boolean hasRows = !rs.wasNull();
                if (hasRows) {
                    return new double[]{ w, rs.getDouble(2), rs.getDouble(3), rs.getDouble(4) };
                }
            }
        } catch (SQLException e) {
            throw new IOException("extent 조회 실패: " + versionId, e);
        }
        return null;
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
        int maxRank = switch (lod) { case MACRO, OVERVIEW -> 0; case MID -> 1; default -> 2; };

        // 타일 경위도 bbox (웹 메르카토르 슬리피 타일)
        double n = Math.pow(2, z);
        double west = x / n * 360.0 - 180.0;
        double east = (x + 1) / n * 360.0 - 180.0;
        double north = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))));
        double south = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))));

        // near(확대)에서는 도로 폭 폴리곤으로 인코딩 → 줌인 시 실제 도로 모양. 멀리선 중심선(가벼움).
        boolean usePolygon = (lod == Lod.NEAR || lod == Lod.DETAIL); // near 이상(확대)은 도로 폭 폴리곤
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
                        int numLane = link.getNumLane();
                        if (lod == Lod.DETAIL && link.getWidth() > 0 && numLane > 0) {
                            // 최근접(detail): 차선별 폴리곤 → 3D 차선 표현과 일치. 차선 폭의 94%로 사이 틈.
                            double laneW = metersToTile(link.getWidth() / (double) numLane, z, tileCenterLat);
                            double laneHw = laneW / 2.0 * 0.94;
                            for (int li = 0; li < numLane; li++) {
                                // 차선 0 = 최좌측(중앙선 쪽) — 법선(-dy,dx)은 타일 y-down 좌표계에서 우측(+)
                                double lateral = (li - (numLane - 1) / 2.0) * laneW;
                                int[][] lanePoly = buildOffsetPolygon(tileCoords, lateral - laneHw, lateral + laneHw);
                                if (lanePoly != null) enc.addPolygon(id * 100 + li, lanePoly);
                            }
                        } else if (usePolygon && link.getWidth() > 0) {
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
        return buildOffsetPolygon(cl, -hw, hw); // 중심선 양쪽 ±hw (도로 폭)
    }

    /**
     * 중심선 cl 을 법선 방향 [offLo, offHi] 구간으로 offset 한 닫힌 폴리곤 ring.
     * 도로: [-hw, hw]. 차선 i: [lateral-laneHw, lateral+laneHw] (lateral=차선 중심 offset).
     */
    private int[][] buildOffsetPolygon(int[][] cl, double offLo, double offHi) {
        int m = cl.length;
        if (m < 2) return null;
        int[][] left = new int[m][], right = new int[m][];
        for (int i = 0; i < m; i++) {
            double dx, dy;
            if (i == 0)            { dx = cl[1][0] - cl[0][0];     dy = cl[1][1] - cl[0][1]; }
            else if (i == m - 1)   { dx = cl[i][0] - cl[i-1][0];   dy = cl[i][1] - cl[i-1][1]; }
            else                   { dx = cl[i+1][0] - cl[i-1][0]; dy = cl[i+1][1] - cl[i-1][1]; }
            double len = Math.hypot(dx, dy);
            if (len < 1e-9) { dx = 1; dy = 0; len = 1; }
            double nx = -dy / len, ny = dx / len; // 단위 법선
            left[i]  = new int[]{ (int) Math.round(cl[i][0] + nx * offHi), (int) Math.round(cl[i][1] + ny * offHi) };
            right[i] = new int[]{ (int) Math.round(cl[i][0] + nx * offLo), (int) Math.round(cl[i][1] + ny * offLo) };
        }
        // ring = left 순방향 + right 역방향 (닫힌 폴리곤). winding 은 addPolygon 이 보정.
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

    /** 영속 SQLite 저장 디렉토리 (서버 재시작 후에도 유지) */
    private static Path tileDbDir() throws IOException {
        Path dir = Paths.get(System.getProperty("user.home"), ".iitp-tiles");
        Files.createDirectories(dir);
        return dir;
    }

    /** versionId 의 SQLite(.db) 를 보장 (없으면 전체 네트워크 1회 적재·빌드 후 캐시). */
    private File ensureDb(String versionId) throws IOException {
        // 1) 인메모리 캐시 확인
        File cached = dbCache.get(versionId);
        if (cached != null && cached.exists()) return cached;

        // 2) 디스크 영속 파일 확인 (서버 재시작 후에도 SQLite 파일이 남아 있으면 재사용)
        File stable = tileDbDir().resolve(sanitize(versionId) + ".db").toFile();
        if (stable.exists()) {
            dbCache.put(versionId, stable);
            log.info("[NetworkTileService] 영속 SQLite 재사용 {} → {}", versionId, stable.getAbsolutePath());
            return stable;
        }

        ReentrantLock lock = buildLocks.computeIfAbsent(versionId, k -> new ReentrantLock());
        lock.lock();
        try {
            cached = dbCache.get(versionId);
            if (cached != null && cached.exists()) return cached;
            if (stable.exists()) { dbCache.put(versionId, stable); return stable; }

            // 전체 네트워크 1회 로드 (서버 측 1회성 비용, 빌드 후 캐시되어 재사용)
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            // 스트리밍 변환 XML은 WGS84 coordinates 없이 로컬 shape만 저장됨.
            // baseLat/baseLon이 있으면 역변환해서 bboxOfLink()가 null 반환하지 않도록 보정.
            applyCoordinatesIfMissing(xml);
            NetworkResponse resp = networkMapper.toResponse(xml);
            return ingest(versionId, resp);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 NetworkResponse 로 versionId 의 SQLite(.db) 를 직접 빌드·캐시한다 (SFTP 비의존).
     * 테스트, 그리고 단계 4(import-time 빌드)에서 재사용하는 공개 진입점.
     * 빌드된 파일은 ~/.iitp-tiles/{versionId}.db 에 영속 저장 → 서버 재시작 후에도 재임포트 불필요.
     */
    public File ingest(String versionId, NetworkResponse resp) throws IOException {
        ReentrantLock lock = buildLocks.computeIfAbsent(versionId, k -> new ReentrantLock());
        lock.lock();
        try {
            File db = tileDbDir().resolve(sanitize(versionId) + ".db").toFile();
            // 기존 영속 파일이 있으면 삭제 — 그대로 두면 CREATE TABLE 충돌로 빌드 실패 (재임포트 회귀)
            dbCache.remove(versionId);
            Files.deleteIfExists(db.toPath());
            buildDb(db, resp);
            dbCache.put(versionId, db);
            log.info("[NetworkTileService] SQLite 빌드 완료 {} ({} links, {} nodes) → {}",
                    versionId, resp.getLinks().size(), resp.getNodes().size(), db.getAbsolutePath());
            return db;
        } finally {
            lock.unlock();
        }
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

    /**
     * 스트리밍 변환 XML처럼 WGS84 coordinates가 없는 경우 baseLat/baseLon으로 역변환 보정.
     * 소형 KTDB(applyCoordinates 호출됨)·OSM XML은 이미 coordinates가 있어 스킵.
     */
    private static void applyCoordinatesIfMissing(NetworkXml xml) {
        Double baseLat = xml.getBaseLat();
        Double baseLon = xml.getBaseLon();
        if (baseLat == null || baseLon == null || (baseLat == 0.0 && baseLon == 0.0)) return;

        if (xml.getNodes() != null) {
            for (NodeXml node : xml.getNodes()) {
                if (node.getCoordinates() != null) continue;
                List<Coordinates> coords = CoordinateUtils.parseAndTransform(node.getCenter(), baseLon, baseLat);
                if (!coords.isEmpty()) node.setCoordinates(coords.get(0));
            }
        }
        if (xml.getLinks() != null) {
            for (LinkXml link : xml.getLinks()) {
                if (link.getCoordinates() != null && !link.getCoordinates().isEmpty()) continue;
                link.setCoordinates(CoordinateUtils.parseAndTransform(link.getShape(), baseLon, baseLat));
            }
        }
    }

    private String sanitize(String s) {
        return s == null ? "null" : s.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /**
     * KTDB 스트리밍 임포트 후 SFTP XML(포트·커넥션·커넥션 shape 포함)로 SQLite를 재빌드한다.
     * 간이 임포트 응답(simplified, 포트·커넥션 없음) 대신 SFTP에 저장된 전체 데이터를 사용해
     * detail 줌에서 노드·포트·커넥션이 표시되도록 한다.
     * buildLocks 으로 ensureDb() 와 직렬화 — 동시 빌드 방지.
     */
    public void rebuildFromXml(String versionId) {
        ReentrantLock lock = buildLocks.computeIfAbsent(versionId, k -> new ReentrantLock());
        lock.lock();
        try {
            log.info("[NetworkTileService] SFTP XML 기반 재빌드 시작 {}", versionId);
            // 기존 캐시·파일 제거 (lock 보유 중이므로 ensureDb 재진입 차단됨)
            dbCache.remove(versionId);
            try {
                Path stable = tileDbDir().resolve(sanitize(versionId) + ".db");
                Files.deleteIfExists(stable);
            } catch (IOException ignored) {}
            // SFTP XML 로드 → full 재빌드
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            applyCoordinatesIfMissing(xml);
            NetworkResponse resp = networkMapper.toResponse(xml);
            ingest(versionId, resp);
            log.info("[NetworkTileService] SFTP XML 기반 재빌드 완료 {} (links={} nodes={})",
                    versionId, resp.getLinks().size(), resp.getNodes().size());
        } catch (Exception e) {
            log.warn("[NetworkTileService] SFTP XML 재빌드 실패 {}: {}", versionId, e.getMessage());
        } finally {
            lock.unlock();
        }
    }

    /** 편집 저장 등으로 네트워크가 바뀌면 캐시 무효화 (재빌드 유도). */
    public void invalidate(String versionId) {
        File db = dbCache.remove(versionId);
        if (db != null) {
            try { Files.deleteIfExists(db.toPath()); } catch (IOException ignored) {}
        }
        // 영속 파일도 삭제 (서버 재시작 후에도 구 SQLite를 재사용하지 않도록)
        try {
            Path stable = tileDbDir().resolve(sanitize(versionId) + ".db");
            Files.deleteIfExists(stable);
        } catch (IOException ignored) {}
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
                if (l.getId() == null || delLinks.contains(l.getId())) continue;
                // 디테일 보존: 타일 모드 클라이언트의 viewport 링크는 타일 서빙 시 경량화된
                // 페이로드다 — near 는 lanes 전체, detail 도 lane 의 cells/segments/shape 가
                // 제거돼 있다(queryBbox stripDetail). 그대로 통째 교체하면 CTM 셀 등 시뮬
                // 필수 데이터가 조용히 소실된다. upsert 에 없는 하위 데이터는 기존 것을 유지.
                restoreStrippedDetail(l, linkMap.get(l.getId()));
                linkMap.put(l.getId(), l);
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

    /**
     * upsert 링크에서 타일 서빙이 벗겨낸 하위 데이터를 기존 링크에서 복원.
     * - lanes 자체가 없으면(near 타일) 기존 lanes 전체 유지
     * - lanes 가 있으면(detail 타일) lane id 매칭으로 cells/segments/shape 복원
     *   (upsert 쪽에 값이 있으면 편집으로 보고 그대로 둔다)
     */
    static void restoreStrippedDetail(LinkResponse upsert, LinkResponse existing) {
        if (existing == null) return; // 신규 링크 — 복원할 원본 없음
        if (upsert.getLanes() == null || upsert.getLanes().isEmpty()) {
            if (existing.getLanes() != null && !existing.getLanes().isEmpty()) {
                upsert.setLanes(existing.getLanes());
            }
            return;
        }
        if (existing.getLanes() == null) return;
        java.util.Map<Long, com.iitp.iitp_rest.model.network.lane.LaneResponse> byId = new java.util.HashMap<>();
        for (var lane : existing.getLanes()) {
            if (lane.getId() != null) byId.put(lane.getId(), lane);
        }
        for (var lane : upsert.getLanes()) {
            var orig = lane.getId() != null ? byId.get(lane.getId()) : null;
            if (orig == null) continue;
            if ((lane.getCells() == null || lane.getCells().isEmpty()) && !orig.getCells().isEmpty()) {
                lane.setCells(orig.getCells());
            }
            if ((lane.getSegments() == null || lane.getSegments().isEmpty()) && !orig.getSegments().isEmpty()) {
                lane.setSegments(orig.getSegments());
            }
            if (lane.getShape() == null && orig.getShape() != null) {
                lane.setShape(orig.getShape());
            }
        }
        if (upsert.getShape() == null && existing.getShape() != null) {
            upsert.setShape(existing.getShape());
        }
    }
}
