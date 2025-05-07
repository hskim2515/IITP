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
import java.util.List;

@Component
public class VehicleDataReader {

    private static final Logger logger = LoggerFactory.getLogger(VehicleDataReader.class);

    @Value("${database.vehicle_sim.dbPath}")
    private String dbPath;

    public List<VehicleState> readAll() {
        List<VehicleState> vehicleList = new ArrayList<>();

        ClassPathResource resource = new ClassPathResource(dbPath);

        try (InputStream inputStream = resource.getInputStream()) {
            String url = "jdbc:sqlite::memory:";

            // 메모리 내에서 DB를 사용하기 위한 Connection 생성
            try (Connection conn = DriverManager.getConnection(url)) {
                // 파일 내용을 메모리로 복사
                try (Statement stmt = conn.createStatement()) {
                    // DB 파일을 메모리 DB로 임포트
                    String createTableSQL = "ATTACH DATABASE '" + resource.getFile().getAbsolutePath() + "' AS vehicle_sim_db";
                    stmt.execute(createTableSQL);

                    String sql = "SELECT id, timestep, link_id, lane_id, pos_x, pos_y FROM vehicle_sim_db.vehicle_sim";
                    try (PreparedStatement pstmt = conn.prepareStatement(sql);
                         ResultSet rs = pstmt.executeQuery()) {

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

                    } catch (SQLException e) {
                        logger.error("Error while executing query", e);
                    }
                }
            } catch (SQLException e) {
                logger.error("Error while connecting to in-memory database", e);
            }

        } catch (IOException e) {
            logger.error("Error while reading the database file", e);
        }

        return vehicleList;
    }
}
