package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.service.network.NetworkGeometryIndexService;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import org.junit.jupiter.api.Test;

import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * geometry 투영 로직({@link VehicleController#insertGeometryProjectedWaypoints})을 실제
 * scenario3_1_V2 로컬 시뮬레이션 데이터로 검증한다. 이 세션에서 "커넥션 지나 다음 레인 진입 시
 * 정지 후 옆으로 슬라이드" 증상을 실측 재현했던 차량(6140/962/6292)에 대해 확인한다.
 *
 * <p>⚠️ 이 로직이 고치는 건 "경로 모양"이지 "속도"가 아니다 — prev/cur 두 실측 샘플의 timestep은
 * 그대로 보존해야 하므로(availability gap 판정에 영향 주지 않기 위해, 기존 dropStalePositionArtifacts
 * 의 교훈과 동일), 그 사이에 웨이포인트를 아무리 촘촘히 넣어도 총 이동거리/총 경과시간(=평균
 * implied speed)은 바뀌지 않는다 — NextSim이 애초에 그 두 샘플 사이에 충분한 시간 해상도를
 * 안 줬다면 그건 이 로직으로 고칠 수 없는 데이터 한계다. 대신 여기서 실제로 검증할 수 있고 검증해야
 *하는 것은 "큰 단일 홉 점프가 실제 도로/커넥션 곡선을 따라가는 여러 개의 작은 홉으로 쪼개지는가"
 * (직선으로 코너를 가로지르던 것이 곡선을 따라가게 되는가) — 이것이 사용자가 보고한 "옆으로
 * 슬라이드" 증상의 시각적 원인이었다.
 *
 * <p>로컬 개발자 머신에만 있는 시뮬레이션 산출물(network.xml/vehicle_sim.db)에 의존하므로 파일이
 * 없으면 스킵한다 — CI 대상이 아니라 이 geometry 투영 기능을 켜기 전 수동 검증용.
 */
class VehicleControllerGeometryProjectionTest {

    private static final String NETWORK_XML_PATH = "/Users/hskim/.iitp-local/models/scenario3_1_V2/network.xml";
    private static final String VEHICLE_DB_PATH = "/Users/hskim/.iitp-local/models/scenario3_1_V2/vehicle_sim.db";
    // "큰 단일 홉"으로 볼 거리 기준 — 8~15m/s대 저속 주행에서도 1~2초면 넘는 수준으로 낮게 잡아,
    // 애매한 정상 주행 스텝은 걸러내고 명백히 코너를 가로지르는 큰 점프만 센다.
    private static final double LARGE_SINGLE_HOP_DIST_M = 15.0;

    @Test
    void geometryProjectionChopsLargeSingleHopsIntoCurveFollowingSteps() throws Exception {
        assumeTrue(Files.exists(Path.of(NETWORK_XML_PATH)), "로컬 network.xml 없음 — 스킵");
        assumeTrue(Files.exists(Path.of(VEHICLE_DB_PATH)), "로컬 vehicle_sim.db 없음 — 스킵");

        NetworkJaxbParser parser = new NetworkJaxbParser();
        NetworkXml network;
        try (FileInputStream is = new FileInputStream(NETWORK_XML_PATH)) {
            network = parser.parse(is);
        }
        NetworkGeometryIndexService.GeometryIndex geomIndex =
                NetworkGeometryIndexService.GeometryIndex.forTesting(network);

        int[] vehicleIds = {6140, 962, 6292};
        boolean anyVehicleChecked = false;
        boolean anyFlaggedTransitionSeen = false;

        for (int vehId : vehicleIds) {
            List<VehicleEvent> raw = readEvents(vehId);
            if (raw.isEmpty()) {
                System.out.printf("veh %d: 이벤트 없음(시뮬레이션이 재생성됐을 수 있음) — 건너뜀%n", vehId);
                continue;
            }
            anyVehicleChecked = true;

            // ⚠️ dropStalePositionArtifacts/filterQueueJitter는 VehicleEvent를 in-place로 mutate한다
            // (setPosX/setPosY) — new ArrayList<>(raw) 같은 얕은 복사는 리스트 구조만 복사할 뿐 같은
            // VehicleEvent 참조를 공유하므로, "before"/"after" 두 그룹을 독립적으로 비교하려면 이벤트
            // 자체를 깊은 복사해야 한다.
            List<VehicleEvent> beforeGeom = VehicleController.dropStalePositionArtifacts(deepCopy(raw));
            VehicleController.filterQueueJitter(beforeGeom);
            int beforeLargeHops = countLargeSingleHops(beforeGeom);
            double beforeMaxHop = maxSingleHopDist(beforeGeom);

            List<VehicleEvent> afterGeom = VehicleController.dropStalePositionArtifacts(deepCopy(raw));
            VehicleController.filterQueueJitter(afterGeom);
            AtomicLong flagged = new AtomicLong();
            AtomicLong fallback = new AtomicLong();
            VehicleController.insertGeometryProjectedWaypoints(afterGeom, geomIndex, flagged, fallback);
            int afterLargeHops = countLargeSingleHops(afterGeom);
            double afterMaxHop = maxSingleHopDist(afterGeom);

            System.out.printf(
                    "veh %d: 큰 단일 홉(>%.0fm) 수 before=%d after=%d, 최대 단일 홉 거리 before=%.1fm after=%.1fm (flagged=%d, multiHopFallback=%d)%n",
                    vehId, LARGE_SINGLE_HOP_DIST_M, beforeLargeHops, afterLargeHops, beforeMaxHop, afterMaxHop,
                    flagged.get(), fallback.get());

            if (flagged.get() > fallback.get()) {
                // 최소 1건은 실제로 stitching에 성공(2-세그먼트 케이스)했다는 뜻 — 그 경우엔
                // 반드시 "가장 큰 단일 홉 거리"가 줄어야 한다(하나의 거대 점프가 여러 개의 작은
                // 곡선 추종 홉으로 쪼개졌으므로).
                anyFlaggedTransitionSeen = true;
                assertTrue(afterMaxHop < beforeMaxHop,
                        "veh " + vehId + ": stitching 성공했는데도 최대 단일 홉 거리가 줄지 않음(쪼개기 실패)");
            }
            assertTrue(afterLargeHops <= beforeLargeHops,
                    "veh " + vehId + ": geometry 투영 후 큰 단일 홉 수가 오히려 늘어남(회귀)");
        }

        assumeTrue(anyVehicleChecked, "대상 차량 3종 전부 현재 vehicle_sim.db에 없음 — 스킵");
        assumeTrue(anyFlaggedTransitionSeen, "대상 차량 중 실제로 stitching 성공한 케이스가 없음(재현 안 됨) — 핵심 검증 스킵");
    }

    private static List<VehicleEvent> deepCopy(List<VehicleEvent> events) {
        List<VehicleEvent> copy = new ArrayList<>(events.size());
        for (VehicleEvent e : events) {
            VehicleEvent c = new VehicleEvent();
            c.setId(e.getId());
            c.setType(e.getType());
            c.setTimestep(e.getTimestep());
            c.setLinkId(e.getLinkId());
            c.setLaneId(e.getLaneId());
            c.setPosX(e.getPosX());
            c.setPosY(e.getPosY());
            c.setSpeed(e.getSpeed());
            copy.add(c);
        }
        return copy;
    }

    private static int countLargeSingleHops(List<VehicleEvent> events) {
        int count = 0;
        for (int i = 0; i < events.size() - 1; i++) {
            if (hopDist(events.get(i), events.get(i + 1)) > LARGE_SINGLE_HOP_DIST_M) count++;
        }
        return count;
    }

    private static double maxSingleHopDist(List<VehicleEvent> events) {
        double max = 0;
        for (int i = 0; i < events.size() - 1; i++) {
            max = Math.max(max, hopDist(events.get(i), events.get(i + 1)));
        }
        return max;
    }

    private static double hopDist(VehicleEvent a, VehicleEvent b) {
        return Math.hypot(b.getPosX() - a.getPosX(), b.getPosY() - a.getPosY());
    }

    private static List<VehicleEvent> readEvents(int vehId) throws Exception {
        List<VehicleEvent> events = new ArrayList<>();
        String url = "jdbc:sqlite:" + VEHICLE_DB_PATH;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT timestep, pos_x, pos_y, spd, link_id, lane_id FROM VehicleEvent " +
                             "WHERE veh_id = ? ORDER BY timestep")) {
            ps.setInt(1, vehId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    VehicleEvent e = new VehicleEvent();
                    e.setId(String.valueOf(vehId));
                    e.setTimestep(rs.getDouble("timestep"));
                    e.setPosX(rs.getFloat("pos_x"));
                    e.setPosY(rs.getFloat("pos_y"));
                    e.setSpeed(rs.getFloat("spd"));
                    e.setLinkId(String.valueOf(rs.getLong("link_id")));
                    e.setLaneId(String.valueOf(rs.getLong("lane_id")));
                    events.add(e);
                }
            }
        }
        return events;
    }
}
