package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.VehicleState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.*;
import java.sql.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Component
public class VehicleDataReader {

    private static final Logger logger = LoggerFactory.getLogger(VehicleDataReader.class);

    @Value("${database.vehicle_sim.dbPath}")
    private String dbPath;

    public List<VehicleState> readLimited(int numVehicles) {
        List<VehicleState> vehicleList = new ArrayList<>();

        ClassPathResource resource = new ClassPathResource(dbPath);

        try (InputStream inputStream = resource.getInputStream()) {
            String url = "jdbc:sqlite::memory:";

            try (Connection conn = DriverManager.getConnection(url)) {
                try (Statement stmt = conn.createStatement()) {
                    String attachSQL = "ATTACH DATABASE '" + resource.getFile().getAbsolutePath() + "' AS vehicle_sim_db";
                    stmt.execute(attachSQL);

                    List<String> limitedIds = new ArrayList<>();
                    String idQuery = "SELECT DISTINCT id FROM vehicle_sim_db.vehicle_sim LIMIT ?";
                    try (PreparedStatement pstmt = conn.prepareStatement(idQuery)) {
                        pstmt.setInt(1, numVehicles);
                        try (ResultSet rs = pstmt.executeQuery()) {
                            while (rs.next()) {
                                limitedIds.add(rs.getString("id"));
                            }
                        }
                    }

                    if (limitedIds.isEmpty()) return vehicleList;

                    String inClause = String.join(",", Collections.nCopies(limitedIds.size(), "?"));
                    String dataQuery = "SELECT id, timestep, link_id, lane_id, pos_x, pos_y FROM vehicle_sim_db.vehicle_sim WHERE id IN (" + inClause + ")";
                    try (PreparedStatement pstmt = conn.prepareStatement(dataQuery)) {
                        for (int i = 0; i < limitedIds.size(); i++) {
                            pstmt.setString(i + 1, limitedIds.get(i));
                        }

                        try (ResultSet rs = pstmt.executeQuery()) {
                            while (rs.next()) {
                                VehicleState v = new VehicleState();
                                v.setId(rs.getString("id"));
                                v.setTimestep(rs.getFloat("timestep"));
                                v.setLinkId(rs.getString("link_id"));
                                v.setLaneId(rs.getString("lane_id"));
                                v.setPosX(rs.getFloat("pos_x"));
                                v.setPosY(rs.getFloat("pos_y"));
                                vehicleList.add(v);
                            }
                        }
                    }

                }
            }
        } catch (SQLException | IOException e) {
            logger.error("Error while reading limited vehicle data", e);
        }

        return vehicleList;
    }

}
