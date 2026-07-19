package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.VehicleEvent;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.service.vehicle.DummyVehicleGenerator;
import com.iitp.iitp_rest.util.VehicleDataReader;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 차량 viewport+시간창 스트리밍 단위 테스트 (Spring 컨텍스트 불필요).
 * 1) VehicleDataReader.readVehicleEventsFiltered — bbox 링크/시간창/상한 필터
 * 2) DummyVehicleGenerator.writeToSqlite — 청크 배치 (OOM 수정 회귀 방지)
 * 3) NetworkTileService.ingest — 기존 영속 파일 존재 시 재빌드 (CREATE TABLE 충돌 회귀 방지)
 */
class VehicleViewportStreamingTest {

    private static File syntheticDb;
    private static VehicleDataReader reader;

    @BeforeAll
    static void setUp() throws Exception {
        // ── 합성 vehicle_sim.db: 차량 3대 ──
        // V1: L1(bbox內) t=0~99 → L9(bbox外) t=100~199
        // V2: L9(bbox外)만 t=0~199
        // V3: L1(bbox內) t=150~199
        syntheticDb = File.createTempFile("test_vehicle_sim_", ".db");
        syntheticDb.deleteOnExit();
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + syntheticDb.getAbsolutePath());
             Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE VehicleEvent (veh_id TEXT, timestep REAL, link_id TEXT, lane_id TEXT, pos_x REAL, pos_y REAL)");
            try (PreparedStatement ps = conn.prepareStatement("INSERT INTO VehicleEvent VALUES (?,?,?,?,?,?)")) {
                for (int t = 0; t < 200; t++) {
                    insert(ps, "V1", t, t < 100 ? "L1" : "L9");
                    insert(ps, "V2", t, "L9");
                    if (t >= 150) insert(ps, "V3", t, "L1");
                }
                ps.executeBatch();
            }
        }

        // reader의 localPath를 합성 DB로 지정 (원격 다운로드 우회)
        reader = new VehicleDataReader();
        setField(reader, "localPath", syntheticDb.getAbsolutePath());
        setField(reader, "remoteUrl", "http://unused/");
    }

    private static void insert(PreparedStatement ps, String veh, int t, String link) throws Exception {
        ps.setString(1, veh); ps.setDouble(2, t); ps.setString(3, link);
        ps.setString(4, "0"); ps.setFloat(5, t); ps.setFloat(6, 0);
        ps.addBatch();
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(name);
        f.setAccessible(true);
        f.set(target, value);
    }

    @AfterAll
    static void tearDown() {
        if (syntheticDb != null) syntheticDb.delete();
    }

    // ─────────────── 1. readVehicleEventsFiltered ───────────────

    @Test
    void bbox링크_지난_차량만_선별되고_창내_전체궤적_포함() {
        // bbox 링크 = L1, 시간창 = 50~150
        var filtered = reader.readVehicleEventsFiltered("any", List.of("L1"), 50, 150, 0);
        List<VehicleEvent> events = filtered.events();
        assertEquals(1, filtered.totalVehicles());

        List<String> ids = events.stream().map(VehicleEvent::getId).distinct().sorted().toList();
        // V1: 창 내(50~99)에 L1 통과 → 선별. V2: L9만 → 제외. V3: L1이지만 t>=150 → 창 밖 → 제외
        assertEquals(List.of("V1"), ids);

        // V1의 창 내 전체 이벤트 (L1 구간 50~99 + L9 구간 100~149 — bbox 밖 링크도 보간 연속성 위해 포함)
        long l1Count = events.stream().filter(e -> e.getLinkId().equals("L1")).count();
        long l9Count = events.stream().filter(e -> e.getLinkId().equals("L9")).count();
        assertEquals(50, l1Count, "L1 구간 50~99");
        assertEquals(50, l9Count, "bbox 밖 L9 구간(100~149)도 포함되어야 보간이 끊기지 않음");
    }

    @Test
    void 시간창_전체면_모든시간_이벤트_반환() {
        var filtered = reader.readVehicleEventsFiltered("any", List.of("L1"), 0, 0, 0);
        List<VehicleEvent> events = filtered.events();
        List<String> ids = events.stream().map(VehicleEvent::getId).distinct().sorted().toList();
        assertEquals(List.of("V1", "V3"), ids); // L1을 지난 차량 전부
        assertEquals(200 + 50, events.size());  // V1 전체 200 + V3 50
        assertEquals(2, filtered.totalVehicles());
    }

    @Test
    void maxVehicles_상한시_체류시간_긴_차량_우선_및_전체수_보고() {
        // L1 체류: V1=100 이벤트(t 0~99) > V3=50 이벤트(t 150~199) → LIMIT 1 이면 V1 선별
        var filtered = reader.readVehicleEventsFiltered("any", List.of("L1"), 0, 0, 1);
        List<String> ids = filtered.events().stream().map(VehicleEvent::getId).distinct().toList();
        assertEquals(List.of("V1"), ids, "viewport 체류시간이 긴 차량이 우선 선별되어야 함");
        assertEquals(2, filtered.totalVehicles(), "상한 적용 전 전체 매칭 수 (truncated 판단 근거)");
    }

    @Test
    void 빈_링크목록이면_빈결과() {
        var filtered = reader.readVehicleEventsFiltered("any", List.of(), 0, 0, 0);
        assertTrue(filtered.events().isEmpty());
        assertEquals(0, filtered.totalVehicles());
    }

    @Test
    void simTimeRange_조회() {
        double[] range = reader.readSimTimeRange("any");
        assertEquals(0, range[0]);
        assertEquals(199, range[1]);
    }

    // ─────────────── 2. writeToSqlite 청크 배치 ───────────────

    @Test
    void writeToSqlite_청크경계_초과_이벤트도_전부_기록() throws Exception {
        // BATCH_SIZE(50,000) 경계를 넘는 120,001건 → 3회 flush 경로 검증
        int n = 120_001;
        List<VehicleEvent> events = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            VehicleEvent e = new VehicleEvent();
            e.setId("V" + (i % 100));
            e.setTimestep((double) i);
            e.setLinkId("L" + (i % 10));
            e.setLaneId("0");
            e.setPosX(i);
            e.setPosY(0);
            events.add(e);
        }
        DummyVehicleGenerator gen = new DummyVehicleGenerator();

        File out = File.createTempFile("test_dummy_out_", ".db");
        out.deleteOnExit();
        try (InputStream in = gen.writeToSqlite(events)) {
            Files.copy(in, out.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + out.getAbsolutePath());
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM VehicleEvent")) {
            assertTrue(rs.next());
            assertEquals(n, rs.getInt(1), "청크 flush 후 잔여분 포함 전량 기록");
        } finally {
            out.delete();
        }
    }

    // ─────────────── 3. NetworkTileService.ingest 재빌드 ───────────────

    @Test
    void ingest_두번호출해도_CREATE_TABLE_충돌없이_교체() throws Exception {
        // networkService/mapper는 ingest 경로에서 미사용 → null 주입
        NetworkTileService svc = new NetworkTileService(null, null);
        String versionId = "unittest_ingest_" + System.currentTimeMillis();
        Path stable = Paths.get(System.getProperty("user.home"), ".iitp-tiles", versionId + ".db");
        try {
            NetworkResponse resp1 = makeNetwork(3);
            svc.ingest(versionId, resp1);
            assertTrue(Files.exists(stable));

            // 2차 ingest (재임포트 상황) — 기존 파일이 있어도 실패하지 않고 교체되어야 함
            NetworkResponse resp2 = makeNetwork(5);
            svc.ingest(versionId, resp2);

            try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + stable.toAbsolutePath());
                 Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM links")) {
                assertTrue(rs.next());
                assertEquals(5, rs.getInt(1), "2차 ingest 데이터로 교체");
            }
        } finally {
            svc.invalidate(versionId);
            Files.deleteIfExists(stable);
        }
    }

    private static NetworkResponse makeNetwork(int linkCount) {
        NetworkResponse resp = new NetworkResponse();
        List<LinkResponse> links = new ArrayList<>();
        for (int i = 1; i <= linkCount; i++) {
            LinkResponse l = new LinkResponse();
            l.setId((long) i);
            l.setFromNode(1L);
            l.setToNode(2L);
            List<Coordinates> coords = new ArrayList<>();
            Coordinates a = new Coordinates(); a.setLng(127.0 + i * 0.001); a.setLat(37.5);
            Coordinates b = new Coordinates(); b.setLng(127.0 + i * 0.001); b.setLat(37.51);
            coords.add(a); coords.add(b);
            l.setCoordinates(coords);
            links.add(l);
        }
        resp.setLinks(links);
        NodeResponse n1 = new NodeResponse(); n1.setId(1L);
        Coordinates c1 = new Coordinates(); c1.setLng(127.0); c1.setLat(37.5); n1.setCoordinates(c1);
        NodeResponse n2 = new NodeResponse(); n2.setId(2L);
        Coordinates c2 = new Coordinates(); c2.setLng(127.0); c2.setLat(37.51); n2.setCoordinates(c2);
        resp.setNodes(new ArrayList<>(List.of(n1, n2)));
        return resp;
    }
}
