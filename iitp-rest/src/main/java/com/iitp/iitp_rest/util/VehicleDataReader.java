package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.VehicleInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.net.URL;
import java.sql.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;


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
