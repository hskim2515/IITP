package com.iitp.iitp_rest.service.signal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.signal.SignalResponse;
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
 * 신호 BBox 타일링 서비스 (네트워크 타일링과 동일 패턴 — SQLite + RTree, 읽기 전용).
 *
 * <p>핵심 차이: <b>신호 데이터에는 좌표가 없다(nodeId 만).</b> 따라서 빌드 시 네트워크 노드의
 * 좌표를 join 하여 신호의 bbox 를 만든다 ("신호는 네트워크 노드에 종속"). 같은 nodeId 의
 * 신호(turn) 레코드들은 그 노드 좌표를 공유한다.
 *
 * <p>완전 additive: 기존 {@code GET /signal/{versionId}} 는 그대로 두고 새 {@code /tiles} 만 사용.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SignalTileService {

    private final SignalService signalService;
    private final NetworkService networkService;
    private final NetworkMapper networkMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, File> dbCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ReentrantLock> buildLocks = new ConcurrentHashMap<>();

    /** bbox 와 교차하는 신호(turn) 레코드 반환. */
    public List<SignalResponse> queryByBbox(String versionId,
                                            double west, double south, double east, double north) throws IOException {
        File db = ensureDb(versionId);
        List<SignalResponse> out = new ArrayList<>();
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            // RTree: 노드 단위 bbox → 그 노드의 신호 레코드 전부
            String sql =
                "SELECT s.json FROM signals s JOIN signal_rtree r ON s.rowid = r.id " +
                "WHERE r.maxX >= ? AND r.minX <= ? AND r.maxY >= ? AND r.minY <= ?";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setDouble(1, west); ps.setDouble(2, east);
                ps.setDouble(3, south); ps.setDouble(4, north);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        out.add(objectMapper.readValue(rs.getString(1), SignalResponse.class));
                    }
                }
            }
        } catch (SQLException e) {
            throw new IOException("신호 타일 쿼리 실패: " + versionId, e);
        }
        log.info("[SignalTileService] {} bbox=({},{},{},{}) → signals={}",
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

            // 1) 신호 전체 로드
            List<SignalResponse> signals;
            try {
                signals = signalService.getDataFromXml(versionId);
            } catch (IOException e) {
                throw e;
            } catch (Exception e) {
                throw new IOException("signal.xml 로드 실패: " + versionId, e);
            }
            return ingest(versionId, signals);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 주어진 신호 목록으로 versionId 의 SQLite(.db) 를 빌드·캐시 (signal.xml 재파싱 없이).
     * saveSignal 시점에 첫 타일 요청의 lazy 빌드(~3s)를 저장 처리 시간으로 옮긴다.
     * 네트워크 노드 좌표는 내부에서 로드(신호 bbox 의 출처).
     */
    public File ingest(String versionId, List<SignalResponse> signals) throws IOException {
        Map<String, double[]> nodeCoord = loadNodeCoords(versionId);
        File db = Files.createTempFile("signal_tile_" + sanitize(versionId) + "_", ".db").toFile();
        db.deleteOnExit();
        buildDb(db, signals, nodeCoord);
        dbCache.put(versionId, db);
        log.info("[SignalTileService] SQLite 빌드 완료 {} ({} signals) → {}",
                versionId, signals.size(), db.getAbsolutePath());
        return db;
    }

    /** 네트워크 노드 좌표 맵 (신호 좌표의 출처). 네트워크 없으면 빈 맵. */
    private Map<String, double[]> loadNodeCoords(String versionId) {
        Map<String, double[]> map = new HashMap<>();
        try {
            NetworkXml xml = networkService.getNetworkXmlByVersionId(versionId);
            NetworkResponse net = networkMapper.toResponse(xml);
            for (NodeResponse n : net.getNodes()) {
                if (n.getId() == null || n.getCoordinates() == null) continue;
                Double lng = n.getCoordinates().getLng();
                Double lat = n.getCoordinates().getLat();
                if (lng != null && lat != null) map.put(String.valueOf(n.getId()), new double[]{lng, lat});
            }
        } catch (Exception e) {
            log.warn("[SignalTileService] 네트워크 노드 좌표 로드 실패 (신호 bbox 비게 됨): {}", e.getMessage());
        }
        return map;
    }

    /** 신호 → SQLite: signals(json) + RTree(노드 좌표 기준 bbox, 좌표 없으면 인덱스 제외) */
    private void buildDb(File db, List<SignalResponse> signals, Map<String, double[]> nodeCoord) throws IOException {
        String url = "jdbc:sqlite:" + db.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement st = conn.createStatement()) {
                st.executeUpdate("CREATE TABLE signals (rowid INTEGER PRIMARY KEY, node_id TEXT, json TEXT)");
                st.executeUpdate("CREATE VIRTUAL TABLE signal_rtree USING rtree(id, minX, maxX, minY, maxY)");
            }
            try (PreparedStatement sp = conn.prepareStatement("INSERT INTO signals(rowid,node_id,json) VALUES (?,?,?)");
                 PreparedStatement rp = conn.prepareStatement("INSERT INTO signal_rtree(id,minX,maxX,minY,maxY) VALUES (?,?,?,?,?)")) {
                long rowid = 0;
                for (SignalResponse s : signals) {
                    rowid++;
                    sp.setLong(1, rowid);
                    sp.setString(2, s.getNodeId());
                    sp.setString(3, objectMapper.writeValueAsString(s));
                    sp.addBatch();

                    double[] c = s.getNodeId() != null ? nodeCoord.get(s.getNodeId()) : null;
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
            throw new IOException("신호 SQLite 빌드 실패", e);
        }
    }

    private String sanitize(String s) {
        return s == null ? "null" : s.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /** 편집 저장 등으로 신호가 바뀌면 캐시 무효화. */
    public void invalidate(String versionId) {
        File db = dbCache.remove(versionId);
        if (db != null) {
            try { Files.deleteIfExists(db.toPath()); } catch (IOException ignored) {}
        }
    }
}
