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
 * 네트워크 XML(노드·링크·커넥션)과 신호 데이터로 더미 차량 궤적을 생성하고
 * SQLite 파일(vehicle_sim.db 스키마)로 직렬화한다.
 */
@Component
public class DummyVehicleGenerator {

    private static final Logger log = LoggerFactory.getLogger(DummyVehicleGenerator.class);

    private static final double TIMESTEP      = 1.0;   // 이벤트 간격 (초)
    private static final double DEFAULT_SPEED = 13.9;  // 기본 속도 m/s (≈50km/h)
    private static final int    MAX_HOPS      = 500;   // 한 차량 최대 링크 이동 횟수
    private static final int    MAX_WAIT_SEC  = 300;   // 신호 대기 최대 시간 (초)
    private static final int    QUEUE_SLOTS   = 8;     // 정지 대기열 분산 슬롯 수
    private static final double QUEUE_GAP     = 6.0;   // 대기열 슬롯 간 간격 (m)

    // ── 신호 데이터 구조 ──────────────────────────────────────────────────

    public static class PhaseInfo {
        public final int duration;
        public final Set<String> activeTurns; // 이 phase에서 green인 turnId 집합
        public PhaseInfo(int duration, Set<String> activeTurns) {
            this.duration = duration;
            this.activeTurns = activeTurns;
        }
    }

    public static class NodeSignalInfo {
        public final int cycle;
        public final int offset;
        public final List<PhaseInfo> phases;
        public NodeSignalInfo(int cycle, int offset, List<PhaseInfo> phases) {
            this.cycle = cycle;
            this.offset = offset;
            this.phases = phases;
        }
    }

    /** 신호 + 네트워크 연결 정보를 묶는 컨텍스트 */
    public static class SignalContext {
        /** nodeId → 신호 정보 */
        public final Map<String, NodeSignalInfo> nodeSignals;
        /** linkId → toNodeId */
        public final Map<String, String> linkToNode;
        /**
         * "nodeId_fromLinkId_toLinkId" → turnId
         * RTOR(우회전 상시허용) 전환은 빈 문자열("") → 항상 통과
         */
        public final Map<String, String> connKeyToTurn;

        public SignalContext(Map<String, NodeSignalInfo> nodeSignals,
                            Map<String, String> linkToNode,
                            Map<String, String> connKeyToTurn) {
            this.nodeSignals    = nodeSignals;
            this.linkToNode     = linkToNode;
            this.connKeyToTurn  = connKeyToTurn;
        }

        public static SignalContext empty() {
            return new SignalContext(Collections.emptyMap(), Collections.emptyMap(), Collections.emptyMap());
        }
    }

    // ── 이벤트 생성 ────────────────────────────────────────────────────

    public List<VehicleEvent> generate(
            NetworkXml network,
            Map<String, RoadResponse.Road> roadMap,
            int numVehicles,
            int durationSeconds,
            long seed,
            SignalContext signalCtx) {
        List<VehicleEvent> events = new ArrayList<>(numVehicles * (durationSeconds / 2));
        generateCore(network, roadMap, numVehicles, durationSeconds, seed, signalCtx, events::add, null);
        log.info("[DummyVehicleGenerator] 더미 이벤트 {}건 생성 (차량 {}대, {}초)",
                events.size(), numVehicles, durationSeconds);
        return events;
    }

    /**
     * 이벤트를 sink 로 흘려보내는 코어 — 대량(수십만 대) 생성 시 List 누적 없이
     * SQLite 등으로 직접 스트리밍하기 위한 진입점.
     * @param progress 차량 단위 진행 콜백 (nullable) — 완료 차량 수 전달
     * @return 방출한 이벤트 수
     */
    public long generateCore(
            NetworkXml network,
            Map<String, RoadResponse.Road> roadMap,
            int numVehicles,
            int durationSeconds,
            long seed,
            SignalContext signalCtx,
            java.util.function.Consumer<VehicleEvent> sink,
            java.util.function.IntConsumer progress) {

        if (network == null || network.getLinks() == null || network.getLinks().isEmpty()) {
            log.warn("[DummyVehicleGenerator] 네트워크 데이터가 없어 더미 생성을 건너뜁니다.");
            return 0;
        }

        Map<String, Double>  linkLength  = new HashMap<>();
        Map<String, Double>  linkSpeed   = new HashMap<>();
        Map<String, Double>  linkStop    = new HashMap<>(); // 정지선 위치 (링크 끝에서 m)
        Map<String, Integer> linkNumLane = new HashMap<>();
        Map<String, Double>  linkWidth   = new HashMap<>();

        for (LinkXml link : network.getLinks()) {
            String id = String.valueOf(link.getId());
            if (!roadMap.containsKey(id)) continue;
            double len = link.getLength() > 0 ? link.getLength() : estimateLength(roadMap.get(id));
            double spd = link.getFfSpd() > 0.5 ? link.getFfSpd() : DEFAULT_SPEED;
            double stop = link.getStopLine() > 0 ? link.getStopLine() : 2.0;
            int numLane = link.getNumLane() > 0 ? link.getNumLane() : 1;
            double width = link.getWidth() > 0 ? link.getWidth() : numLane * 3.5;
            linkLength.put(id, len);
            linkSpeed.put(id, spd);
            linkStop.put(id, stop);
            linkNumLane.put(id, numLane);
            linkWidth.put(id, width);
        }

        List<String> validLinks = new ArrayList<>(linkLength.keySet());
        if (validLinks.isEmpty()) {
            log.warn("[DummyVehicleGenerator] roadMap과 일치하는 링크가 없습니다.");
            return 0;
        }

        Map<String, List<String>> routing = buildRouting(network, linkLength.keySet());

        boolean hasSignal = !signalCtx.nodeSignals.isEmpty();
        log.info("[DummyVehicleGenerator] 신호 연동: {}, 신호 노드 수: {}",
                hasSignal, signalCtx.nodeSignals.size());

        Random rng = new Random(seed);
        long emitted = 0;
        long[] emittedRef = { 0 };
        java.util.function.Consumer<VehicleEvent> countingSink = e -> { emittedRef[0]++; sink.accept(e); };

        for (int vi = 0; vi < numVehicles; vi++) {
            String vehicleId = String.valueOf(1000 + vi);
            double startTime = rng.nextDouble() * durationSeconds * 0.6;
            String linkId    = validLinks.get(rng.nextInt(validLinks.size()));
            double posX      = rng.nextDouble() * linkLength.get(linkId);
            double t         = startTime;
            int hops         = 0;
            int laneIdx      = rng.nextInt(linkNumLane.getOrDefault(linkId, 1));
            // 차량별 대기열 슬롯: 같은 정지선에서 여러 대가 겹치지 않고 한 줄로 늘어서도록 분산
            int queueSlot    = vi % QUEUE_SLOTS;

            while (t < durationSeconds && hops < MAX_HOPS) {
                double len  = linkLength.get(linkId);
                double spd  = linkSpeed.get(linkId);
                double stop = linkStop.getOrDefault(linkId, 2.0);
                double posY = laneOffset(linkId, laneIdx, linkNumLane, linkWidth);

                // 정지선 위치: 링크 끝에서 stop미터 앞
                double stopPosX = Math.max(len - stop, len * 0.9);
                // 대기열 위치: 정지선에서 차량별 슬롯만큼 뒤로 분산 (이미 지나친 경우 역행 방지)
                double queuePosX = Math.max(posX, Math.max(0.0, stopPosX - queueSlot * QUEUE_GAP));

                // ── 링크 주행 ──────────────────────────────────────────
                while (posX < queuePosX && t < durationSeconds) {
                    addEvent(countingSink, vehicleId, t, linkId, laneIdx, posX, posY, spd);
                    posX += spd * TIMESTEP;
                    t    += TIMESTEP;
                }

                if (t >= durationSeconds) break;

                // ── 다음 링크 선택 ────────────────────────────────────
                List<String> nexts = routing.getOrDefault(linkId, Collections.emptyList());
                if (nexts.isEmpty()) break;

                String nextLink = nexts.get(rng.nextInt(nexts.size()));
                if (!linkLength.containsKey(nextLink)) break;

                // ── 신호 체크 ─────────────────────────────────────────
                if (hasSignal) {
                    double greenAt = waitForGreen(linkId, nextLink, t, signalCtx);
                    if (greenAt > t) {
                        // 대기열 위치에서 대기 (최대 MAX_WAIT_SEC 초)
                        double waitEnd = Math.min(greenAt, t + MAX_WAIT_SEC);
                        waitEnd = Math.min(waitEnd, durationSeconds);
                        while (t < waitEnd) {
                            addEvent(countingSink, vehicleId, t, linkId, laneIdx, queuePosX, posY, 0.0);
                            t += TIMESTEP;
                        }
                        if (t >= durationSeconds) break;
                        // 아직 빨간불이면 포기하고 종료
                        if (!isSignalGreen(linkId, nextLink, t, signalCtx)) break;
                    }
                }

                // 정지선→링크 끝 구간 이동 (신호 통과 후 교차로 진입)
                while (posX < len && t < durationSeconds) {
                    addEvent(countingSink, vehicleId, t, linkId, laneIdx, posX, posY, spd);
                    posX += spd * TIMESTEP;
                    t    += TIMESTEP;
                }

                linkId = nextLink;
                posX   = 0;
                // 다음 링크의 차선 수에 맞춰 차선 재배정 → 차선별로 분산되어 표시
                laneIdx = rng.nextInt(linkNumLane.getOrDefault(linkId, 1));
                hops++;
            }

            if (progress != null && (vi + 1) % 10_000 == 0) progress.accept(vi + 1);
        }

        emitted = emittedRef[0];
        return emitted;
    }

    /** 스트리밍 생성 결과 (SQLite 파일 + 통계) */
    public record StreamGenResult(File dbFile, long eventCount, int vehicleCount) {}

    /**
     * 대량 더미 생성 — 이벤트를 메모리에 누적하지 않고 SQLite 로 직접 스트리밍.
     * (in-memory generate 는 수십만 대에서 이벤트 수천만 건 → heap OOM. 이 경로는 차량 1대분만 메모리 상주)
     * 반환된 파일은 호출측이 업로드 후 삭제 책임.
     */
    public StreamGenResult generateToSqlite(
            NetworkXml network,
            Map<String, RoadResponse.Road> roadMap,
            int numVehicles,
            int durationSeconds,
            long seed,
            SignalContext signalCtx,
            java.util.function.IntConsumer progress) throws IOException {

        File tmp = File.createTempFile("dummy_vehicle_sim_", ".db");
        tmp.deleteOnExit();

        String url = "jdbc:sqlite:" + tmp.getAbsolutePath();
        long total;
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
                final int BATCH_SIZE = 50_000;
                int[] pending = { 0 };
                java.util.function.Consumer<VehicleEvent> sqliteSink = e -> {
                    try {
                        ps.setString(1, e.getId());
                        ps.setDouble(2, e.getTimestep());
                        ps.setString(3, e.getLinkId());
                        ps.setString(4, e.getLaneId());
                        ps.setFloat(5, e.getPosX());
                        ps.setFloat(6, e.getPosY());
                        ps.addBatch();
                        if (++pending[0] >= BATCH_SIZE) {
                            ps.executeBatch();
                            ps.clearBatch();
                            pending[0] = 0;
                        }
                    } catch (SQLException ex) {
                        throw new RuntimeException(ex);
                    }
                };
                total = generateCore(network, roadMap, numVehicles, durationSeconds, seed, signalCtx, sqliteSink, progress);
                if (pending[0] > 0) ps.executeBatch();
            }
            conn.commit();
        } catch (SQLException | RuntimeException ex) {
            tmp.delete();
            throw new IOException("스트리밍 더미 SQLite 생성 실패", ex);
        }
        log.info("[DummyVehicleGenerator] 스트리밍 생성 완료: 차량 {}대, 이벤트 {}건 → {} ({}MB)",
                numVehicles, total, tmp.getAbsolutePath(), tmp.length() / 1_000_000);
        return new StreamGenResult(tmp, total, numVehicles);
    }

    /** 하위 호환: signal 없이 호출 */
    public List<VehicleEvent> generate(
            NetworkXml network,
            Map<String, RoadResponse.Road> roadMap,
            int numVehicles,
            int durationSeconds,
            long seed) {
        return generate(network, roadMap, numVehicles, durationSeconds, seed, SignalContext.empty());
    }

    // ── SQLite 파일 생성 ───────────────────────────────────────────────

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

                // addBatch 전량 누적은 이벤트 수천만 건에서 heap 2배 소모 → OOM. 5만 건 단위로 flush.
                final int BATCH_SIZE = 50_000;
                int pending = 0;
                for (VehicleEvent e : events) {
                    ps.setString(1, e.getId());
                    ps.setDouble(2, e.getTimestep());
                    ps.setString(3, e.getLinkId());
                    ps.setString(4, e.getLaneId());
                    ps.setFloat(5,  e.getPosX());
                    ps.setFloat(6,  e.getPosY());
                    ps.addBatch();
                    if (++pending >= BATCH_SIZE) {
                        ps.executeBatch();
                        ps.clearBatch();
                        pending = 0;
                    }
                }
                if (pending > 0) ps.executeBatch();
            }
            conn.commit();
        } catch (SQLException ex) {
            throw new IOException("더미 SQLite 파일 생성 실패", ex);
        }

        log.info("[DummyVehicleGenerator] SQLite 파일 생성 완료: {} ({} rows)", tmp.getAbsolutePath(), events.size());

        return new FileInputStream(tmp) {
            @Override
            public void close() throws IOException {
                super.close();
                tmp.delete();
            }
        };
    }

    // ── 신호 체크 ─────────────────────────────────────────────────────────

    /**
     * 시뮬레이션 시간 t에서 fromLink→toLink 전환이 녹색인지 반환한다.
     * 신호 데이터가 없거나 RTOR 전환이면 항상 true.
     */
    private boolean isSignalGreen(String fromLink, String toLink, double t, SignalContext ctx) {
        String nodeId = ctx.linkToNode.get(fromLink);
        if (nodeId == null) return true;

        NodeSignalInfo signal = ctx.nodeSignals.get(nodeId);
        if (signal == null) return true;

        String connKey = nodeId + "_" + fromLink + "_" + toLink;
        String turnId  = ctx.connKeyToTurn.get(connKey);
        if (turnId == null || turnId.isEmpty()) return true; // 미등록 또는 RTOR

        return isPhaseGreen(signal, turnId, t);
    }

    /**
     * 신호가 빨간 경우, 녹색이 될 시뮬레이션 시간(초)을 반환한다.
     * 이미 녹색이면 t를 그대로 반환.
     */
    private double waitForGreen(String fromLink, String toLink, double t, SignalContext ctx) {
        if (isSignalGreen(fromLink, toLink, t, ctx)) return t;

        String nodeId  = ctx.linkToNode.get(fromLink);
        NodeSignalInfo signal = ctx.nodeSignals.get(nodeId);
        String connKey = nodeId + "_" + fromLink + "_" + toLink;
        String turnId  = ctx.connKeyToTurn.get(connKey);

        if (signal == null || turnId == null || turnId.isEmpty()) return t;

        int cyclePos = ((int) t - signal.offset) % signal.cycle;
        if (cyclePos < 0) cyclePos += signal.cycle;

        // 현재 사이클에서 녹색 시작 탐색
        int acc = 0;
        for (PhaseInfo phase : signal.phases) {
            if (acc > cyclePos && phase.activeTurns.contains(turnId)) {
                return t + (acc - cyclePos);
            }
            acc += phase.duration;
        }

        // 다음 사이클 첫 번째 녹색 탐색
        int remaining = signal.cycle - cyclePos;
        acc = 0;
        for (PhaseInfo phase : signal.phases) {
            if (phase.activeTurns.contains(turnId)) {
                return t + remaining + acc;
            }
            acc += phase.duration;
        }

        return t + signal.cycle; // 해당 turn이 전혀 없으면 1사이클 대기
    }

    private boolean isPhaseGreen(NodeSignalInfo signal, String turnId, double t) {
        int cyclePos = ((int) t - signal.offset) % signal.cycle;
        if (cyclePos < 0) cyclePos += signal.cycle;
        int acc = 0;
        for (PhaseInfo phase : signal.phases) {
            if (cyclePos < acc + phase.duration) {
                return phase.activeTurns.contains(turnId);
            }
            acc += phase.duration;
        }
        return false;
    }

    // ── 내부 유틸 ────────────────────────────────────────────────────────

    private void addEvent(java.util.function.Consumer<VehicleEvent> sink, String vehicleId, double t,
                          String linkId, int laneIdx, double posX, double posY, double spd) {
        VehicleEvent e = new VehicleEvent();
        e.setId(vehicleId);
        e.setTimestep(Math.round(t * 10.0) / 10.0);
        e.setLinkId(linkId);
        e.setLaneId(String.valueOf(laneIdx));
        e.setPosX((float) posX);
        e.setPosY((float) posY);
        e.setSpeed((float) spd);
        sink.accept(e);
    }

    /** linkId의 laneIdx번째 차선 중심까지의 횡방향 오프셋(posY, 좌측 엣지 기준)을 반환한다. */
    private double laneOffset(String linkId, int laneIdx, Map<String, Integer> linkNumLane, Map<String, Double> linkWidth) {
        int numLane = linkNumLane.getOrDefault(linkId, 1);
        double width = linkWidth.getOrDefault(linkId, numLane * 3.5);
        int idx = Math.min(Math.max(laneIdx, 0), numLane - 1);
        double laneWidth = width / numLane;
        return (idx + 0.5) * laneWidth;
    }

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
