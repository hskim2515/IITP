package com.iitp.iitp_rest.service.pavementMarking;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingData;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingVersion;
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
 * 노면표시(pavement marking) BBox 타일링 서비스 (버스/철도정류장 타일링과 동일 패턴 — SQLite +
 * RTree, 읽기 전용).
 *
 * <p>노면표시는 자체 좌표(coordinates) 리스트를 가지므로 네트워크 join 없이 바로 bbox 를 만든다
 * (셋 중 가장 단순한 케이스). 좌표가 여러 점인 경우 전체 점의 bbox 를 취한다.
 *
 * <p>완전 additive: 기존 {@code GET /pavement-marking/{versionId}} 는 그대로 두고 새
 * {@code /tiles} 만 사용.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PavementMarkingTileService {

    private final PavementMarkingService pavementMarkingService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, File> dbCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ReentrantLock> buildLocks = new ConcurrentHashMap<>();

    /** bbox 와 교차하는 노면표시 레코드 반환. */
    public List<PavementMarkingData> queryByBbox(String versionId,
                                                  double west, double south, double east, double north) throws IOException {
        File db = ensureDb(versionId);
        List<PavementMarkingData> out = new ArrayList<>();
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            String sql =
                "SELECT m.json FROM markings m JOIN marking_rtree r ON m.rowid = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ?";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        out.add(objectMapper.readValue(rs.getString(1), PavementMarkingData.class));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("노면표시 타일 쿼리 실패: " + versionId, e);
        }
        log.info("[PavementMarkingTileService] {} bbox=({},{},{},{}) → markings={}",
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

            List<PavementMarkingData> markings;
            try {
                PavementMarkingVersion latest = pavementMarkingService.getDataFromDatabase(versionId);
                markings = latest.getData() != null ? latest.getData() : pavementMarkingService.getDataFromXml(versionId);
            } catch (IOException e) {
                throw e;
            } catch (Exception e) {
                throw new IOException("pavementMarking 로드 실패: " + versionId, e);
            }
            return ingest(versionId, markings);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 노면표시 목록으로 versionId 의 SQLite(.db) 를 빌드·캐시(재파싱 없이).
     * savePavementMarking 시점에 첫 타일 요청의 lazy 빌드를 저장 처리 시간으로 옮긴다.
     */
    public File ingest(String versionId, List<PavementMarkingData> markings) throws IOException {
        File db = Files.createTempFile("pavementmarking_tile_" + sanitize(versionId) + "_", ".db").toFile();
        db.deleteOnExit();
        buildDb(db, markings);
        dbCache.put(versionId, db);
        log.info("[PavementMarkingTileService] SQLite 빌드 완료 {} ({} markings) → {}",
                versionId, markings.size(), db.getAbsolutePath());
        return db;
    }

    /** 노면표시 → SQLite: markings(json) + RTree(좌표 리스트 전체의 bbox, 좌표 없으면 인덱스 제외) */
    private void buildDb(File db, List<PavementMarkingData> markings) throws IOException {
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement st = conn.createStatement()) {
                st.executeUpdate("CREATE TABLE markings (rowid INTEGER PRIMARY KEY, marking_id TEXT, json TEXT)");
                st.executeUpdate("CREATE VIRTUAL TABLE marking_rtree USING rtree(id, minX, maxX, minY, maxY)");
            }
            try (PreparedStatement mp = conn.prepareStatement("INSERT INTO markings(rowid,marking_id,json) VALUES (?,?,?)");
                 PreparedStatement rp = conn.prepareStatement("INSERT INTO marking_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                long rowid = 0;
                for (PavementMarkingData m : markings) {
                    rowid++;
                    mp.setLong(1, rowid);
                    mp.setString(2, m.getId());
                    mp.setString(3, objectMapper.writeValueAsString(m));
                    mp.addBatch();

                    double[] bbox = computeBbox(m.getCoordinates());
                    if (bbox != null) {
                        rp.setLong(1, rowid);
                        rp.setDouble(2, bbox[0]); rp.setDouble(3, bbox[1]);
                        rp.setDouble(4, bbox[2]); rp.setDouble(5, bbox[3]);
                        rp.addBatch();
                    }
                }
                mp.executeBatch();
                rp.executeBatch();
            }
            conn.commit();
        } catch (SQLException e) {
            throw new IOException("노면표시 SQLite 빌드 실패", e);
        }
    }

    /** [minLng, maxLng, minLat, maxLat] — 좌표 없으면 null. */
    private double[] computeBbox(List<PavementMarkingData.Coordinates> coordinates) {
        if (coordinates == null || coordinates.isEmpty()) return null;
        double minLng = Double.MAX_VALUE, maxLng = -Double.MAX_VALUE;
        double minLat = Double.MAX_VALUE, maxLat = -Double.MAX_VALUE;
        boolean any = false;
        for (PavementMarkingData.Coordinates c : coordinates) {
            if (c == null || c.getLng() == null || c.getLat() == null) continue;
            any = true;
            minLng = Math.min(minLng, c.getLng()); maxLng = Math.max(maxLng, c.getLng());
            minLat = Math.min(minLat, c.getLat()); maxLat = Math.max(maxLat, c.getLat());
        }
        if (!any) return null;
        return new double[]{minLng, maxLng, minLat, maxLat};
    }

    private String sanitize(String s) {
        return s == null ? "null" : s.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /** 편집 저장 등으로 노면표시가 바뀌면 캐시 무효화. */
    public void invalidate(String versionId) {
        File db = dbCache.remove(versionId);
        if (db != null) {
            try { Files.deleteIfExists(db.toPath()); } catch (IOException ignored) {}
        }
    }
}
