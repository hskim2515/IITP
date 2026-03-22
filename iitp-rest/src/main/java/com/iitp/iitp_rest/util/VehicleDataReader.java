package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.VehicleInfo;
import com.iitp.iitp_rest.model.analytics.LinkStatsResponse;
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

    private File prepareDbFile(String versionId) throws IOException {

        File tempDbFile = File.createTempFile("vehicle_sim_temp", ".db");
        tempDbFile.deleteOnExit();

        try (InputStream in = new URL(remoteUrl + versionId + "/vehicle_sim.db").openStream();
             OutputStream out = new FileOutputStream(tempDbFile)) {

            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
                out.write(buffer, 0, len);
            }
        }

        return tempDbFile;
    }

    // vehicle_event
    public List<VehicleEvent> readVehicleEvent(String versionId) {
        List<VehicleEvent> vehicleEventList = new ArrayList<>();

        try {
            File tempDbFile = prepareDbFile(versionId);
            tempDbFile.deleteOnExit();

            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                String attachSQL = "ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db";
                stmt.execute(attachSQL);

                List<String> limitedIds = new ArrayList<>();
                String idQuery = "SELECT DISTINCT veh_id FROM vehicle_sim_db.VehicleEventDebugging";
                try (PreparedStatement pstmt = conn.prepareStatement(idQuery)) {
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            limitedIds.add(rs.getString("veh_id"));
                        }
                    }
                }

                if (limitedIds.isEmpty()) return vehicleEventList;

                String inClause = String.join(",", Collections.nCopies(limitedIds.size(), "?"));
                String dataQuery = """
                SELECT veh_id, type, timestep, link_id, lane_id, pos_x, pos_y, spd, acc, spacing, mode, leader_id, target_lane_id
                FROM vehicle_sim_db.VehicleEventDebugging
                WHERE veh_id IN (""" + inClause + ")";
                try (PreparedStatement pstmt = conn.prepareStatement(dataQuery)) {
                    for (int i = 0; i < limitedIds.size(); i++) {
                        pstmt.setString(i + 1, limitedIds.get(i));
                    }

                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            VehicleEvent v = new VehicleEvent();
                            v.setId(rs.getString("veh_id"));
                            v.setType(rs.getString("type"));
                            v.setTimestep(rs.getDouble("timestep"));
                            v.setLinkId(rs.getString("link_id"));
                            v.setLaneId(rs.getString("lane_id"));
                            v.setPosX(rs.getFloat("pos_x"));
                            v.setPosY(rs.getFloat("pos_y"));
                            v.setSpeed(rs.getFloat("spd"));
                            v.setAcc(rs.getFloat("acc"));
                            v.setSpacing(rs.getString("spacing"));
                            v.setDriveMode(rs.getString("mode"));
                            v.setLeaderId(rs.getString("leader_id"));
                            v.setTargetlaneId(rs.getString("target_lane_id"));
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

    // 링크별 교통량 통계 집계 (SQLite GROUP BY 활용 - 전체 이벤트 로드 없이 효율적으로 처리)
    public LinkStatsResponse readLinkStats(String versionId, int interval, int topN) {
        try {
            File tempDbFile = prepareDbFile(versionId);

            String memoryUrl = "jdbc:sqlite::memory:";
            try (Connection conn = DriverManager.getConnection(memoryUrl);
                 Statement stmt = conn.createStatement()) {

                String attachSQL = "ATTACH DATABASE '" + tempDbFile.getAbsolutePath() + "' AS vehicle_sim_db";
                stmt.execute(attachSQL);

                // 1. 전체 시간대별 통계 (overall time series)
                List<LinkStatsResponse.TimeSlotStats> overallTimeSeries = new ArrayList<>();
                String overallQuery = """
                    SELECT
                        CAST(timestep / ? AS INTEGER) * ? AS time_bucket,
                        COUNT(DISTINCT veh_id) AS volume,
                        ROUND(AVG(spd) * 3.6, 2) AS avg_speed
                    FROM vehicle_sim_db.VehicleEventDebugging
                    GROUP BY 1
                    ORDER BY 1
                    """;
                try (PreparedStatement pstmt = conn.prepareStatement(overallQuery)) {
                    pstmt.setInt(1, interval);
                    pstmt.setInt(2, interval);
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            overallTimeSeries.add(new LinkStatsResponse.TimeSlotStats(
                                    rs.getInt("time_bucket"),
                                    rs.getInt("volume"),
                                    rs.getDouble("avg_speed")
                            ));
                        }
                    }
                }

                // 2. 교통량 상위 N개 링크 조회
                List<String> topLinkIds = new ArrayList<>();
                Map<String, Integer> linkVolumes = new LinkedHashMap<>();
                String topLinksQuery = """
                    SELECT link_id, COUNT(DISTINCT veh_id) AS total_volume
                    FROM vehicle_sim_db.VehicleEventDebugging
                    WHERE link_id IS NOT NULL
                    GROUP BY link_id
                    ORDER BY total_volume DESC
                    LIMIT ?
                    """;
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

                // 3. 상위 링크별 평균 속도
                String inClause = String.join(",", Collections.nCopies(topLinkIds.size(), "?"));
                Map<String, Double> linkSpeeds = new LinkedHashMap<>();
                String linkSpeedQuery = "SELECT link_id, ROUND(AVG(spd) * 3.6, 2) AS avg_speed " +
                        "FROM vehicle_sim_db.VehicleEventDebugging WHERE link_id IN (" + inClause + ") GROUP BY link_id";
                try (PreparedStatement pstmt = conn.prepareStatement(linkSpeedQuery)) {
                    for (int i = 0; i < topLinkIds.size(); i++) pstmt.setString(i + 1, topLinkIds.get(i));
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            linkSpeeds.put(rs.getString("link_id"), rs.getDouble("avg_speed"));
                        }
                    }
                }

                // 4. 상위 링크별 시계열 통계
                Map<String, List<LinkStatsResponse.TimeSlotStats>> linkTimeSeries = new LinkedHashMap<>();
                String linkTimeSeriesQuery = "SELECT link_id, " +
                        "CAST(timestep / ? AS INTEGER) * ? AS time_bucket, " +
                        "COUNT(DISTINCT veh_id) AS volume, " +
                        "ROUND(AVG(spd) * 3.6, 2) AS avg_speed " +
                        "FROM vehicle_sim_db.VehicleEventDebugging " +
                        "WHERE link_id IN (" + inClause + ") " +
                        "GROUP BY 1, 2 " +
                        "ORDER BY 1, 2";
                try (PreparedStatement pstmt = conn.prepareStatement(linkTimeSeriesQuery)) {
                    pstmt.setInt(1, interval);
                    pstmt.setInt(2, interval);
                    for (int i = 0; i < topLinkIds.size(); i++) pstmt.setString(i + 3, topLinkIds.get(i));
                    try (ResultSet rs = pstmt.executeQuery()) {
                        while (rs.next()) {
                            String linkId = rs.getString("link_id");
                            linkTimeSeries.computeIfAbsent(linkId, k -> new ArrayList<>())
                                    .add(new LinkStatsResponse.TimeSlotStats(
                                            rs.getInt("time_bucket"),
                                            rs.getInt("volume"),
                                            rs.getDouble("avg_speed")
                                    ));
                        }
                    }
                }

                // 5. 결과 조립
                List<LinkStatsResponse.LinkSummary> topLinks = topLinkIds.stream()
                        .map(linkId -> new LinkStatsResponse.LinkSummary(
                                linkId,
                                linkVolumes.getOrDefault(linkId, 0),
                                linkSpeeds.getOrDefault(linkId, 0.0),
                                linkTimeSeries.getOrDefault(linkId, Collections.emptyList())
                        ))
                        .collect(Collectors.toList());

                return new LinkStatsResponse(interval, overallTimeSeries, topLinks);
            }
        } catch (SQLException | IOException e) {
            logger.error("Error while reading link stats for versionId: {}", versionId, e);
            return new LinkStatsResponse(interval, Collections.emptyList(), Collections.emptyList());
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
