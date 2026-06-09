package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
import com.iitp.iitp_rest.model.analytics.OverallSummaryResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.net.URL;
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

        try (InputStream in = new URL(remoteUrl + versionId + "/vehicle_sim.db_bak").openStream();
             OutputStream out = new FileOutputStream(tempDbFile)) {

            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
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

    /** veh_id → VehicleInfo (length, width 등) 맵 반환 */
    public Map<String, VehicleInfo> readVehicleInfoMap(String versionId) {
        Map<String, VehicleInfo> map = new HashMap<>();
        try {
            File dbFile = prepareDbFile(versionId);
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
        } catch (SQLException | IOException e) {
            logger.error("Error while reading VehicleInfo", e);
        }
        return map;
    }

    // 링크별 교통량 통계 집계 (SQLite GROUP BY 활용 - 전체 이벤트 로드 없이 효율적으로 처리)
    public LinkStatsResponse readLinkStats(String versionId, int interval, int topN) {
        try {
            File tempDbFile = prepareDbFile(versionId);

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
            File dbFile = prepareDbFile(versionId);
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
