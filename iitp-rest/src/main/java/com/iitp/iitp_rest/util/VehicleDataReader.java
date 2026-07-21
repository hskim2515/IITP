package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.model.analytics.LinkTrafficResponse;
import com.iitp.iitp_rest.model.analytics.OverallSummaryResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.sql.*;
import java.util.*;
import java.util.stream.Collectors;


@Component
public class VehicleDataReader {

    private static final Logger logger = LoggerFactory.getLogger(VehicleDataReader.class);

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    @Value("${database.vehicle_sim.localPath:}")
    private String localPath;

    /** versionId → 로컬 캐시된 DB 사본 (viewport 스트리밍 등 반복 조회용 — 요청마다 GB급 재다운로드 방지) */
    private final Map<String, File> dbFileCache = new java.util.concurrent.ConcurrentHashMap<>();

    /** 무효화 연쇄 리스너 — 파생 캐시(VehicleController ViewportCtx 등)가 등록해 함께 비워진다 */
    private final java.util.List<java.util.function.Consumer<String>> invalidationListeners =
            new java.util.concurrent.CopyOnWriteArrayList<>();

    public void addInvalidationListener(java.util.function.Consumer<String> listener) {
        invalidationListeners.add(listener);
    }

    /** 캐시 우선 DB 파일 준비. 반복 조회(viewport 스트리밍) 전용 — 호출측은 파일을 삭제하면 안 된다. */
    private File prepareDbFileCached(String versionId) throws IOException {
        File cached = dbFileCache.get(versionId);
        if (cached != null && cached.exists()) return cached;
        File fresh = prepareDbFile(versionId);
        dbFileCache.put(versionId, fresh);
        return fresh;
    }

    /** vehicle_sim.db 재생성/삭제 시 캐시 무효화 (localPath 직접 파일은 삭제하지 않음) */
    public void invalidateDbCache(String versionId) {
        File f = dbFileCache.remove(versionId);
        if (f != null && (localPath == null || localPath.isBlank()
                || !f.getAbsolutePath().equals(new File(localPath).getAbsolutePath()))) {
            try { f.delete(); } catch (Exception ignored) {}
        }
        for (var l : invalidationListeners) {
            try { l.accept(versionId); } catch (Exception ignored) {}
        }
    }

    private File prepareDbFile(String versionId) throws IOException {
        // 로컬 파일이 설정되어 있으면 원격 다운로드 없이 직접 사용
        if (localPath != null && !localPath.isBlank()) {
            File localFile = new File(localPath);
            if (localFile.exists()) {
                return localFile;
            }
            logger.warn("Local DB file not found: {}, falling back to remote", localPath);
        }

        File tempDbFile = File.createTempFile("vehicle_sim_temp", ".db");
        tempDbFile.deleteOnExit();

        // vehicle_sim.db 우선, 없으면 vehicle_sim.db_bak 시도
        String[] candidates = { "vehicle_sim.db", "vehicle_sim.db_bak" };
        InputStream in = null;
        for (String candidate : candidates) {
            try {
                in = RemoteXmlFetch.openStream(remoteUrl + versionId + "/" + candidate);
                logger.debug("[VehicleDataReader] {} 로드: {}", candidate, versionId);
                break;
            } catch (FileNotFoundException ignored) {}
        }
        if (in == null) throw new FileNotFoundException("vehicle_sim.db 파일 없음: " + versionId);

        try (InputStream src = in; OutputStream out = new FileOutputStream(tempDbFile)) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = src.read(buffer)) != -1) {
                out.write(buffer, 0, len);
            }
        }

        return tempDbFile;
    }

    /** 테이블 존재 여부 확인 */
    private boolean tableExists(Connection conn, String schema, String tableName) {
        try (ResultSet rs = conn.getMetaData().getTables(null, null, tableName, null)) {
            while (rs.next()) {
                if (tableName.equalsIgnoreCase(rs.getString("TABLE_NAME"))) return true;
            }
        } catch (SQLException ignored) {}
        // ATTACH된 스키마는 메타데이터로 안 보일 수 있어 직접 쿼리로 확인
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("SELECT 1 FROM " + schema + "." + tableName + " LIMIT 1");
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    // vehicle_event
    public List<VehicleEvent> readVehicleEvent(String versionId) {
        List<VehicleEvent> vehicleEventList = new ArrayList<>();

        try {
            File dbFile = prepareDbFile(versionId);
            boolean isTempFile = !dbFile.getAbsolutePath().equals(localPath != null ? new File(localPath).getAbsolutePath() : "");

            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                String attachSQL = "ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db";
                stmt.execute(attachSQL);

                // 테이블명 감지: VehicleEvent(신규) 또는 VehicleEventDebugging(구형)
                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";

                List<String> limitedIds = new ArrayList<>();
                String idQuery = "SELECT DISTINCT veh_id FROM vehicle_sim_db." + tableName;
                try (PreparedStatement pstmt = conn.prepareStatement(idQuery);
                     ResultSet rs = pstmt.executeQuery()) {
                    while (rs.next()) {
                        limitedIds.add(rs.getString("veh_id"));
                    }
                }

                if (limitedIds.isEmpty()) return vehicleEventList;

                String inClause = String.join(",", Collections.nCopies(limitedIds.size(), "?"));

                String dataQuery = isNewSchema
                        ? "SELECT veh_id, timestep, link_id, lane_id, pos_x, pos_y FROM vehicle_sim_db.VehicleEvent WHERE veh_id IN (" + inClause + ") ORDER BY veh_id, timestep"
                        : "SELECT veh_id, type, timestep, link_id, lane_id, pos_x, pos_y, spd, acc, spacing, mode, leader_id, target_lane_id FROM vehicle_sim_db.VehicleEventDebugging WHERE veh_id IN (" + inClause + ")";

                try (PreparedStatement pstmt = conn.prepareStatement(dataQuery)) {
                    for (int i = 0; i < limitedIds.size(); i++) {
                        pstmt.setString(i + 1, limitedIds.get(i));
                    }

                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            VehicleEvent v = new VehicleEvent();
                            v.setId(rs.getString("veh_id"));
                            v.setTimestep(rs.getDouble("timestep"));
                            v.setLinkId(rs.getString("link_id"));
                            v.setLaneId(rs.getString("lane_id"));
                            v.setPosX(rs.getFloat("pos_x"));
                            v.setPosY(rs.getFloat("pos_y"));
                            if (!isNewSchema) {
                                v.setType(rs.getString("type"));
                                v.setSpeed(rs.getFloat("spd"));
                                v.setAcc(rs.getFloat("acc"));
                                v.setSpacing(rs.getString("spacing"));
                                v.setDriveMode(rs.getString("mode"));
                                v.setLeaderId(rs.getString("leader_id"));
                                v.setTargetlaneId(rs.getString("target_lane_id"));
                            }
                            vehicleEventList.add(v);
                        }
                    }
                }
            }

            if (isTempFile) dbFile.delete();
        } catch (SQLException | IOException e) {
            logger.error("Error while reading limited vehicle data", e);
        }

        return vehicleEventList;
    }

    /** viewport 필터 조회 결과 — events + 상한 적용 전 전체 매칭 차량 수 (밀집 판단용) */
    public record FilteredVehicleEvents(List<VehicleEvent> events, int totalVehicles) {}

    /**
     * viewport(bbox 내 링크) + 시간창 필터 차량 이벤트 조회 (개별 차량 near LOD 스트리밍).
     *
     * <p>차량 선별: 시간창 내에 주어진 링크 중 하나라도 지난 veh_id.
     * 궤적 슬라이싱: 선별 차량의 시간창 내 이벤트 전부(링크 무관 — bbox 밖 구간도 보간 연속성 위해 포함).
     * IN 절 대신 temp table 사용 — SQLite 변수 한도(999) 및 대량 링크/차량 대응.
     *
     * @param linkIds  bbox 내 링크 id (비면 빈 결과)
     * @param fromTime 시간창 시작(초, 버퍼 포함), toTime 끝. 둘 다 0 이면 전체 시간.
     * @param maxVehicles 선별 차량 수 상한 (0 이면 무제한) — 응답 폭주 방지
     */
    public FilteredVehicleEvents readVehicleEventsFiltered(String versionId, List<String> linkIds,
                                                           double fromTime, double toTime, int maxVehicles) {
        List<VehicleEvent> out = new ArrayList<>();
        int total = 0;
        if (linkIds == null || linkIds.isEmpty()) return new FilteredVehicleEvents(out, 0);

        try {
            File dbFile = prepareDbFileCached(versionId); // 반복 조회 — 삭제 금지
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";
                boolean useTimeWindow = !(fromTime == 0 && toTime == 0);
                String timeFilter = useTimeWindow ? " AND e.timestep >= " + fromTime + " AND e.timestep < " + toTime : "";

                // 1) bbox 링크 temp table
                stmt.execute("CREATE TEMP TABLE bbox_links (id TEXT PRIMARY KEY)");
                try (PreparedStatement ps = conn.prepareStatement("INSERT OR IGNORE INTO bbox_links(id) VALUES (?)")) {
                    for (String id : linkIds) { ps.setString(1, id); ps.addBatch(); }
                    ps.executeBatch();
                }

                // 2) 시간창 내 bbox 링크를 지난 차량 전체 집합 (1회 스캔 → 전체 수 + 상한 선별에 재사용).
                //    상한 초과 시 우선순위 = viewport 체류시간(창 내 bbox 링크 이벤트 수) 내림차순
                //    → 밀집 지역에서 화면을 스쳐가는 차보다 오래 보이는 차를 우선 표시.
                //    veh_id 2차 정렬로 결정적(deterministic) → 창 갱신 간 선별 집합이 안정적.
                stmt.execute("CREATE TEMP TABLE all_sel AS " +
                        "SELECT e.veh_id AS id, COUNT(*) AS cnt FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN bbox_links b ON e.link_id = b.id WHERE 1=1" + timeFilter +
                        " GROUP BY e.veh_id");
                try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM all_sel")) {
                    if (rs.next()) total = rs.getInt(1);
                }
                String limitClause = maxVehicles > 0 ? " LIMIT " + maxVehicles : "";
                stmt.execute("CREATE TEMP TABLE sel_vehicles AS " +
                        "SELECT id FROM all_sel ORDER BY cnt DESC, id" + limitClause);

                // 3) 선별 차량의 시간창 내 전체 이벤트 (링크 무관)
                String dataSql = "SELECT e.veh_id, e.timestep, e.link_id, e.lane_id, e.pos_x, e.pos_y " +
                        "FROM vehicle_sim_db." + tableName + " e JOIN sel_vehicles s ON e.veh_id = s.id " +
                        "WHERE 1=1" + timeFilter + " ORDER BY e.veh_id, e.timestep";
                try (ResultSet rs = stmt.executeQuery(dataSql)) {
                    while (rs.next()) {
                        VehicleEvent v = new VehicleEvent();
                        v.setId(rs.getString("veh_id"));
                        v.setTimestep(rs.getDouble("timestep"));
                        v.setLinkId(rs.getString("link_id"));
                        v.setLaneId(rs.getString("lane_id"));
                        v.setPosX(rs.getFloat("pos_x"));
                        v.setPosY(rs.getFloat("pos_y"));
                        out.add(v);
                    }
                }
            }
        } catch (SQLException | IOException e) {
            logger.error("[readVehicleEventsFiltered] 필터 조회 실패 versionId={}", versionId, e);
        }
        return new FilteredVehicleEvents(out, total);
    }

    /** 이벤트 총 건수 (DB 없으면 0). 대용량 전체-로드 가드/largeMode 판단용 */
    public long countEvents(String versionId) {
        try {
            File dbFile = prepareDbFileCached(versionId);
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");
                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";
                try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM vehicle_sim_db." + tableName)) {
                    if (rs.next()) return rs.getLong(1);
                }
            }
        } catch (FileNotFoundException e) {
            return 0; // DB 없음
        } catch (SQLException | IOException e) {
            logger.error("[countEvents] 조회 실패 versionId={}", versionId, e);
        }
        return 0;
    }

    /** 시뮬레이션 전체 시간 범위 [min,max] (초). 실패 시 [0,600] */
    public double[] readSimTimeRange(String versionId) {
        try {
            File dbFile = prepareDbFileCached(versionId); // 반복 조회 — 삭제 금지
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");
                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";
                try (ResultSet rs = stmt.executeQuery(
                        "SELECT MIN(timestep) AS mn, MAX(timestep) AS mx FROM vehicle_sim_db." + tableName)) {
                    if (rs.next()) {
                        return new double[]{ rs.getDouble("mn"), rs.getDouble("mx") };
                    }
                }
            }
        } catch (SQLException | IOException e) {
            logger.error("[readSimTimeRange] 조회 실패 versionId={}", versionId, e);
        }
        return new double[]{0, 600};
    }

    /** veh_id → VehicleInfo (length, width 등) 맵 반환 */
    public Map<String, VehicleInfo> readVehicleInfoMap(String versionId) {
        Map<String, VehicleInfo> map = new HashMap<>();
        try {
            // ⚠️ prepareDbFile(비캐시)은 호출마다 120MB temp 사본 생성 + 미삭제로 디스크 누수 (70GB 실사고)
            File dbFile = prepareDbFileCached(versionId);
            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                String query = "SELECT veh_id, veh_type, length, width FROM vehicle_sim_db.VehicleInfo";
                try (PreparedStatement pstmt = conn.prepareStatement(query);
                     ResultSet rs = pstmt.executeQuery()) {
                    while (rs.next()) {
                        VehicleInfo info = new VehicleInfo();
                        info.setId(rs.getInt("veh_id"));
                        info.setType(rs.getString("veh_type"));
                        info.setLength(rs.getDouble("length"));
                        info.setWidth(rs.getDouble("width"));
                        map.put(rs.getString("veh_id"), info);
                    }
                }
            }
        } catch (SQLException e) {
            // VehicleInfo 테이블이 없는 더미 DB에서는 정상 — 빈 map 반환
            if (e.getMessage() != null && e.getMessage().contains("no such table")) {
                logger.debug("VehicleInfo 테이블 없음 (더미 DB): {}", versionId);
            } else {
                logger.error("Error while reading VehicleInfo", e);
            }
        } catch (IOException e) {
            logger.error("Error while reading VehicleInfo", e);
        }
        return map;
    }

    /**
     * 주어진 링크 집합 + 시간창에 대한 링크별 교통량 집계 (차량 overview LOD).
     * bbox 내 링크 id 는 호출측(네트워크 RTree)에서 구해 전달한다 → 두 SQLite 협업.
     * 개별 차량 이벤트를 로드하지 않고 SQLite GROUP BY 로 집계해 메모리 무관.
     *
     * @param linkIds  집계 대상 링크 id (비면 빈 결과)
     * @param fromTime 시간창 시작(초), toTime 끝(초). 둘 다 0 이면 전체 시간.
     */
    public LinkTrafficResponse readLinkTraffic(String versionId, List<String> linkIds, int fromTime, int toTime) {
        LinkTrafficResponse out = new LinkTrafficResponse();
        out.setFromTime(fromTime);
        out.setToTime(toTime);
        if (linkIds == null || linkIds.isEmpty()) return out;

        try {
            // 히트맵 집계가 1초 간격 폴링 → 반드시 캐시 사용 (비캐시는 호출마다 120MB 사본 → 디스크 누수)
            File tempDbFile = prepareDbFileCached(versionId);
            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                // ⚠️ VehicleEvent(신형)를 반드시 먼저 확인할 것 — 이 파일이 파일러 두 테이블을 모두
                // 갖고 있을 수 있는데(VehicleEventDebugging이 빈 레거시 스키마로 같이 존재하는 경우),
                // "존재 여부만" 보고 VehicleEventDebugging을 먼저 고르면 실제 데이터(VehicleEvent)가
                // 아니라 빈 테이블을 조회하게 되어 항상 0건이 나온다(readVehicleEventsFiltered 등
                // 이 파일의 다른 메서드는 전부 VehicleEvent를 먼저 확인하는데 이 메서드만 반대였음 —
                // link-traffic 집계가 늘 빈 응답을 내던 원인, TrafficHeatmapCesiumLayer/
                // TrafficTailCesiumLayer가 전혀 안 보이던 버그).
                boolean hasEvent = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                boolean hasDebugging = !hasEvent && tableExists(conn, "vehicle_sim_db", "VehicleEventDebugging");
                if (!hasEvent && !hasDebugging) return out; // vehicle_sim 테이블 형식은 미지원(좌표 기반) → 빈 결과
                String tableName = hasEvent ? "VehicleEvent" : "VehicleEventDebugging";
                boolean hasSpd = hasDebugging;

                String inClause = String.join(",", Collections.nCopies(linkIds.size(), "?"));
                boolean useTimeWindow = !(fromTime == 0 && toTime == 0);
                String timeFilter = useTimeWindow ? " AND timestep >= ? AND timestep < ? " : " ";
                String speedExpr = hasSpd ? "ROUND(AVG(spd) * 3.6, 2)" : "0.0";
                String sql = "SELECT link_id, COUNT(DISTINCT veh_id) AS volume, " + speedExpr + " AS avg_speed "
                        + "FROM vehicle_sim_db." + tableName + " WHERE link_id IN (" + inClause + ")"
                        + timeFilter + "GROUP BY link_id";

                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    int idx = 1;
                    for (String id : linkIds) ps.setString(idx++, id);
                    if (useTimeWindow) { ps.setInt(idx++, fromTime); ps.setInt(idx++, toTime); }
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            out.getLinks().add(new LinkTrafficResponse.LinkTraffic(
                                    rs.getString("link_id"), rs.getInt("volume"), rs.getDouble("avg_speed")));
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.error("[readLinkTraffic] 집계 실패 versionId={}", versionId, e);
        }
        return out;
    }

    /** 차량 1대의 시간창 내 시작/끝 로컬 좌표 (원거리 OD 흐름 집계용) */
    public record VehicleOd(double fromX, double fromY, double toX, double toY) {}

    /**
     * bbox 내 링크를 지나는 차량들의 시간창 내 첫/마지막 위치(로컬 좌표, 미변환) 목록 — OD 흐름
     * 집계(가장 축소된 overview 티어)용. 좌표 변환(로컬→위경도)은 Scenario 정보가 필요해 호출측
     * (AnalyticsController)에서 수행한다 — 이 리더는 DB 접근만 담당.
     *
     * <p>차량 선별은 readVehicleEventsFiltered와 동일(시간창 내 bbox 링크를 지난 veh_id).
     * SQLite 윈도우 함수 버전 의존을 피하기 위해 MIN/MAX(timestep)로 첫/끝 시각을 구한 뒤
     * 그 시각의 실제 row를 자기조인으로 가져오는 2단계 방식을 쓴다.
     *
     * @param maxVehicles 선별 차량 수 상한 (응답 폭주 방지 — 집계용이라 개별 차량 상한보다 낮아도 됨)
     */
    public List<VehicleOd> readVehicleFirstLastPositions(String versionId, List<String> linkIds,
                                                          double fromTime, double toTime, int maxVehicles) {
        List<VehicleOd> out = new ArrayList<>();
        if (linkIds == null || linkIds.isEmpty()) return out;

        try {
            File dbFile = prepareDbFileCached(versionId);
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";
                boolean useTimeWindow = !(fromTime == 0 && toTime == 0);
                String timeFilter = useTimeWindow ? " AND timestep >= " + fromTime + " AND timestep < " + toTime : "";

                stmt.execute("CREATE TEMP TABLE bbox_links (id TEXT PRIMARY KEY)");
                try (PreparedStatement ps = conn.prepareStatement("INSERT OR IGNORE INTO bbox_links(id) VALUES (?)")) {
                    for (String id : linkIds) { ps.setString(1, id); ps.addBatch(); }
                    ps.executeBatch();
                }

                // 1) 시간창 내 bbox 링크를 지난 차량 (상한 적용 — 집계 표본이라 정밀 선별 불필요)
                stmt.execute("CREATE TEMP TABLE sel_vehicles AS " +
                        "SELECT DISTINCT veh_id AS id FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN bbox_links b ON e.link_id = b.id WHERE 1=1" + timeFilter +
                        " LIMIT " + maxVehicles);

                // 2) 선별 차량별 시간창 내 첫/끝 시각
                stmt.execute("CREATE TEMP TABLE veh_range AS " +
                        "SELECT e.veh_id AS id, MIN(e.timestep) AS min_t, MAX(e.timestep) AS max_t " +
                        "FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN sel_vehicles s ON e.veh_id = s.id WHERE 1=1" + timeFilter +
                        " GROUP BY e.veh_id");

                // 3) 그 시각의 실제 좌표 (min_t/max_t가 같으면 첫 row만 나옴 — Java에서 스킵)
                String sql = "SELECT e.veh_id, e.timestep, e.pos_x, e.pos_y " +
                        "FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN veh_range g ON e.veh_id = g.id AND (e.timestep = g.min_t OR e.timestep = g.max_t) " +
                        "WHERE 1=1" + timeFilter + " ORDER BY e.veh_id, e.timestep";

                String curVehId = null;
                double fx = 0, fy = 0, tx = 0, ty = 0;
                boolean haveFrom = false, haveTo = false;
                try (ResultSet rs = stmt.executeQuery(sql)) {
                    while (rs.next()) {
                        String vehId = rs.getString("veh_id");
                        if (!vehId.equals(curVehId)) {
                            if (haveFrom && haveTo && (fx != tx || fy != ty)) {
                                out.add(new VehicleOd(fx, fy, tx, ty));
                            }
                            curVehId = vehId;
                            fx = rs.getFloat("pos_x"); fy = rs.getFloat("pos_y");
                            haveFrom = true; haveTo = false;
                        } else {
                            tx = rs.getFloat("pos_x"); ty = rs.getFloat("pos_y");
                            haveTo = true;
                        }
                    }
                    if (haveFrom && haveTo && (fx != tx || fy != ty)) {
                        out.add(new VehicleOd(fx, fy, tx, ty));
                    }
                }
            }
        } catch (SQLException | IOException e) {
            logger.error("[readVehicleFirstLastPositions] 조회 실패 versionId={}", versionId, e);
        }
        return out;
    }

    // 링크별 교통량 통계 집계 (SQLite GROUP BY 활용 - 전체 이벤트 로드 없이 효율적으로 처리)
    public LinkStatsResponse readLinkStats(String versionId, int interval, int topN) {
        try {
            File tempDbFile = prepareDbFileCached(versionId); // 비캐시는 호출마다 사본 → 디스크 누수

            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                String attachSQL = "ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db";
                stmt.execute(attachSQL);

                // 테이블 스키마 감지
                boolean hasVehicleEventDebugging = tableExists(conn, "vehicle_sim_db", "VehicleEventDebugging");
                boolean hasVehicleEvent = !hasVehicleEventDebugging && tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                boolean hasVehicleSim = !hasVehicleEventDebugging && !hasVehicleEvent
                        && tableExists(conn, "vehicle_sim_db", "vehicle_sim");

                if (hasVehicleSim) {
                    return readLinkStatsFromVehicleSimTable(conn, interval, topN);
                }

                // VehicleEventDebugging (구형, spd 컬럼 있음) 또는 VehicleEvent (신형, spd 없음) 처리
                String tableName = hasVehicleEvent ? "VehicleEvent" : "VehicleEventDebugging";
                boolean hasSpd = hasVehicleEventDebugging;

                // 1. 전체 시간대별 통계
                List<LinkStatsResponse.TimeSlotStats> overallTimeSeries = new ArrayList<>();
                String overallQuery = hasSpd
                        ? "SELECT CAST(timestep / ? AS INTEGER) * ? AS time_bucket, COUNT(DISTINCT veh_id) AS volume, ROUND(AVG(spd) * 3.6, 2) AS avg_speed FROM vehicle_sim_db." + tableName + " GROUP BY 1 ORDER BY 1"
                        : "SELECT CAST(timestep / ? AS INTEGER) * ? AS time_bucket, COUNT(DISTINCT veh_id) AS volume, 0.0 AS avg_speed FROM vehicle_sim_db." + tableName + " GROUP BY 1 ORDER BY 1";
                try (PreparedStatement pstmt = conn.prepareStatement(overallQuery)) {
                    pstmt.setInt(1, interval);
                    pstmt.setInt(2, interval);
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            overallTimeSeries.add(new LinkStatsResponse.TimeSlotStats(
                                    rs.getInt("time_bucket"), rs.getInt("volume"), rs.getDouble("avg_speed")));
                        }
                    }
                }

                // 2. 교통량 상위 N개 링크
                List<String> topLinkIds = new ArrayList<>();
                Map<String, Integer> linkVolumes = new LinkedHashMap<>();
                String topLinksQuery = "SELECT link_id, COUNT(DISTINCT veh_id) AS total_volume FROM vehicle_sim_db." + tableName
                        + " WHERE link_id IS NOT NULL GROUP BY link_id ORDER BY total_volume DESC LIMIT ?";
                try (PreparedStatement pstmt = conn.prepareStatement(topLinksQuery)) {
                    pstmt.setInt(1, topN);
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            String linkId = rs.getString("link_id");
                            topLinkIds.add(linkId);
                            linkVolumes.put(linkId, rs.getInt("total_volume"));
                        }
                    }
                }

                if (topLinkIds.isEmpty()) {
                    return new LinkStatsResponse(interval, overallTimeSeries, Collections.emptyList());
                }

                String inClause = String.join(",", Collections.nCopies(topLinkIds.size(), "?"));

                // 3. 상위 링크별 평균 속도
                Map<String, Double> linkSpeeds = new LinkedHashMap<>();
                String linkSpeedQuery = hasSpd
                        ? "SELECT link_id, ROUND(AVG(spd) * 3.6, 2) AS avg_speed FROM vehicle_sim_db." + tableName + " WHERE link_id IN (" + inClause + ") GROUP BY link_id"
                        : "SELECT link_id, 0.0 AS avg_speed FROM vehicle_sim_db." + tableName + " WHERE link_id IN (" + inClause + ") GROUP BY link_id";
                try (PreparedStatement pstmt = conn.prepareStatement(linkSpeedQuery)) {
                    for (int i = 0; i < topLinkIds.size(); i++) pstmt.setString(i + 1, topLinkIds.get(i));
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) linkSpeeds.put(rs.getString("link_id"), rs.getDouble("avg_speed"));
                    }
                }

                // 4. 상위 링크별 시계열 통계
                Map<String, List<LinkStatsResponse.TimeSlotStats>> linkTimeSeries = new LinkedHashMap<>();
                String linkTimeSeriesQuery = "SELECT link_id, CAST(timestep / ? AS INTEGER) * ? AS time_bucket, COUNT(DISTINCT veh_id) AS volume, "
                        + (hasSpd ? "ROUND(AVG(spd) * 3.6, 2)" : "0.0") + " AS avg_speed"
                        + " FROM vehicle_sim_db." + tableName + " WHERE link_id IN (" + inClause + ") GROUP BY 1, 2 ORDER BY 1, 2";
                try (PreparedStatement pstmt = conn.prepareStatement(linkTimeSeriesQuery)) {
                    pstmt.setInt(1, interval);
                    pstmt.setInt(2, interval);
                    for (int i = 0; i < topLinkIds.size(); i++) pstmt.setString(i + 3, topLinkIds.get(i));
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            String linkId = rs.getString("link_id");
                            linkTimeSeries.computeIfAbsent(linkId, k -> new ArrayList<>())
                                    .add(new LinkStatsResponse.TimeSlotStats(
                                            rs.getInt("time_bucket"), rs.getInt("volume"), rs.getDouble("avg_speed")));
                        }
                    }
                }

                // 5. 결과 조립
                List<LinkStatsResponse.LinkSummary> topLinks = topLinkIds.stream()
                        .map(linkId -> new LinkStatsResponse.LinkSummary(
                                linkId,
                                linkVolumes.getOrDefault(linkId, 0),
                                linkSpeeds.getOrDefault(linkId, 0.0),
                                linkTimeSeries.getOrDefault(linkId, Collections.emptyList())))
                        .collect(Collectors.toList());

                return new LinkStatsResponse(interval, overallTimeSeries, topLinks);
            }
        } catch (SQLException | IOException e) {
            logger.error("Error while reading link stats for versionId: {}", versionId, e);
            return new LinkStatsResponse(interval, Collections.emptyList(), Collections.emptyList());
        }
    }

    /** vehicle_sim 테이블 (id, timestep, pos_x, pos_y, link_id) 기반 링크 통계 - LAG으로 속도 계산 */
    private LinkStatsResponse readLinkStatsFromVehicleSimTable(Connection conn, int interval, int topN) throws SQLException {

        // 1. 전체 시간대별 교통량 (속도 없음)
        List<LinkStatsResponse.TimeSlotStats> overallTimeSeries = new ArrayList<>();
        String overallQuery = "SELECT CAST(timestep / ? AS INTEGER) * ? AS time_bucket, COUNT(DISTINCT id) AS volume"
                + " FROM vehicle_sim_db.vehicle_sim GROUP BY 1 ORDER BY 1";
        try (PreparedStatement pstmt = conn.prepareStatement(overallQuery)) {
            pstmt.setInt(1, interval);
            pstmt.setInt(2, interval);
            try (ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    overallTimeSeries.add(new LinkStatsResponse.TimeSlotStats(
                            rs.getInt("time_bucket"), rs.getInt("volume"), 0.0));
                }
            }
        }

        // 2. 교통량 상위 N개 링크
        List<String> topLinkIds = new ArrayList<>();
        Map<String, Integer> linkVolumes = new LinkedHashMap<>();
        String topLinksQuery = "SELECT link_id, COUNT(DISTINCT id) AS total_volume FROM vehicle_sim_db.vehicle_sim"
                + " WHERE link_id IS NOT NULL GROUP BY link_id ORDER BY total_volume DESC LIMIT ?";
        try (PreparedStatement pstmt = conn.prepareStatement(topLinksQuery)) {
            pstmt.setInt(1, topN);
            try (ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    String linkId = rs.getString("link_id");
                    topLinkIds.add(linkId);
                    linkVolumes.put(linkId, rs.getInt("total_volume"));
                }
            }
        }

        if (topLinkIds.isEmpty()) {
            return new LinkStatsResponse(interval, overallTimeSeries, Collections.emptyList());
        }

        // 3+4. LAG 기반 속도 + 시계열 통계 (상위 링크 대상)
        String inClause = String.join(",", Collections.nCopies(topLinkIds.size(), "?"));
        Map<String, Double> linkSpeeds = new LinkedHashMap<>();
        Map<String, List<LinkStatsResponse.TimeSlotStats>> linkTimeSeries = new LinkedHashMap<>();

        String lagQuery =
                "WITH filtered AS (" +
                "  SELECT id, timestep, pos_x, pos_y, link_id FROM vehicle_sim_db.vehicle_sim WHERE link_id IN (" + inClause + ")" +
                "), lagged AS (" +
                "  SELECT id, link_id, timestep, pos_x, pos_y," +
                "    LAG(pos_x) OVER (PARTITION BY id ORDER BY timestep) AS prev_x," +
                "    LAG(pos_y) OVER (PARTITION BY id ORDER BY timestep) AS prev_y," +
                "    LAG(timestep) OVER (PARTITION BY id ORDER BY timestep) AS prev_t," +
                "    LAG(link_id) OVER (PARTITION BY id ORDER BY timestep) AS prev_link_id" +
                "  FROM filtered" +
                ")" +
                "SELECT link_id," +
                "  CAST(timestep / ? AS INTEGER) * ? AS time_bucket," +
                "  COUNT(DISTINCT id) AS volume," +
                "  ROUND(AVG(CASE WHEN prev_x IS NOT NULL AND prev_link_id = link_id AND (timestep - prev_t) > 0" +
                "    THEN SQRT((pos_x-prev_x)*(pos_x-prev_x)+(pos_y-prev_y)*(pos_y-prev_y))/(timestep-prev_t)*3.6" +
                "    ELSE NULL END), 2) AS avg_speed" +
                " FROM lagged GROUP BY link_id, time_bucket ORDER BY link_id, time_bucket";

        try (PreparedStatement pstmt = conn.prepareStatement(lagQuery)) {
            for (int i = 0; i < topLinkIds.size(); i++) pstmt.setString(i + 1, topLinkIds.get(i));
            pstmt.setInt(topLinkIds.size() + 1, interval);
            pstmt.setInt(topLinkIds.size() + 2, interval);
            try (ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    String linkId = rs.getString("link_id");
                    double avgSpeed = rs.getDouble("avg_speed");
                    linkSpeeds.merge(linkId, avgSpeed, (a, b) -> b); // last bucket's avg or accumulate
                    linkTimeSeries.computeIfAbsent(linkId, k -> new ArrayList<>())
                            .add(new LinkStatsResponse.TimeSlotStats(
                                    rs.getInt("time_bucket"), rs.getInt("volume"), avgSpeed));
                }
            }
        }

        // linkSpeeds = weighted average across all time buckets
        for (String linkId : topLinkIds) {
            List<LinkStatsResponse.TimeSlotStats> ts = linkTimeSeries.getOrDefault(linkId, Collections.emptyList());
            double sumSpd = ts.stream().mapToDouble(LinkStatsResponse.TimeSlotStats::getAvgSpeed).filter(s -> s > 0).sum();
            long countSpd = ts.stream().filter(s -> s.getAvgSpeed() > 0).count();
            linkSpeeds.put(linkId, countSpd > 0 ? Math.round(sumSpd / countSpd * 100.0) / 100.0 : 0.0);
        }

        List<LinkStatsResponse.LinkSummary> topLinks = topLinkIds.stream()
                .map(linkId -> new LinkStatsResponse.LinkSummary(
                        linkId,
                        linkVolumes.getOrDefault(linkId, 0),
                        linkSpeeds.getOrDefault(linkId, 0.0),
                        linkTimeSeries.getOrDefault(linkId, Collections.emptyList())))
                .collect(Collectors.toList());

        return new LinkStatsResponse(interval, overallTimeSeries, topLinks);
    }

    /** 시뮬레이션 전체 요약 통계 */
    public OverallSummaryResponse readOverallSummary(String versionId) {
        try {
            File dbFile = prepareDbFileCached(versionId); // 비캐시는 호출마다 사본 → 디스크 누수
            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                boolean hasVehicleEventDebugging = tableExists(conn, "vehicle_sim_db", "VehicleEventDebugging");
                boolean hasVehicleEvent = !hasVehicleEventDebugging && tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                boolean hasVehicleSim = !hasVehicleEventDebugging && !hasVehicleEvent
                        && tableExists(conn, "vehicle_sim_db", "vehicle_sim");

                String idCol = hasVehicleSim ? "id" : "veh_id";
                String tableName = hasVehicleSim ? "vehicle_sim"
                        : (hasVehicleEvent ? "VehicleEvent" : "VehicleEventDebugging");

                // 기본 집계
                String summaryQuery = "SELECT COUNT(DISTINCT " + idCol + ") AS total_vehicles, " +
                        "COUNT(DISTINCT link_id) AS total_links, " +
                        "MAX(timestep) - MIN(timestep) AS sim_duration " +
                        "FROM vehicle_sim_db." + tableName;
                int totalVehicles = 0;
                int totalLinks = 0;
                double simDuration = 0;
                try (PreparedStatement pstmt = conn.prepareStatement(summaryQuery);
                     ResultSet rs = pstmt.executeQuery()) {
                    if (rs.next()) {
                        totalVehicles = rs.getInt("total_vehicles");
                        totalLinks = rs.getInt("total_links");
                        simDuration = rs.getDouble("sim_duration");
                    }
                }

                // 피크 교통량
                int peakVolume = 0;
                double peakTimestep = 0;
                String peakQuery = "SELECT CAST(timestep / 60 AS INTEGER) * 60 AS time_bucket, COUNT(DISTINCT " + idCol + ") AS volume " +
                        "FROM vehicle_sim_db." + tableName + " GROUP BY 1 ORDER BY volume DESC LIMIT 1";
                try (PreparedStatement pstmt = conn.prepareStatement(peakQuery);
                     ResultSet rs = pstmt.executeQuery()) {
                    if (rs.next()) {
                        peakVolume = rs.getInt("volume");
                        peakTimestep = rs.getDouble("time_bucket");
                    }
                }

                return new OverallSummaryResponse(totalVehicles, totalLinks, simDuration, peakVolume, peakTimestep);
            }
        } catch (SQLException | IOException e) {
            logger.error("Error while reading overall summary for versionId: {}", versionId, e);
            return new OverallSummaryResponse();
        }
    }

    // vehicle_info
//    public List<VehicleInfo> readLimitedByVehicleInfo(int numVehicles) {
//        List<VehicleInfo> vehicleInfoList = new ArrayList<>();
//
//        try {
//            File tempDbFile = prepareDbFile();
//            tempDbFile.deleteOnExit();
//
//            String memoryUrl = "jdbc:sqlite::memory:";
//            try (Connection conn = DriverManager.getConnection(memoryUrl);
//                 Statement stmt = conn.createStatement()) {
//
//                String attachSQL = "ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db";
//                stmt.execute(attachSQL);
//
//                List<String> limitedIds = new ArrayList<>();
//                String idQuery = "SELECT DISTINCT id FROM vehicle_sim_db.vehicle_info LIMIT ?";
//                try (PreparedStatement pstmt = conn.prepareStatement(idQuery)) {
//                    pstmt.setInt(1, numVehicles);
//                    try (ResultSet rs = pstmt.executeQuery()) {
//                        while (rs.next()) {
//                            limitedIds.add(rs.getString("id"));
//                        }
//                    }
//                }
//
//                if (limitedIds.isEmpty()) return vehicleInfoList;
//
//                String inClause = String.join(",", Collections.nCopies(limitedIds.size(), "?"));
//                String dataQuery = """
//            SELECT id, type, origin, destination, length, width, maxSpeed, maxAcc, maxDec, jamGap, reactionTime
//            FROM vehicle_sim_db.vehicle_info
//            WHERE id IN (""" + inClause + ")";
//
//                try (PreparedStatement pstmt = conn.prepareStatement(dataQuery)) {
//                    for (int i = 0; i < limitedIds.size(); i++) {
//                        pstmt.setString(i + 1, limitedIds.get(i));
//                    }
//
//                    try (ResultSet rs = pstmt.executeQuery()) {
//                        while (rs.next()) {
//                            VehicleInfo v = new VehicleInfo();
//                            v.setId(rs.getInt("id"));
//                            v.setType(rs.getString("type"));
//                            v.setOrigin(rs.getString("origin"));
//                            v.setDestination(rs.getString("destination"));
//                            v.setLength(rs.getDouble("length"));
//                            v.setWidth(rs.getDouble("width"));
//                            v.setMaxSpeed(rs.getDouble("maxSpeed"));
//                            v.setMaxAcc(rs.getDouble("maxAcc"));
//                            v.setMaxDec(rs.getDouble("maxDec"));
//                            v.setJamGap(rs.getDouble("jamGap"));
//                            v.setReactionTime(rs.getDouble("reactionTime"));
//                            vehicleInfoList.add(v);
//                        }
//                    }
//                }
//            }
//        } catch (SQLException | IOException e) {
//            logger.error("Error while reading limited vehicle info data", e);
//        }
//
//        return vehicleInfoList;
//    }

}
