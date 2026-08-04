package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.analytics.LaneTrafficResponse;
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

    /**
     * ⚠️ 실측 확정(외부 배포판 원본 vehicle_sim.db 가져오기 재현): 우리 NextSim 파이프라인이
     * 만드는 "신형" VehicleEvent 테이블은 spd/mode 컬럼을 실제로 갖고 있지만(다른 메서드들의
     * hasSpd 판정이 "VehicleEvent엔 없다"고 가정하는 것과 반대), 원본 배포판(예: 부천 참고
     * 데이터셋)의 VehicleEvent 테이블은 진짜로 veh_id/timestep/link_id/lane_id/pos_x/pos_y
     * 6개 컬럼만 있다 — 같은 테이블명("VehicleEvent")이 스키마가 다른 두 종류로 실존한다.
     * 테이블명만으로 판정하면 이 원본 데이터를 가져왔을 때 SELECT가 "no such column: spd"로
     * 예외를 던지고(readVehicleEvent/readVehicleEventsFiltered에서 조용히 삼켜짐) 빈 결과를
     * 반환해 "vehicle_sim.db가 없습니다"로 오인되거나(재생 타임라인이 아예 시작 못 함), viewport
     * 스트리밍은 차량 0대(문서 패킷만)로 조용히 실패했다. 테이블명 대신 실제 컬럼 존재를 직접
     * 확인해야 두 스키마 변형 모두 안전하게 처리된다.
     */
    private boolean columnExists(Connection conn, String schema, String tableName, String columnName) {
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT * FROM " + schema + "." + tableName + " LIMIT 0")) {
            ResultSetMetaData meta = rs.getMetaData();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                if (columnName.equalsIgnoreCase(meta.getColumnName(i))) return true;
            }
            return false;
        } catch (SQLException e) {
            return false;
        }
    }

    // vehicle_event
    public List<VehicleEvent> readVehicleEvent(String versionId) {
        List<VehicleEvent> vehicleEventList = new ArrayList<>();

        try {
            // ⚠️ 예전엔 prepareDbFile(캐시 미사용)을 써서, generateVehicleRoute 흐름에서 바로
            // 앞서 countEvents(prepareDbFileCached)가 이미 다운로드해둔 파일을 무시하고
            // vehicle_sim.db(GB급일 수 있음, 실측 최소 184MB)를 SFTP로 다시 통째로 재다운로드한
            // 뒤 쓰자마자 삭제했다 — "재생 버튼 눌러도 한참 안 뜨는" 지연의 실측 원인 중 하나.
            // prepareDbFileCached로 통일해 캐시된 로컬 사본을 재사용한다(다른 조회 메서드들과
            // 동일 패턴). 캐시 소유 파일이라 여기서 삭제하면 안 된다(invalidateDbCache가 관리).
            File dbFile = prepareDbFileCached(versionId);

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

                // ⚠️ spd는 신형(VehicleEvent) 스키마에도 실제 컬럼으로 존재하는데(실측 확인),
                // 예전엔 구형(VehicleEventDebugging) 전용인 줄 알고 신형 SELECT에서 빠져있었다
                // — 그 결과 VehicleController.dropStalePositionArtifacts가 항상 speed=0(기본값)
                // 만 보게 되어 커넥션→링크 전환 시 좌표 고정 아티팩트를 전혀 못 걸렀다.
                // ⚠️ 실측 확정(외부 배포판 원본 vehicle_sim.db 가져오기 재현): 그런데 "신형" 테이블명
                // (VehicleEvent)이라고 해서 항상 spd/mode 컬럼이 있는 건 아니다 — 원본 배포판의
                // VehicleEvent는 6개 컬럼(veh_id/timestep/link_id/lane_id/pos_x/pos_y)만 갖고
                // 있어서, 무조건 spd/mode를 SELECT하면 "no such column"으로 예외가 나 조용히
                // 빈 리스트를 반환했다(재생 자체가 "vehicle_sim.db 없음"으로 오인돼 시작 못 함).
                // 테이블명이 아니라 실제 컬럼 존재로 판정한다.
                boolean hasSpd = columnExists(conn, "vehicle_sim_db", tableName, "spd");
                boolean hasMode = columnExists(conn, "vehicle_sim_db", tableName, "mode");
                String dataQuery = isNewSchema
                        ? "SELECT veh_id, timestep, link_id, lane_id, pos_x, pos_y"
                            + (hasSpd ? ", spd" : "") + (hasMode ? ", mode" : "")
                            + " FROM vehicle_sim_db.VehicleEvent WHERE veh_id IN (" + inClause + ") ORDER BY veh_id, timestep"
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
                            v.setSpeed(!isNewSchema || hasSpd ? rs.getFloat("spd") : 0f);
                            v.setDriveMode(!isNewSchema || hasMode ? rs.getString("mode") : null);
                            if (!isNewSchema) {
                                v.setType(rs.getString("type"));
                                v.setAcc(rs.getFloat("acc"));
                                v.setSpacing(rs.getString("spacing"));
                                v.setLeaderId(rs.getString("leader_id"));
                                v.setTargetlaneId(rs.getString("target_lane_id"));
                            }
                            vehicleEventList.add(v);
                        }
                    }
                }
            }
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
        return readVehicleEventsFiltered(versionId, linkIds, fromTime, toTime, maxVehicles, null);
    }

    /**
     * @param stickyIds 직전 응답에 포함됐던 veh_id — 선별 시 최우선순위를 준다. 재생 시간창이
     *                  슬라이드하면서 창 내 체류 이벤트 수(cnt) 순위가 흔들려, sticky 가드가
     *                  없으면 방금 화면에 보이던 차량이 다음 fetch에서 등수 밖으로 밀려 응답에서
     *                  통째로 빠졌다 몇 창 뒤 재등장하는 "깜빡임"이 발생했다(실사용 보고). sticky
     *                  차량도 all_sel의 JOIN 조건(창 내 이벤트 1건 이상)을 통과 못 하면 자동으로
     *                  후보에서 빠지므로 — 화면을 완전히 벗어난 차량까지 억지로 붙잡진 않는다.
     */
    public FilteredVehicleEvents readVehicleEventsFiltered(String versionId, List<String> linkIds,
                                                           double fromTime, double toTime, int maxVehicles,
                                                           Set<String> stickyIds) {
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

                // 1b) sticky(직전 응답) veh_id temp table — 없으면 빈 테이블(전부 is_sticky=0)
                stmt.execute("CREATE TEMP TABLE sticky_ids (id TEXT PRIMARY KEY)");
                if (stickyIds != null && !stickyIds.isEmpty()) {
                    try (PreparedStatement ps = conn.prepareStatement("INSERT OR IGNORE INTO sticky_ids(id) VALUES (?)")) {
                        for (String id : stickyIds) { ps.setString(1, id); ps.addBatch(); }
                        ps.executeBatch();
                    }
                }

                // 2) 시간창 내 bbox 링크를 지난 차량 전체 집합 (1회 스캔 → 전체 수 + 상한 선별에 재사용).
                //    상한 초과 시 우선순위 = ①sticky(직전 응답에 있었음) 여부 → ②viewport 체류시간
                //    (창 내 bbox 링크 이벤트 수) 내림차순 → 밀집 지역에서 화면을 스쳐가는 차보다
                //    오래 보이는 차를 우선 표시. veh_id 3차 정렬로 결정적(deterministic).
                stmt.execute("CREATE TEMP TABLE all_sel AS " +
                        "SELECT e.veh_id AS id, COUNT(*) AS cnt, " +
                        "MAX(CASE WHEN st.id IS NOT NULL THEN 1 ELSE 0 END) AS is_sticky " +
                        "FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN bbox_links b ON e.link_id = b.id " +
                        "LEFT JOIN sticky_ids st ON st.id = e.veh_id " +
                        "WHERE 1=1" + timeFilter +
                        " GROUP BY e.veh_id");
                try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM all_sel")) {
                    if (rs.next()) total = rs.getInt(1);
                }
                String limitClause = maxVehicles > 0 ? " LIMIT " + maxVehicles : "";
                stmt.execute("CREATE TEMP TABLE sel_vehicles AS " +
                        "SELECT id FROM all_sel ORDER BY is_sticky DESC, cnt DESC, id" + limitClause);

                // 3) 선별 차량의 시간창 내 전체 이벤트 (링크 무관)
                // mode(=driveMode)는 정체 구간(큐 모델, "None") 판별용 — buildVehiclePackets의
                // filterQueueJitter가 이 값으로 차선 왕복 튐 구간을 잡아낸다. spd는
                // dropStalePositionArtifacts(커넥션→링크 전환 시 좌표 고정 아티팩트 판별)가
                // 필요로 한다 — readVehicleEvent와 동일 이유로 추가.
                // ⚠️ 실측 확정(외부 배포판 원본 vehicle_sim.db 가져오기 재현): "신형" 테이블명
                // (VehicleEvent)이어도 spd/mode 컬럼이 없는 변형이 실존한다(원본 배포판은 6개
                // 컬럼만 가짐) — 무조건 SELECT하면 "no such column"으로 예외가 나 조용히 빈
                // 결과를 반환했고, viewport 스트리밍이 차량 0대(문서 패킷만)로 조용히 실패했다.
                // 테이블명이 아니라 실제 컬럼 존재로 판정한다.
                boolean hasSpd = columnExists(conn, "vehicle_sim_db", tableName, "spd");
                boolean hasMode = columnExists(conn, "vehicle_sim_db", tableName, "mode");
                String dataSql = "SELECT e.veh_id, e.timestep, e.link_id, e.lane_id, e.pos_x, e.pos_y"
                        + (hasSpd ? ", e.spd" : "") + (hasMode ? ", e.mode" : "") + " " +
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
                        v.setSpeed(hasSpd ? rs.getFloat("spd") : 0f);
                        v.setDriveMode(hasMode ? rs.getString("mode") : null);
                        out.add(v);
                    }
                }
            }
        } catch (SQLException | IOException e) {
            logger.error("[readVehicleEventsFiltered] 필터 조회 실패 versionId={}", versionId, e);
        }
        return new FilteredVehicleEvents(out, total);
    }

    /**
     * bbox 링크 위에 특정 시각(atTime) 근방(±halfWindowSec)에 존재하는 서로 다른 차량 수만
     * 카운트 — readVehicleEventsFiltered/readLinkTraffic이 쓰는 넓은 프리페치/집계 시간창
     * (최대 300초/±60초)과는 목적이 다르다. 그 창들은 "CZML을 얼마나 미리 만들어둘지"나
     * "히트맵 밀도"를 위한 것이라 window 안에서 스쳐 지나가기만 한 차량도 전부 잡히는데,
     * 그 총합을 사용자에게 "차량 N대"로 그대로 보여주면 화면에 차량이 안 보이는데도 큰
     * 숫자가 뜨는 것처럼 오해를 산다(실측 보고: "차량이 한 대도 없는데 523대 표시"). 이
     * 메서드는 오직 "지금 이 순간" 표시용 — 이벤트 목록을 만들지 않고 COUNT(DISTINCT)만
     * 구해 가볍다. halfWindowSec은 더미/NextSim 출력의 timestep 간격(보통 1초)보다 조금
     * 넉넉하게 잡아 정확히 그 순간 레코드가 없어도(클록 반올림 등) 놓치지 않게 한다.
     */
    public int countActiveVehicles(String versionId, List<String> linkIds, double atTime, double halfWindowSec) {
        if (linkIds == null || linkIds.isEmpty()) return 0;
        try {
            File dbFile = prepareDbFileCached(versionId);
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + dbFile.getAbsolutePath() + "' AS vehicle_sim_db");
                boolean isNewSchema = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                String tableName = isNewSchema ? "VehicleEvent" : "VehicleEventDebugging";

                stmt.execute("CREATE TEMP TABLE bbox_links (id TEXT PRIMARY KEY)");
                try (PreparedStatement ps = conn.prepareStatement("INSERT OR IGNORE INTO bbox_links(id) VALUES (?)")) {
                    for (String id : linkIds) { ps.setString(1, id); ps.addBatch(); }
                    ps.executeBatch();
                }
                double from = Math.max(0, atTime - halfWindowSec);
                double to = atTime + halfWindowSec;
                try (ResultSet rs = stmt.executeQuery(
                        "SELECT COUNT(DISTINCT e.veh_id) FROM vehicle_sim_db." + tableName + " e " +
                        "JOIN bbox_links b ON e.link_id = b.id " +
                        "WHERE e.timestep >= " + from + " AND e.timestep < " + to)) {
                    if (rs.next()) return rs.getInt(1);
                }
            }
        } catch (SQLException | IOException e) {
            logger.error("[countActiveVehicles] 조회 실패 versionId={}", versionId, e);
        }
        return 0;
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
                // ⚠️ 2026-08-04 수정: hasSpd = hasDebugging(구형 스키마만 spd 있다는 가정)는 틀렸다
                // — readVehicleEvent가 이미 실측 확인한 대로 신형 VehicleEvent 테이블도 실제
                // spd 컬럼을 갖고 있다(실사용 scenario3_1_V2 DB로 직접 확인: veh_id/timestep/
                // link_id/lane_id/pos_x/pos_y/heading_deg/spd/acc/mode). 테이블명이 아니라
                // columnExists로 실제 컬럼 존재를 직접 확인해야 두 스키마 변형 모두 정확하다
                // (columnExists 자체는 readVehicleEvent 근처 주석이 지적한 것과 동일한 이유로
                // 이미 이 파일에 존재 — 그 메서드만 못 쓰고 있었음).
                boolean hasSpd = hasDebugging || columnExists(conn, "vehicle_sim_db", tableName, "spd");

                String inClause = String.join(",", Collections.nCopies(linkIds.size(), "?"));
                boolean useTimeWindow = !(fromTime == 0 && toTime == 0);
                if (!useTimeWindow) {
                    // "전체 시간" 요청 — V/C ratio 계산(volume을 시간당으로 환산)에 실제 관측
                    // 구간이 필요해, 여기서 채운 뒤 응답에 그대로 실어 보낸다(요청 파라미터
                    // echo가 아니라 실측값). 명시적 window 요청은 기존처럼 그대로 echo.
                    try (PreparedStatement rangePs = conn.prepareStatement(
                            "SELECT MIN(timestep) AS lo, MAX(timestep) AS hi FROM vehicle_sim_db." + tableName)) {
                        try (ResultSet rangeRs = rangePs.executeQuery()) {
                            if (rangeRs.next()) {
                                out.setFromTime((int) rangeRs.getDouble("lo"));
                                out.setToTime((int) rangeRs.getDouble("hi"));
                            }
                        }
                    }
                }
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

    /**
     * bbox + 시간창 내 레인별 교통량 집계 — readLinkTraffic의 레인 단위 버전(메조 링크 레인/
     * 커넥션 색칠 전용, 마이크로는 개별 차량 CZML로 이미 표시되므로 대상 아님). GROUP BY에
     * lane_id만 추가한 것 외엔 동일 구조 — hasSpd 판정도 readLinkTraffic과 동일하게
     * columnExists로 직접 확인한다(같은 버그 클래스 회귀 방지).
     */
    public LaneTrafficResponse readLaneTraffic(String versionId, List<String> linkIds, int fromTime, int toTime) {
        LaneTrafficResponse out = new LaneTrafficResponse();
        out.setFromTime(fromTime);
        out.setToTime(toTime);
        if (linkIds == null || linkIds.isEmpty()) return out;

        try {
            File tempDbFile = prepareDbFileCached(versionId);
            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                boolean hasEvent = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                boolean hasDebugging = !hasEvent && tableExists(conn, "vehicle_sim_db", "VehicleEventDebugging");
                if (!hasEvent && !hasDebugging) return out;
                String tableName = hasEvent ? "VehicleEvent" : "VehicleEventDebugging";
                boolean hasSpd = hasDebugging || columnExists(conn, "vehicle_sim_db", tableName, "spd");

                String inClause = String.join(",", Collections.nCopies(linkIds.size(), "?"));
                boolean useTimeWindow = !(fromTime == 0 && toTime == 0);
                if (!useTimeWindow) {
                    try (PreparedStatement rangePs = conn.prepareStatement(
                            "SELECT MIN(timestep) AS lo, MAX(timestep) AS hi FROM vehicle_sim_db." + tableName)) {
                        try (ResultSet rangeRs = rangePs.executeQuery()) {
                            if (rangeRs.next()) {
                                out.setFromTime((int) rangeRs.getDouble("lo"));
                                out.setToTime((int) rangeRs.getDouble("hi"));
                            }
                        }
                    }
                }
                String timeFilter = useTimeWindow ? " AND timestep >= ? AND timestep < ? " : " ";
                String speedExpr = hasSpd ? "ROUND(AVG(spd) * 3.6, 2)" : "0.0";
                String sql = "SELECT link_id, lane_id, COUNT(DISTINCT veh_id) AS volume, " + speedExpr + " AS avg_speed "
                        + "FROM vehicle_sim_db." + tableName + " WHERE link_id IN (" + inClause + ")"
                        + timeFilter + "GROUP BY link_id, lane_id";

                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    int idx = 1;
                    for (String id : linkIds) ps.setString(idx++, id);
                    if (useTimeWindow) { ps.setInt(idx++, fromTime); ps.setInt(idx++, toTime); }
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            out.getLanes().add(new LaneTrafficResponse.LaneTraffic(
                                    rs.getString("link_id"), rs.getInt("lane_id"),
                                    rs.getInt("volume"), rs.getDouble("avg_speed")));
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.error("[readLaneTraffic] 집계 실패 versionId={}", versionId, e);
        }
        return out;
    }

    public record VehicleLinkPair(String vehId, String linkId) {}

    /**
     * 차량별 "지금 이 순간의 링크" 1개(veh_id당 정확히 한 행) — atTime ± halfWindowSec 안에서
     * atTime에 가장 가까운 이벤트의 link_id. 지역(시도/시군구/읍면동) 교통량을 시간창 누적/체류
     * 다수결이 아니라 **실시간 위치**로 집계해야 한다는 지적("실시간으로 변화하는 위치를 반영
     * 못 시키는 문제") — 이전 두 버전(distinct 다중배정 → 체류시간 다수결)은 전부 "한동안의
     * 집계"였지 "지금 어디 있는가"가 아니었다. countActiveVehicles와 동일한 atTime/halfWindowSec
     * 관례(±3초 등 짧게)를 그대로 따른다. 지역 집계 시 이 대표 링크 하나로만 배정하므로
     * "지역별 합계 = 전체 차량 수" 분할(partition)도 자동으로 유지된다.
     */
    public List<VehicleLinkPair> readVehicleCurrentLink(String versionId, List<String> linkIds,
                                                          double atTime, double halfWindowSec) {
        List<VehicleLinkPair> out = new ArrayList<>();
        if (linkIds == null || linkIds.isEmpty()) return out;

        try {
            File tempDbFile = prepareDbFileCached(versionId);
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite::memory:");
                 Statement stmt = conn.createStatement()) {
                stmt.execute("ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db");

                boolean hasEvent = tableExists(conn, "vehicle_sim_db", "VehicleEvent");
                boolean hasDebugging = !hasEvent && tableExists(conn, "vehicle_sim_db", "VehicleEventDebugging");
                if (!hasEvent && !hasDebugging) return out;
                String tableName = hasEvent ? "VehicleEvent" : "VehicleEventDebugging";

                String inClause = String.join(",", Collections.nCopies(linkIds.size(), "?"));
                double from = Math.max(0, atTime - halfWindowSec);
                double to = atTime + halfWindowSec;
                String sql =
                        "SELECT veh_id, link_id FROM (" +
                        "  SELECT veh_id, link_id, " +
                        "         ROW_NUMBER() OVER (PARTITION BY veh_id ORDER BY ABS(timestep - ?) ASC) AS rn " +
                        "  FROM vehicle_sim_db." + tableName +
                        "  WHERE link_id IN (" + inClause + ") AND timestep >= ? AND timestep < ?" +
                        ") WHERE rn = 1";

                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    int idx = 1;
                    ps.setDouble(idx++, atTime);
                    for (String id : linkIds) ps.setString(idx++, id);
                    ps.setDouble(idx++, from);
                    ps.setDouble(idx++, to);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            out.add(new VehicleLinkPair(rs.getString("veh_id"), rs.getString("link_id")));
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.error("[readVehicleCurrentLink] 조회 실패 versionId={}", versionId, e);
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
