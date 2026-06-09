package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.road.RoadResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.sql.*;
import java.util.*;

/**
 * 네트워크 XML(노드·링크·커넥션)만으로 더미 차량 궤적을 생성하고
 * SQLite 파일(vehicle_sim.db_bak 스키마)로 직렬화한다.
 */
@Component
public class DummyVehicleGenerator {

    private static final Logger log = LoggerFactory.getLogger(DummyVehicleGenerator.class);

    private static final double TIMESTEP      = 1.0;   // 이벤트 간격 (초)
    private static final double DEFAULT_SPEED = 13.9;  // 기본 속도 m/s (≈50km/h)
    private static final double POS_Y         = 2.0;   // 차선 중앙 오프셋 (m)
    private static final int    MAX_HOPS      = 500;   // 한 차량 최대 링크 이동 횟수

    // ── 이벤트 생성 ────────────────────────────────────────────────────

    public List<VehicleEvent> generate(
            NetworkXml network,
            Map<String, RoadResponse.Road> roadMap,
            int numVehicles,
            int durationSeconds,
            long seed) {

        if (network == null || network.getLinks() == null || network.getLinks().isEmpty()) {
            log.warn("[DummyVehicleGenerator] 네트워크 데이터가 없어 더미 생성을 건너뜁니다.");
            return Collections.emptyList();
        }

        Map<String, Double> linkLength = new HashMap<>();
        Map<String, Double> linkSpeed  = new HashMap<>();

        for (LinkXml link : network.getLinks()) {
            String id = String.valueOf(link.getId());
            if (!roadMap.containsKey(id)) continue;
            double len = link.getLength() > 0 ? link.getLength() : estimateLength(roadMap.get(id));
            double spd = link.getFfSpd() > 0.5 ? link.getFfSpd() : DEFAULT_SPEED;
            linkLength.put(id, len);
            linkSpeed.put(id, spd);
        }

        List<String> validLinks = new ArrayList<>(linkLength.keySet());
        if (validLinks.isEmpty()) {
            log.warn("[DummyVehicleGenerator] roadMap과 일치하는 링크가 없습니다.");
            return Collections.emptyList();
        }

        Map<String, List<String>> routing = buildRouting(network, linkLength.keySet());

        Random rng = new Random(seed);
        List<VehicleEvent> events = new ArrayList<>(numVehicles * (durationSeconds / 2));

        for (int vi = 0; vi < numVehicles; vi++) {
            String vehicleId = String.valueOf(1000 + vi);
            double startTime = rng.nextDouble() * durationSeconds * 0.6;
            String linkId    = validLinks.get(rng.nextInt(validLinks.size()));
            double posX      = rng.nextDouble() * linkLength.get(linkId);
            double t         = startTime;
            int hops         = 0;

            while (t < durationSeconds && hops < MAX_HOPS) {
                double len = linkLength.get(linkId);
                double spd = linkSpeed.get(linkId);

                while (posX < len && t < durationSeconds) {
                    VehicleEvent e = new VehicleEvent();
                    e.setId(vehicleId);
                    e.setTimestep(Math.round(t * 10.0) / 10.0);
                    e.setLinkId(linkId);
                    e.setLaneId("0");
                    e.setPosX((float) posX);
                    e.setPosY((float) POS_Y);
                    e.setSpeed((float) spd);
                    events.add(e);

                    posX += spd * TIMESTEP;
                    t    += TIMESTEP;
                }

                if (t >= durationSeconds) break;

                List<String> nexts = routing.getOrDefault(linkId, Collections.emptyList());
                linkId = nexts.isEmpty()
                        ? validLinks.get(rng.nextInt(validLinks.size()))
                        : nexts.get(rng.nextInt(nexts.size()));
                posX = 0;
                hops++;
            }
        }

        log.info("[DummyVehicleGenerator] 더미 이벤트 {}건 생성 (차량 {}대, {}초)",
                events.size(), numVehicles, durationSeconds);
        return events;
    }

    // ── SQLite 파일 생성 ───────────────────────────────────────────────

    /**
     * 더미 이벤트를 SQLite 파일에 기록하고 InputStream을 반환한다.
     * VehicleDataReader가 읽는 VehicleEvent 테이블 스키마와 동일하게 생성.
     * 호출자가 InputStream을 닫으면 임시 파일도 삭제된다.
     */
    public InputStream writeToSqlite(List<VehicleEvent> events) throws IOException {
        File tmp = File.createTempFile("dummy_vehicle_sim_", ".db");
        tmp.deleteOnExit();

        String url = "jdbc:sqlite:" + tmp.getAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {

            stmt.execute("""
                    CREATE TABLE VehicleEvent (
                        veh_id   TEXT,
                        timestep REAL,
                        link_id  TEXT,
                        lane_id  TEXT,
                        pos_x    REAL,
                        pos_y    REAL
                    )
                    """);

            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO VehicleEvent(veh_id,timestep,link_id,lane_id,pos_x,pos_y) VALUES(?,?,?,?,?,?)")) {

                for (VehicleEvent e : events) {
                    ps.setString(1, e.getId());
                    ps.setDouble(2, e.getTimestep());
                    ps.setString(3, e.getLinkId());
                    ps.setString(4, e.getLaneId());
                    ps.setFloat(5,  e.getPosX());
                    ps.setFloat(6,  e.getPosY());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
        } catch (SQLException ex) {
            throw new IOException("더미 SQLite 파일 생성 실패", ex);
        }

        log.info("[DummyVehicleGenerator] SQLite 파일 생성 완료: {} ({} rows)", tmp.getAbsolutePath(), events.size());

        // 읽기 완료 후 임시 파일 삭제
        return new FileInputStream(tmp) {
            @Override
            public void close() throws IOException {
                super.close();
                tmp.delete();
            }
        };
    }

    // ── 내부 유틸 ────────────────────────────────────────────────────────

    private Map<String, List<String>> buildRouting(NetworkXml network, Set<String> validLinkIds) {
        Map<String, List<String>> routing = new HashMap<>();
        if (network.getNodes() == null) return routing;

        for (NodeXml node : network.getNodes()) {
            if (node.getConnections() == null) continue;
            for (ConnectionXml conn : node.getConnections()) {
                if (conn.getFromLink() == null || conn.getToLink() == null) continue;
                String from = String.valueOf(conn.getFromLink());
                String to   = String.valueOf(conn.getToLink());
                if (!validLinkIds.contains(from) || !validLinkIds.contains(to)) continue;
                routing.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
            }
        }
        return routing;
    }

    private double estimateLength(RoadResponse.Road road) {
        if (road.getBaseEasting() == null || road.getTargetEasting() == null) return 100.0;
        double dx = road.getTargetEasting() - road.getBaseEasting();
        double dy = road.getTargetNorthing() - road.getBaseNorthing();
        double len = Math.sqrt(dx * dx + dy * dy);
        return len > 1.0 ? len : 100.0;
    }
}
