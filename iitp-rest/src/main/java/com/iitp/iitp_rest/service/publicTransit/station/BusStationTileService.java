package com.iitp.iitp_rest.service.publicTransit.station;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse;
import com.iitp.iitp_rest.service.network.NetworkService;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 버스정류장 BBox 타일링 서비스 (신호 타일링과 동일 패턴 — SQLite + RTree, 읽기 전용).
 *
 * <p>버스정류장은 좌표가 없고 linkRef(도로 링크)만 가진다 — "정류장은 그 링크에 종속".
 * 빌드 시 네트워크 링크의 시작 좌표를 join 하여 정류장의 bbox 를 만든다(신호가 노드 좌표를
 * 쓰는 것과 동일 발상). 타일 조회는 근사 위치 기준 — 실제 렌더링 위치(linkRef+laneRef+offset
 * 정밀 계산)는 프론트에서 네트워크 데이터로 다시 계산하므로, 여기서는 격자 단위 필터링에만
 * 쓸 수 있으면 충분하다.
 *
 * <p>완전 additive: 기존 {@code GET /busStation/{versionId}} 는 그대로 두고 새 {@code /tiles} 만 사용.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BusStationTileService {

    private final BusStationService busStationService;
    private final NetworkService networkService;
    private final NetworkMapper networkMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, File> dbCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ReentrantLock> buildLocks = new ConcurrentHashMap<>();

    /** bbox 와 교차하는 버스정류장 레코드 반환. */
    public List<BusStationResponse> queryByBbox(String versionId,
                                                 double west, double south, double east, double north) throws IOException {
        File db = ensureDb(versionId);
        List<BusStationResponse> out = new ArrayList<>();
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            String sql =
                "SELECT s.json FROM stations s JOIN station_rtree r ON s.rowid = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ?";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        out.add(objectMapper.readValue(rs.getString(1), BusStationResponse.class));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("버스정류장 타일 쿼리 실패: " + versionId, e);
        }
        log.info("[BusStationTileService] {} bbox=({},{},{},{}) → stations={}",
                versionId, west, south, east, north, out.size());
        return out;
    }

    private File ensureDb(String versionId) throws IOException {
        File cached = dbCache.get(versionId);
        if (cached != null && cached.exists()) return cached;

        ReentrantLock lock = buildLocks.computeIfAbsent(versionId, k -> new ReentrantLock());
        lock.lock();
        try {
            cached = dbCache.get(versionId);
            if (cached != null && cached.exists()) return cached;

            List<BusStationResponse> stations;
            try {
                stations = busStationService.getBusStationsByVersionId(versionId).getBusStations();
                if (stations == null) stations = new ArrayList<>();
            } catch (IOException e) {
                throw e;
            } catch (Exception e) {
                // BusStationService.getBusStationsByVersionId()는 XML 미존재 시 IOException을
                // RuntimeException으로 감싸 던진다(BusStationController.getBusStationsByVersionId
                // 참고) — 원인이 IOException이면 그대로 풀어서 컨트롤러의 FileNotFoundException
                // 분기(404)가 정상 동작하게 한다. 그 외에는 기존대로 감싸서 500.
                Throwable cause = e.getCause();
                if (cause instanceof IOException ioe) throw ioe;
                throw new IOException("busStation 로드 실패: " + versionId, e);
            }
            return ingest(versionId, stations);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 정류장 목록으로 versionId 의 SQLite(.db) 를 빌드·캐시(재파싱 없이).
     * saveBusStations 시점에 첫 타일 요청의 lazy 빌드를 저장 처리 시간으로 옮긴다.
     */
    public File ingest(String versionId, List<BusStationResponse> stations) throws IOException {
        Map<String, double[]> linkCoord = loadLinkCoords(versionId);
        File db = Files.createTempFile("busstation_tile_" + sanitize(versionId) + "_", ".db").toFile();
        db.deleteOnExit();
        buildDb(db, stations, linkCoord);
        dbCache.put(versionId, db);
        log.info("[BusStationTileService] SQLite 빌드 완료 {} ({} stations) → {}",
                versionId, stations.size(), db.getAbsolutePath());
        return db;
    }

    /** 네트워크 링크 시작 좌표 맵 (정류장 bbox 의 출처). 네트워크 없으면 빈 맵. */
    private Map<String, double[]> loadLinkCoords(String versionId) {
        Map<String, double[]> map = new HashMap<>();
        try {
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            NetworkResponse net = networkMapper.toResponse(xml);
            for (LinkResponse l : net.getLinks()) {
                if (l.getId() == null || l.getCoordinates() == null || l.getCoordinates().isEmpty()) continue;
                Coordinates c = l.getCoordinates().get(0);
                if (c.getLng() != null && c.getLat() != null) {
                    map.put(String.valueOf(l.getId()), new double[]{c.getLng(), c.getLat()});
                }
            }
        } catch (Exception e) {
            log.warn("[BusStationTileService] 네트워크 링크 좌표 로드 실패 (정류장 bbox 비게 됨): {}", e.getMessage());
        }
        return map;
    }

    /** 정류장 → SQLite: stations(json) + RTree(링크 시작 좌표 기준 bbox, 좌표 없으면 인덱스 제외) */
    private void buildDb(File db, List<BusStationResponse> stations, Map<String, double[]> linkCoord) throws IOException {
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement st = conn.createStatement()) {
                st.executeUpdate("CREATE TABLE stations (rowid INTEGER PRIMARY KEY, link_ref TEXT, json TEXT)");
                st.executeUpdate("CREATE VIRTUAL TABLE station_rtree USING rtree(id, minX, maxX, minY, maxY)");
            }
            try (PreparedStatement sp = conn.prepareStatement("INSERT INTO stations(rowid,link_ref,json) VALUES (?,?,?)");
                 PreparedStatement rp = conn.prepareStatement("INSERT INTO station_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                long rowid = 0;
                for (BusStationResponse s : stations) {
                    rowid++;
                    sp.setLong(1, rowid);
                    sp.setString(2, s.getLinkRef() != null ? String.valueOf(s.getLinkRef()) : null);
                    sp.setString(3, objectMapper.writeValueAsString(s));
                    sp.addBatch();

                    double[] c = s.getLinkRef() != null ? linkCoord.get(String.valueOf(s.getLinkRef())) : null;
                    if (c != null) {
                        rp.setLong(1, rowid);
                        rp.setDouble(2, c[0]); rp.setDouble(3, c[0]);
                        rp.setDouble(4, c[1]); rp.setDouble(5, c[1]);
                        rp.addBatch();
                    }
                }
                sp.executeBatch();
                rp.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IOException("버스정류장 SQLite 빌드 실패", e);
        }
    }

    private String sanitize(String s) {
        return s == null ? "null" : s.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /** 편집 저장 등으로 정류장이 바뀌면 캐시 무효화. */
    public void invalidate(String versionId) {
        File db = dbCache.remove(versionId);
        if (db != null) {
            try { Files.deleteIfExists(db.toPath()); } catch (IOException ignored) {}
        }
    }
}
