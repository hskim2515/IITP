package com.iitp.iitp_rest.service.publicTransit.station;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.mapper.publicTransit.RailStationMapper;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
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
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 철도정류장 BBox 타일링 서비스 (버스정류장/신호 타일링과 동일 패턴 — SQLite + RTree, 읽기 전용).
 *
 * <p>철도정류장은 자체 좌표(coordinates)를 가지므로 버스정류장(linkRef 종속)과 달리 네트워크
 * join 없이 바로 bbox 를 만든다. 좌표가 없는 레코드(출입구만 있는 경우 등)는 인덱스에서
 * 제외된다 — 위치는 프론트에서 exit.linkRef 기반으로 다시 계산하므로 조회 필터링에만
 * 쓸 수 있으면 충분하다.
 *
 * <p>완전 additive: 기존 {@code GET /public-transit/station/rail/{versionId}} 는 그대로 두고
 * 새 {@code /tiles} 만 사용.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RailStationTileService {

    private final RailStationService railStationService;
    private final RailStationMapper railStationMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, File> dbCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ReentrantLock> buildLocks = new ConcurrentHashMap<>();

    /** bbox 와 교차하는 철도정류장 레코드 반환. */
    public List<RailStationResponse> queryByBbox(String versionId,
                                                  double west, double south, double east, double north) throws IOException {
        File db = ensureDb(versionId);
        List<RailStationResponse> out = new ArrayList<>();
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
                        out.add(objectMapper.readValue(rs.getString(1), RailStationResponse.class));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("철도정류장 타일 쿼리 실패: " + versionId, e);
        }
        log.info("[RailStationTileService] {} bbox=({},{},{},{}) → stations={}",
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

            List<RailStationResponse> stations;
            try {
                RailPublicTransitXml xml = railStationService.getRailStationXmlByVersionId(versionId);
                RailPublicTransitResponse res = railStationMapper.toResponse(xml);
                stations = res.getRailStations() != null ? res.getRailStations() : new ArrayList<>();
            } catch (IOException e) {
                throw e;
            } catch (Exception e) {
                throw new IOException("railStation 로드 실패: " + versionId, e);
            }
            return ingest(versionId, stations);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 정류장 목록으로 versionId 의 SQLite(.db) 를 빌드·캐시(재파싱 없이).
     * saveRailStations 시점에 첫 타일 요청의 lazy 빌드를 저장 처리 시간으로 옮긴다.
     */
    public File ingest(String versionId, List<RailStationResponse> stations) throws IOException {
        File db = Files.createTempFile("railstation_tile_" + sanitize(versionId) + "_", ".db").toFile();
        db.deleteOnExit();
        buildDb(db, stations);
        dbCache.put(versionId, db);
        log.info("[RailStationTileService] SQLite 빌드 완료 {} ({} stations) → {}",
                versionId, stations.size(), db.getAbsolutePath());
        return db;
    }

    /** 정류장 → SQLite: stations(json) + RTree(자체 좌표 기준 bbox, 좌표 없으면 인덱스 제외) */
    private void buildDb(File db, List<RailStationResponse> stations) throws IOException {
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement st = conn.createStatement()) {
                st.executeUpdate("CREATE TABLE stations (rowid INTEGER PRIMARY KEY, station_id TEXT, json TEXT)");
                st.executeUpdate("CREATE VIRTUAL TABLE station_rtree USING rtree(id, minX, maxX, minY, maxY)");
            }
            try (PreparedStatement sp = conn.prepareStatement("INSERT INTO stations(rowid,station_id,json) VALUES (?,?,?)");
                 PreparedStatement rp = conn.prepareStatement("INSERT INTO station_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                long rowid = 0;
                for (RailStationResponse s : stations) {
                    rowid++;
                    sp.setLong(1, rowid);
                    sp.setString(2, s.getId());
                    sp.setString(3, objectMapper.writeValueAsString(s));
                    sp.addBatch();

                    Double lng = s.getCoordinates() != null ? s.getCoordinates().getLng() : null;
                    Double lat = s.getCoordinates() != null ? s.getCoordinates().getLat() : null;
                    if (lng != null && lat != null) {
                        rp.setLong(1, rowid);
                        rp.setDouble(2, lng); rp.setDouble(3, lng);
                        rp.setDouble(4, lat); rp.setDouble(5, lat);
                        rp.addBatch();
                    }
                }
                sp.executeBatch();
                rp.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IOException("철도정류장 SQLite 빌드 실패", e);
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
